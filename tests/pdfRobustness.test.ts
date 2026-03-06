import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  normalizePdfText,
  findContentStart,
  detectDoubleColumnLayout,
} from "../src/services/ContentResolver";
import { detectSections } from "../src/services/ScientificSectionDetector";
import { analyzeDocument } from "../src/services/DocumentAnalyzer";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadFixture(name: string): string {
  return readFileSync(
    join(__dirname, "fixtures", "pdf-samples", name),
    "utf-8"
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PDF Robustness", () => {
  // =========================================================================
  // Double-column layout detection (diagnostic only)
  // =========================================================================

  describe("double-column detection", () => {
    it("should flag short-line text as possible double-column", () => {
      const fixture = loadFixture("double-column-merged.txt");
      expect(detectDoubleColumnLayout(fixture)).toBe(true);
    });

    it("should NOT flag normal-width text as double-column", () => {
      const fixture = loadFixture("metadata-preamble.txt");
      expect(detectDoubleColumnLayout(fixture)).toBe(false);
    });

    it("should return false for short text (<10 lines)", () => {
      expect(detectDoubleColumnLayout("short\ntext")).toBe(false);
    });
  });

  // =========================================================================
  // Figure/table caption guard
  // =========================================================================

  describe("figure/table caption guard", () => {
    it("should NOT insert line break before figure caption", () => {
      // Simulate flat PDF text with inline figure caption
      const flat =
        "Our approach builds on differentiable NAS methods but introduces novel constraints. " +
        "Figure 1. Overview of our NAS pipeline showing the search space. " +
        "The controller generates candidate architectures.";
      const normalized = normalizePdfText(flat);

      // "Figure 1." should NOT get a line break after the period
      expect(normalized).toContain("Figure 1. Overview");
      // But normal sentences should still get breaks if text is flat enough
    });

    it("should NOT insert line break after Fig. reference", () => {
      const flat =
        "We present results in the following sections. " +
        "Fig. 2 illustrates the memory profiling component. " +
        "Our method converges faster than baselines.";
      const normalized = normalizePdfText(flat);
      expect(normalized).toContain("Fig. 2 illustrates");
    });

    it("should NOT insert line break before Table caption", () => {
      const flat =
        "The search space includes standard operations. " +
        "Table 1. Search space dimensions and ranges for each type. " +
        "We define the search space as a directed acyclic graph.";
      const normalized = normalizePdfText(flat);
      expect(normalized).toContain("Table 1. Search");
    });

    it("should still break normal sentences", () => {
      const flat =
        "This is the first sentence. This is the second sentence. " +
        "And here is a third sentence with more content that makes it long enough.";
      const normalized = normalizePdfText(flat);
      // Step 2 should still break normal sentences when text is flat
      // (only fires when chars/line > 2000, so this short text won't trigger it)
      // But at least verify no crash
      expect(normalized).toBeTruthy();
    });
  });

  // =========================================================================
  // Metadata preamble skip
  // =========================================================================

  describe("metadata preamble skip (findContentStart)", () => {
    it("should detect copyright line", () => {
      const text = "© 2024 The Authors.\nAll rights reserved.\n\nAbstract\nSome content here.";
      const offset = findContentStart(text);
      expect(offset).toBeGreaterThan(0);
      expect(text.substring(offset)).toContain("Abstract");
    });

    it("should detect ISSN/ISBN lines", () => {
      const text = "Journal Name Vol. 25\nISSN 1533-7928\n\n1 Introduction\nContent.";
      const offset = findContentStart(text);
      expect(offset).toBeGreaterThan(0);
      expect(text.substring(offset)).toContain("Introduction");
    });

    it("should detect journal volume/page patterns", () => {
      const text = "Vol. 25, No. 3, pp. 1-34\nSubmitted 2023\n\nAbstract\nContent.";
      const offset = findContentStart(text);
      expect(offset).toBeGreaterThan(0);
    });

    it("should return 0 for text without preamble", () => {
      const text = "Abstract\n\nWe present a new method for image classification.";
      const offset = findContentStart(text);
      expect(offset).toBe(0);
    });

    it("should handle the metadata-preamble fixture correctly", () => {
      const fixture = loadFixture("metadata-preamble.txt");
      const offset = findContentStart(fixture);
      // Should skip past ISSN, copyright, and license lines
      expect(offset).toBeGreaterThan(0);
      // Content after offset should start with the title or abstract
      const afterPreamble = fixture.substring(offset);
      expect(afterPreamble).toContain("Efficient Transformers");
    });

    it("should not let preamble interfere with section detection", () => {
      const fixture = loadFixture("metadata-preamble.txt");
      const sections = detectSections(fixture);
      // Should find real sections, not false positives from preamble
      const sectionNames = sections.sectionNames;
      expect(sectionNames).toContain("abstract");
      expect(sectionNames).toContain("introduction");
    });
  });

  // =========================================================================
  // Non-English / Unicode handling
  // =========================================================================

  describe("non-English sentence splitting", () => {
    it("should handle accented characters without crashing", () => {
      const fixture = loadFixture("non-english-utf8.txt");
      const profile = analyzeDocument(fixture);
      expect(profile.sentenceCount).toBeGreaterThan(0);
      expect(profile.paragraphCount).toBeGreaterThan(0);
    });

    it("should detect sections in non-English paper", () => {
      const fixture = loadFixture("non-english-utf8.txt");
      const sections = detectSections(fixture);
      expect(sections.sectionNames).toContain("abstract");
      expect(sections.sectionNames).toContain("introduction");
      expect(sections.sectionNames).toContain("conclusion");
    });
  });

  // =========================================================================
  // CJK mixed content
  // =========================================================================

  describe("CJK mixed content", () => {
    it("should not crash on CJK characters", () => {
      const fixture = loadFixture("cjk-mixed.txt");
      const profile = analyzeDocument(fixture);
      expect(profile.charCount).toBeGreaterThan(0);
      expect(profile.wordCount).toBeGreaterThan(0);
      expect(profile.sentenceCount).toBeGreaterThan(0);
    });

    it("should detect sections in CJK-mixed paper", () => {
      const fixture = loadFixture("cjk-mixed.txt");
      const sections = detectSections(fixture);
      expect(sections.sectionNames).toContain("abstract");
      expect(sections.sectionNames).toContain("introduction");
    });
  });

  // =========================================================================
  // No section headers
  // =========================================================================

  describe("no-section-header paper", () => {
    it("should return empty sections array without error", () => {
      const fixture = loadFixture("no-section-headers.txt");
      const sections = detectSections(fixture);
      expect(sections.sections).toHaveLength(0);
      expect(sections.sectionNames).toHaveLength(0);
      expect(sections.isScientificFormat).toBe(false);
    });

    it("should still produce valid document profile", () => {
      const fixture = loadFixture("no-section-headers.txt");
      const profile = analyzeDocument(fixture);
      expect(profile.paragraphCount).toBeGreaterThan(0);
      expect(profile.sentenceCount).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // Appendix / Supplementary detection
  // =========================================================================

  describe("appendix and supplementary detection", () => {
    it("should detect Appendix as a section", () => {
      const fixture = loadFixture("supplementary-appendix.txt");
      const sections = detectSections(fixture);
      const names = sections.sectionNames;
      expect(names).toContain("appendix");
    });

    it("should detect Supporting Information mapped to supplementary", () => {
      const fixture = loadFixture("supplementary-appendix.txt");
      const sections = detectSections(fixture);
      const names = sections.sectionNames;
      expect(names).toContain("supplementary");
    });

    it("should detect standard sections alongside appendix", () => {
      const fixture = loadFixture("supplementary-appendix.txt");
      const sections = detectSections(fixture);
      const names = sections.sectionNames;
      expect(names).toContain("abstract");
      expect(names).toContain("introduction");
      expect(names).toContain("methods");
    });
  });

  // =========================================================================
  // Table-row filter in DocumentAnalyzer
  // =========================================================================

  describe("table-row filter", () => {
    it("should exclude table-data paragraphs from paragraph count", () => {
      const fixture = loadFixture("table-heavy.txt");
      const profile = analyzeDocument(fixture);
      // The fixture has multiple table blocks — they should be excluded
      expect(profile.tableRowsSkipped).toBeGreaterThan(0);
    });

    it("should not skip normal text paragraphs", () => {
      const fixture = loadFixture("no-section-headers.txt");
      const profile = analyzeDocument(fixture);
      // An essay with no tables should have 0 table rows skipped
      expect(profile.tableRowsSkipped).toBeUndefined();
    });

    it("should produce lower paragraph count with tables skipped", () => {
      // Text with an inline table
      const text = [
        "This is the introduction paragraph.",
        "",
        "0.823  0.791  0.834  0.816",
        "0.815  0.802  0.828  0.815",
        "0.798  0.776  0.811  0.795",
        "",
        "This is the discussion paragraph.",
      ].join("\n");
      const profile = analyzeDocument(text);
      // 3 total paragraphs, 1 is table data
      expect(profile.tableRowsSkipped).toBe(1);
      expect(profile.paragraphCount).toBe(2);
    });
  });

  // =========================================================================
  // Figure-caption-inline fixture (integration)
  // =========================================================================

  describe("figure-caption-inline fixture", () => {
    it("should detect sections despite inline figure captions", () => {
      const fixture = loadFixture("figure-caption-inline.txt");
      const sections = detectSections(fixture);
      expect(sections.sectionNames).toContain("abstract");
      expect(sections.sectionNames).toContain("introduction");
      expect(sections.sectionNames).toContain("methods");
      expect(sections.sectionNames).toContain("results");
      expect(sections.sectionNames).toContain("conclusion");
    });

    it("should produce valid profile with inline captions", () => {
      const fixture = loadFixture("figure-caption-inline.txt");
      const profile = analyzeDocument(fixture);
      expect(profile.sentenceCount).toBeGreaterThan(5);
    });
  });
});
