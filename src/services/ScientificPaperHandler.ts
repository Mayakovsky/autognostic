import type { IAgentRuntime } from "@elizaos/core";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";

import { getDb } from "../db/getDb";
import {
  autognosticPaperClassification,
  type ClassificationPath,
  type ResearchFocus,
  type ClassificationEvidence,
  type PaperMetadata,
} from "../db/schema";
import {
  ScientificPaperDetector,
  getScientificPaperDetector,
} from "./ScientificPaperDetector";

/**
 * Starter taxonomy: Level 1 domains
 */
const L1_DOMAINS: Record<string, { name: string; keywords: string[] }> = {
  "L1.NATSCI": {
    name: "Natural Sciences",
    keywords: ["physics", "chemistry", "astronomy", "earth science", "materials", "geology", "meteorology"],
  },
  "L1.LIFESCI": {
    name: "Life Sciences",
    keywords: ["biology", "ecology", "evolution", "microbiology", "neuroscience", "biochemistry", "genetics", "genomics"],
  },
  "L1.MEDHLT": {
    name: "Medical & Health Sciences",
    keywords: ["medicine", "clinical", "health", "medical", "pharmaceutical", "epidemiology", "pathology", "nursing"],
  },
  "L1.ENGTECH": {
    name: "Engineering & Technology",
    keywords: ["engineering", "computer science", "electrical", "mechanical", "civil", "software", "robotics", "ai", "machine learning"],
  },
  "L1.SOCSCI": {
    name: "Social Sciences",
    keywords: ["economics", "psychology", "sociology", "political", "anthropology", "education", "communication"],
  },
  "L1.HUMARTS": {
    name: "Humanities & Arts",
    keywords: ["history", "philosophy", "linguistics", "literature", "cultural", "art", "music"],
  },
  "L1.INTERDIS": {
    name: "Interdisciplinary & Applied",
    keywords: ["environmental", "cognitive science", "data science", "sustainability", "policy"],
  },
  "L1.FORMAL": {
    name: "Formal & Computational Foundations",
    keywords: ["mathematics", "statistics", "probability", "optimization", "information theory", "computational"],
  },
};

/**
 * Starter vocabulary: Task/Study Types
 */
const TASK_STUDY_TYPES = [
  "theory",
  "experiment_in_vivo",
  "experiment_in_vitro",
  "experiment_in_situ",
  "observation",
  "simulation",
  "method_development",
  "dataset_creation",
  "benchmarking",
  "systematic_review",
  "meta_analysis",
  "clinical_trial_randomized",
  "clinical_trial_nonrandomized",
  "case_study",
  "field_study",
  "survey",
  "qualitative_interviews",
  "replication",
];

/**
 * Starter vocabulary: Method/Approach
 */
const METHOD_APPROACHES = [
  "statistical_inference",
  "bayesian_modeling",
  "machine_learning_supervised",
  "machine_learning_unsupervised",
  "deep_learning",
  "optimization",
  "control_systems",
  "microscopy",
  "spectroscopy",
  "chromatography",
  "mass_spectrometry",
  "cryo_em",
  "xray_diffraction",
  "nmr",
  "computational_dft",
  "molecular_dynamics",
  "finite_element_analysis",
  "survey_instrument",
  "econometric_modeling",
  "ethnography",
  "corpus_linguistics",
];

export interface ClassificationResult {
  zone: "bronze" | "silver" | "gold";
  primaryPath: ClassificationPath | null;
  secondaryPaths: ClassificationPath[];
  focus: ResearchFocus | null;
  confidence: number;
  evidence: ClassificationEvidence[];
}

export interface HandlerResult {
  documentId: string;
  classificationId: string;
  zone: "bronze" | "silver" | "gold";
  isScientificPaper: boolean;
  classification: ClassificationResult | null;
  paperMetadata: PaperMetadata | null;
  enrichedContent: string; // Content with classification prepended
}

/**
 * ScientificPaperHandler
 * 
 * Handles the full lifecycle of scientific paper processing:
 * 1. Detection (via ScientificPaperDetector)
 * 2. Metadata extraction
 * 3. Classification (5-level taxonomy)
 * 4. Storage with enriched content
 * 
 * Lakehouse Zones:
 * - Bronze: Any document (raw ingestion)
 * - Silver: DOI/ISSN verified scientific paper
 * - Gold: Classified paper with L1-L4 path + L5 focus
 */
export class ScientificPaperHandler {
  private detector: ScientificPaperDetector;
  private classifierVersion = "cls_v0.1";

  constructor(private runtime: IAgentRuntime) {
    this.detector = getScientificPaperDetector();
  }

  /**
   * Process a document: detect, classify, and prepare for storage.
   * Returns enriched content with classification data prepended.
   */
  async process(
    url: string,
    content: string,
    documentId: string
  ): Promise<HandlerResult> {
    // Step 1: Detect if scientific paper
    const detection = await this.detector.detect(url, content);

    if (!detection.isScientificPaper) {
      // Not a scientific paper - Bronze zone, no classification
      const classificationId = await this.storeClassification(documentId, {
        zone: "bronze",
        primaryPath: null,
        secondaryPaths: [],
        focus: null,
        confidence: 0,
        evidence: [],
      }, null);

      return {
        documentId,
        classificationId,
        zone: "bronze",
        isScientificPaper: false,
        classification: null,
        paperMetadata: null,
        enrichedContent: content,
      };
    }

    // Step 2: Determine zone based on detection confidence
    let zone: "bronze" | "silver" | "gold" = "bronze";
    
    if (detection.metadata?.confidence === "high") {
      zone = "silver"; // Verified via DOI/ISSN
    }

    // Step 3: Attempt classification
    const classification = await this.classify(
      content,
      detection.paperMetadata,
      detection.suggestedDomain
    );

    if (classification.primaryPath && classification.confidence >= 0.5) {
      zone = "gold"; // Successfully classified
    }

    // Step 4: Store classification record
    const classificationId = await this.storeClassification(
      documentId,
      classification,
      detection.paperMetadata,
      zone
    );

    // Step 5: Generate enriched content
    const enrichedContent = this.buildEnrichedContent(
      content,
      detection.paperMetadata,
      classification
    );

    return {
      documentId,
      classificationId,
      zone,
      isScientificPaper: true,
      classification,
      paperMetadata: detection.paperMetadata,
      enrichedContent,
    };
  }

  /**
   * Classify a paper using available metadata and content analysis.
   */
  async classify(
    content: string,
    paperMetadata: PaperMetadata | null,
    suggestedDomain?: string
  ): Promise<ClassificationResult> {
    const evidence: ClassificationEvidence[] = [];
    let primaryPath: ClassificationPath | null = null;
    const secondaryPaths: ClassificationPath[] = [];
    let focus: ResearchFocus | null = null;
    let confidence = 0;

    // Extract abstract if available
    const abstract = paperMetadata?.abstract || this.extractAbstract(content);
    const title = paperMetadata?.title || this.extractTitle(content);
    const keywords = paperMetadata?.keywords || [];
    const subjects = paperMetadata?.subjects || [];

    // Combine text for analysis
    const analysisText = [title, abstract, ...keywords, ...subjects]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    if (!analysisText || analysisText.length < 50) {
      // Insufficient content for classification
      return {
        zone: "bronze",
        primaryPath: null,
        secondaryPaths: [],
        focus: null,
        confidence: 0,
        evidence: [],
      };
    }

    // Step 1: Determine L1 domain
    let bestDomain: string | null = suggestedDomain || null;
    let domainScore = suggestedDomain ? 0.6 : 0;

    for (const [domainId, domain] of Object.entries(L1_DOMAINS)) {
      const matchCount = domain.keywords.filter((kw) =>
        analysisText.includes(kw)
      ).length;
      const score = matchCount / domain.keywords.length;

      if (score > domainScore) {
        domainScore = score;
        bestDomain = domainId;
      }
    }

    if (bestDomain) {
      primaryPath = {
        l1: bestDomain,
        l2: `${bestDomain}.GENERAL`, // Placeholder L2
        confidence: domainScore,
      };

      evidence.push({
        field: abstract ? "abstract" : "full_text",
        snippet: analysisText.slice(0, 200),
        relevance: domainScore,
      });

      confidence = Math.min(0.4 + domainScore * 0.4, 0.8);
    }

    // Step 2: Extract Level 5 focus facets
    focus = this.extractFocusFacets(analysisText, title, abstract);
    
    if (focus && (focus.taskStudyType.length > 0 || focus.methodApproach.length > 0)) {
      confidence = Math.min(confidence + 0.1, 0.9);
    }

    // Step 3: Check for interdisciplinary signals
    const secondaryDomains = this.findSecondaryDomains(analysisText, bestDomain);
    for (const secDomain of secondaryDomains.slice(0, 3)) {
      secondaryPaths.push({
        l1: secDomain,
        l2: `${secDomain}.GENERAL`,
        confidence: 0.5,
      });
    }

    const zone = confidence >= 0.5 ? "gold" : "silver";

    return {
      zone,
      primaryPath,
      secondaryPaths,
      focus,
      confidence,
      evidence,
    };
  }

  /**
   * Extract Level 5 research focus facets from content.
   */
  private extractFocusFacets(
    analysisText: string,
    title?: string,
    abstract?: string
  ): ResearchFocus {
    const taskStudyType: string[] = [];
    const methodApproach: string[] = [];
    const phenomenonTopic: string[] = [];
    const entitySystem: string[] = [];

    // Match task/study types
    for (const taskType of TASK_STUDY_TYPES) {
      const searchTerm = taskType.replace(/_/g, " ");
      if (analysisText.includes(searchTerm) || analysisText.includes(taskType)) {
        taskStudyType.push(taskType);
      }
    }

    // Special patterns for study types
    if (/randomized.*trial|rct\b/i.test(analysisText)) {
      if (!taskStudyType.includes("clinical_trial_randomized")) {
        taskStudyType.push("clinical_trial_randomized");
      }
    }
    if (/systematic\s+review/i.test(analysisText)) {
      if (!taskStudyType.includes("systematic_review")) {
        taskStudyType.push("systematic_review");
      }
    }
    if (/meta-?analysis/i.test(analysisText)) {
      if (!taskStudyType.includes("meta_analysis")) {
        taskStudyType.push("meta_analysis");
      }
    }
    if (/simulation|simulated|monte\s+carlo/i.test(analysisText)) {
      if (!taskStudyType.includes("simulation")) {
        taskStudyType.push("simulation");
      }
    }

    // Match methods/approaches
    for (const method of METHOD_APPROACHES) {
      const searchTerm = method.replace(/_/g, " ");
      if (analysisText.includes(searchTerm) || analysisText.includes(method)) {
        methodApproach.push(method);
      }
    }

    // Special patterns for methods
    if (/deep\s+learning|neural\s+network|cnn|rnn|transformer/i.test(analysisText)) {
      if (!methodApproach.includes("deep_learning")) {
        methodApproach.push("deep_learning");
      }
    }
    if (/machine\s+learning|ml\s+model/i.test(analysisText)) {
      if (!methodApproach.includes("machine_learning_supervised") && 
          !methodApproach.includes("machine_learning_unsupervised")) {
        methodApproach.push("machine_learning_supervised");
      }
    }
    if (/bayesian|mcmc|posterior/i.test(analysisText)) {
      if (!methodApproach.includes("bayesian_modeling")) {
        methodApproach.push("bayesian_modeling");
      }
    }

    // Generate free-text focus from title/abstract
    const freeTextFocus = title 
      ? title.slice(0, 160)
      : (abstract ? abstract.slice(0, 160) : undefined);

    return {
      phenomenonTopic,
      taskStudyType,
      methodApproach,
      entitySystem,
      freeTextFocus,
    };
  }

  /**
   * Find secondary domains for interdisciplinary papers.
   */
  private findSecondaryDomains(analysisText: string, primaryDomain: string | null): string[] {
    const secondary: string[] = [];

    for (const [domainId, domain] of Object.entries(L1_DOMAINS)) {
      if (domainId === primaryDomain) continue;

      const matchCount = domain.keywords.filter((kw) =>
        analysisText.includes(kw)
      ).length;

      if (matchCount >= 2) {
        secondary.push(domainId);
      }
    }

    return secondary;
  }

  /**
   * Extract abstract from content (heuristic).
   */
  private extractAbstract(content: string): string | undefined {
    // Look for common abstract patterns
    const patterns = [
      /abstract[:\s]*\n?([\s\S]{100,2000}?)(?=\n\s*(?:introduction|keywords|1\.|background))/i,
      /^([\s\S]{100,500}?)(?=\n\s*(?:introduction|1\.))/i,
    ];

    for (const pattern of patterns) {
      const match = content.match(pattern);
      if (match) {
        return match[1].trim();
      }
    }

    return undefined;
  }

  /**
   * Extract title from content (heuristic).
   */
  private extractTitle(content: string): string | undefined {
    // First non-empty line is often the title
    const lines = content.split("\n").filter((l) => l.trim().length > 0);
    if (lines.length > 0 && lines[0].length < 300) {
      return lines[0].trim();
    }
    return undefined;
  }

  /**
   * Build enriched content with classification metadata prepended.
   */
  private buildEnrichedContent(
    originalContent: string,
    paperMetadata: PaperMetadata | null,
    classification: ClassificationResult
  ): string {
    const parts: string[] = [];

    // Header
    parts.push("---");
    parts.push("# AUTOGNOSTIC SCIENTIFIC PAPER METADATA");
    parts.push(`# Zone: ${classification.zone.toUpperCase()}`);
    parts.push(`# Classifier: ${this.classifierVersion}`);
    parts.push(`# Classified: ${new Date().toISOString()}`);
    parts.push("---");
    parts.push("");

    // Paper metadata
    if (paperMetadata) {
      if (paperMetadata.doi) {
        parts.push(`**DOI:** ${paperMetadata.doi}`);
      }
      if (paperMetadata.title) {
        parts.push(`**Title:** ${paperMetadata.title}`);
      }
      if (paperMetadata.authors && paperMetadata.authors.length > 0) {
        parts.push(`**Authors:** ${paperMetadata.authors.join(", ")}`);
      }
      if (paperMetadata.journal) {
        parts.push(`**Journal:** ${paperMetadata.journal}`);
      }
      if (paperMetadata.publishedDate) {
        parts.push(`**Published:** ${paperMetadata.publishedDate}`);
      }
      parts.push("");
    }

    // Classification
    if (classification.primaryPath) {
      parts.push("## Classification");
      parts.push(`**Domain (L1):** ${classification.primaryPath.l1}`);
      parts.push(`**Discipline (L2):** ${classification.primaryPath.l2}`);
      if (classification.primaryPath.l3) {
        parts.push(`**Subdiscipline (L3):** ${classification.primaryPath.l3}`);
      }
      if (classification.primaryPath.l4) {
        parts.push(`**Specialty (L4):** ${classification.primaryPath.l4}`);
      }
      parts.push(`**Confidence:** ${(classification.confidence * 100).toFixed(1)}%`);
      parts.push("");

      if (classification.secondaryPaths.length > 0) {
        parts.push("**Secondary Domains:**");
        for (const path of classification.secondaryPaths) {
          parts.push(`- ${path.l1} → ${path.l2}`);
        }
        parts.push("");
      }
    }

    // Research focus (L5)
    if (classification.focus) {
      parts.push("## Research Focus");
      if (classification.focus.taskStudyType.length > 0) {
        parts.push(`**Study Type:** ${classification.focus.taskStudyType.join(", ")}`);
      }
      if (classification.focus.methodApproach.length > 0) {
        parts.push(`**Methods:** ${classification.focus.methodApproach.join(", ")}`);
      }
      if (classification.focus.freeTextFocus) {
        parts.push(`**Focus:** ${classification.focus.freeTextFocus}`);
      }
      parts.push("");
    }

    // Abstract (if available)
    if (paperMetadata?.abstract) {
      parts.push("## Abstract");
      parts.push(paperMetadata.abstract);
      parts.push("");
    }

    // Separator
    parts.push("---");
    parts.push("# ORIGINAL CONTENT");
    parts.push("---");
    parts.push("");

    // Original content
    parts.push(originalContent);

    return parts.join("\n");
  }

  /**
   * Store classification record in database.
   */
  private async storeClassification(
    documentId: string,
    classification: ClassificationResult,
    paperMetadata: PaperMetadata | null,
    zone?: "bronze" | "silver" | "gold"
  ): Promise<string> {
    const db = await getDb(this.runtime);
    const classificationId = randomUUID();
    const finalZone = zone || classification.zone;

    const now = new Date();

    await db.insert(autognosticPaperClassification).values({
      id: classificationId,
      documentId,
      zone: finalZone,
      promotedToSilverAt: finalZone !== "bronze" ? now : null,
      promotedToGoldAt: finalZone === "gold" ? now : null,
      primaryPath: classification.primaryPath,
      secondaryPaths: classification.secondaryPaths,
      focus: classification.focus,
      confidence: classification.confidence,
      evidence: classification.evidence,
      classifierVersion: this.classifierVersion,
      paperMetadata,
    });

    return classificationId;
  }

  /**
   * Get classification for a document.
   */
  async getClassification(documentId: string) {
    const db = await getDb(this.runtime);
    const rows = await db
      .select()
      .from(autognosticPaperClassification)
      .where(eq(autognosticPaperClassification.documentId, documentId))
      .limit(1);
    return rows[0] || null;
  }

  /**
   * List papers by zone.
   */
  async listByZone(zone: "bronze" | "silver" | "gold") {
    const db = await getDb(this.runtime);
    return db
      .select()
      .from(autognosticPaperClassification)
      .where(eq(autognosticPaperClassification.zone, zone));
  }

  /**
   * List Gold zone papers (fully classified).
   */
  async listGoldPapers() {
    return this.listByZone("gold");
  }
}

// Factory function
export function createScientificPaperHandler(runtime: IAgentRuntime): ScientificPaperHandler {
  return new ScientificPaperHandler(runtime);
}
