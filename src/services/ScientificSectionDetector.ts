/**
 * ScientificSectionDetector — detect document sections (Abstract, Introduction, etc.)
 *
 * Computed LAZILY in handler. NEVER stored in DB.
 */

export interface DocumentSection {
  name: string;        // canonical: "abstract", "introduction", etc.
  displayName: string; // as found: "1. Introduction", "## Methods"
  startLine: number;   // 1-based
  endLine: number;     // 1-based
  text: string;
  wordCount: number;
}

export interface SectionProfile {
  isScientificFormat: boolean; // true if >= 3 recognized sections
  sections: DocumentSection[];
  sectionNames: string[];      // ordered list of canonical names
}

export const SECTION_NAMES = new Set([
  "abstract",
  "introduction",
  "background",
  "literature",
  "methods",
  "methodology",
  "results",
  "discussion",
  "conclusion",
  "conclusions",
  "acknowledgments",
  "acknowledgements",
  "references",
  "bibliography",
  "appendix",
  "supplementary",
  "keywords",
]);

/** Map variations to canonical names */
const CANONICAL: Record<string, string> = {
  method: "methods",
  result: "results",
  conclusions: "conclusion",
  acknowledgements: "acknowledgments",
  bibliography: "references",
  methodology: "methods",
  "literature review": "literature",
  "related work": "literature",
  "related works": "literature",
  "materials and methods": "methods",
  "results and discussion": "results",
  "supplementary material": "supplementary",
  "supplementary materials": "supplementary",
};

/**
 * Normalize a heading string to a canonical section name, or null if not recognized.
 */
export function normalizeSectionName(heading: string): string | null {
  // Strip markdown, numbering, leading/trailing whitespace
  const cleaned = heading
    .replace(/^#+\s*/, "")       // markdown headings
    .replace(/^\d+\.?\s*/, "")   // numbered: "1.", "2."
    .replace(/[.:]\s*$/, "")     // trailing colon/period
    .trim()
    .toLowerCase();

  if (CANONICAL[cleaned]) return CANONICAL[cleaned];
  if (SECTION_NAMES.has(cleaned)) return cleaned;

  // Try matching the first word
  const firstWord = cleaned.split(/\s/)[0];
  if (SECTION_NAMES.has(firstWord)) return CANONICAL[firstWord] || firstWord;

  return null;
}

/** Heading patterns to detect */
const HEADING_PATTERNS = [
  // Markdown: ## Heading
  /^(#{1,3})\s+(.+)$/,
  // Numbered: 1. Introduction, 2 Methods
  /^(\d+)\.?\s+([A-Z].+)$/,
  // ALL CAPS short line (likely heading)
  /^([A-Z][A-Z\s]{2,40})$/,
];

function countWords(text: string): number {
  const t = text.trim();
  if (!t) return 0;
  return t.split(/\s+/).length;
}

/**
 * Detect sections in document text.
 * Scans lines for heading patterns matching known section names.
 */
export function detectSections(text: string): SectionProfile {
  const lines = text.split("\n");
  const headings: Array<{
    lineIndex: number;
    displayName: string;
    canonical: string;
  }> = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Try heading patterns
    for (const pattern of HEADING_PATTERNS) {
      const match = line.match(pattern);
      if (match) {
        // For ALL CAPS pattern, the whole line is the heading text
        const headingText = match[2] || match[1];
        const canonical = normalizeSectionName(headingText);
        if (canonical) {
          headings.push({
            lineIndex: i,
            displayName: line,
            canonical,
          });
          break;
        }
      }
    }

    // Also check standalone short lines matching section names
    if (line.length <= 50 && !headings.some((h) => h.lineIndex === i)) {
      const canonical = normalizeSectionName(line);
      if (canonical) {
        headings.push({
          lineIndex: i,
          displayName: line,
          canonical,
        });
      }
    }
  }

  // Build sections from headings
  const sections: DocumentSection[] = [];
  for (let h = 0; h < headings.length; h++) {
    const startLine = headings[h].lineIndex;
    const endLine =
      h + 1 < headings.length
        ? headings[h + 1].lineIndex - 1
        : lines.length - 1;

    // Section text is everything from heading to before next heading
    const sectionLines = lines.slice(startLine + 1, endLine + 1);
    const sectionText = sectionLines.join("\n").trim();

    sections.push({
      name: headings[h].canonical,
      displayName: headings[h].displayName,
      startLine: startLine + 1, // 1-based
      endLine: endLine + 1,     // 1-based
      text: sectionText,
      wordCount: countWords(sectionText),
    });
  }

  // Special case: infer unlabeled abstract from first short block before first heading
  if (headings.length > 0 && headings[0].lineIndex > 0) {
    const beforeFirst = lines.slice(0, headings[0].lineIndex).join("\n").trim();
    if (
      beforeFirst.length > 50 &&
      beforeFirst.length < 3000 &&
      !sections.some((s) => s.name === "abstract")
    ) {
      sections.unshift({
        name: "abstract",
        displayName: "(Inferred Abstract)",
        startLine: 1,
        endLine: headings[0].lineIndex,
        text: beforeFirst,
        wordCount: countWords(beforeFirst),
      });
    }
  }

  const sectionNames = sections.map((s) => s.name);
  const isScientificFormat = sections.length >= 3;

  return { isScientificFormat, sections, sectionNames };
}
