import { describe, it, expect } from "vitest";
import {
  detectSections,
  normalizeSectionName,
  SECTION_NAMES,
} from "../src/services/ScientificSectionDetector";

describe("ScientificSectionDetector", () => {
  describe("normalizeSectionName", () => {
    it("normalizes known section names", () => {
      expect(normalizeSectionName("Introduction")).toBe("introduction");
      expect(normalizeSectionName("ABSTRACT")).toBe("abstract");
      expect(normalizeSectionName("Methods")).toBe("methods");
      expect(normalizeSectionName("Conclusion")).toBe("conclusion");
      expect(normalizeSectionName("References")).toBe("references");
    });

    it("maps summary and overview to abstract", () => {
      expect(normalizeSectionName("Summary")).toBe("abstract");
      expect(normalizeSectionName("Overview")).toBe("abstract");
      expect(normalizeSectionName("summary")).toBe("abstract");
    });

    it("normalizes variations", () => {
      expect(normalizeSectionName("Conclusions")).toBe("conclusion");
      expect(normalizeSectionName("Acknowledgements")).toBe("acknowledgments");
      expect(normalizeSectionName("Bibliography")).toBe("references");
      expect(normalizeSectionName("Methodology")).toBe("methods");
    });

    it("strips markdown headings", () => {
      expect(normalizeSectionName("## Introduction")).toBe("introduction");
      expect(normalizeSectionName("# Abstract")).toBe("abstract");
    });

    it("strips numbering", () => {
      expect(normalizeSectionName("1. Introduction")).toBe("introduction");
      expect(normalizeSectionName("3 Methods")).toBe("methods");
    });

    it("returns null for unknown headings", () => {
      expect(normalizeSectionName("Random Title")).toBeNull();
      expect(normalizeSectionName("Chapter 1")).toBeNull();
    });
  });

  describe("detectSections", () => {
    const scientificPaper = `This paper studies machine learning.

## Abstract

We present a novel framework for natural language processing.
Our results demonstrate significant improvements.

## Introduction

Natural language processing has seen rapid growth.
We build on prior work in transformer architectures.

## Methods

We used a dataset of 10,000 samples.
The model was trained for 100 epochs.

## Results

Our model achieved 95% accuracy.
This represents a 10% improvement.

## Discussion

The results suggest that our approach is effective.
There are several limitations to consider.

## Conclusion

We have presented a novel framework.
Future work will address scalability.

## References

[1] Smith et al. 2024. "A survey of NLP methods."
[2] Jones et al. 2023. "Transformer architectures."`;

    it("detects sections in a scientific paper", () => {
      const profile = detectSections(scientificPaper);
      expect(profile.isScientificFormat).toBe(true);
      expect(profile.sections.length).toBeGreaterThanOrEqual(5);
    });

    it("returns canonical section names", () => {
      const profile = detectSections(scientificPaper);
      expect(profile.sectionNames).toContain("abstract");
      expect(profile.sectionNames).toContain("introduction");
      expect(profile.sectionNames).toContain("methods");
      expect(profile.sectionNames).toContain("results");
      expect(profile.sectionNames).toContain("conclusion");
      expect(profile.sectionNames).toContain("references");
    });

    it("each section has text content", () => {
      const profile = detectSections(scientificPaper);
      for (const section of profile.sections) {
        expect(section.text.length).toBeGreaterThan(0);
        expect(section.wordCount).toBeGreaterThan(0);
        expect(section.startLine).toBeGreaterThan(0);
        expect(section.endLine).toBeGreaterThanOrEqual(section.startLine);
      }
    });

    it("detects numbered sections", () => {
      const text = `1. Introduction

Some intro text here.

2. Methods

Methods description here.

3. Results

Results go here.`;
      const profile = detectSections(text);
      expect(profile.isScientificFormat).toBe(true);
      expect(profile.sectionNames).toContain("introduction");
      expect(profile.sectionNames).toContain("methods");
      expect(profile.sectionNames).toContain("results");
    });

    it("detects ALL CAPS headings", () => {
      const text = `ABSTRACT

This is the abstract text.

INTRODUCTION

This is the introduction.

METHODS

Methods described here.`;
      const profile = detectSections(text);
      expect(profile.isScientificFormat).toBe(true);
      expect(profile.sectionNames).toContain("abstract");
      expect(profile.sectionNames).toContain("introduction");
      expect(profile.sectionNames).toContain("methods");
    });

    it("returns isScientificFormat=false for < 3 sections", () => {
      const text = `## Introduction

Some text.`;
      const profile = detectSections(text);
      expect(profile.isScientificFormat).toBe(false);
    });

    it("infers abstract from text before first heading", () => {
      const text = `This paper presents a novel approach to machine learning
that significantly improves classification accuracy across benchmarks.

## Introduction

We begin with motivation.

## Methods

Our approach uses deep learning.

## Results

We achieved high accuracy.`;
      const profile = detectSections(text);
      const abstractSection = profile.sections.find(s => s.name === "abstract");
      expect(abstractSection).toBeDefined();
      expect(abstractSection!.displayName).toBe("(Inferred Abstract)");
    });

    it("infers abstract from long preamble containing 'Abstract' keyword", () => {
      // Simulates a PDF where title + authors + abstract are in one block > 3000 chars
      const longTitle = "A ".repeat(1600); // ~3200 chars of title/author metadata
      const abstractContent = "We present a novel approach to machine learning that improves accuracy. " +
        "Our method achieves state-of-the-art results on benchmark datasets.";
      const text = `${longTitle}Abstract ${abstractContent}

## Introduction

We begin with motivation.

## Methods

Our approach uses deep learning.

## Results

We achieved high accuracy.`;
      const profile = detectSections(text);
      const abstractSection = profile.sections.find(s => s.name === "abstract");
      expect(abstractSection).toBeDefined();
      expect(abstractSection!.text).toContain("We present a novel approach");
      // Should NOT contain the long title padding
      expect(abstractSection!.text.length).toBeLessThan(500);
    });

    it("handles empty text", () => {
      const profile = detectSections("");
      expect(profile.isScientificFormat).toBe(false);
      expect(profile.sections).toHaveLength(0);
    });

    it("filters out false headings after references section", () => {
      // Simulates PDF reference text where "Introduction" appears as a standalone
      // line from a book title like "Introduction to Bootstrap"
      const text = `## Introduction

Some intro text here.

## Methods

Methods description here.

## Results

Results go here.

## References

[1] Smith et al. 2024. A survey of NLP methods.
[22] Cohen et al. 2022.
[23] Jörg Krause. 2020.

Introduction

to Bootstrap.
In Introducing Bootstrap 4.
Springer, 1-17.`;
      const profile = detectSections(text);
      // Should only have 4 sections, not 5 — the "Introduction" in references is filtered
      const introSections = profile.sections.filter(s => s.name === "introduction");
      expect(introSections).toHaveLength(1);
      expect(introSections[0].startLine).toBeLessThan(10); // The real one, not line 260
      // References should be the last section
      const lastSection = profile.sections[profile.sections.length - 1];
      expect(lastSection.name).toBe("references");
    });

    it("keeps all sections when no references section exists", () => {
      const text = `## Introduction

Some text.

## Methods

Methods text.

## Conclusion

Final text.`;
      const profile = detectSections(text);
      expect(profile.sectionNames).toContain("introduction");
      expect(profile.sectionNames).toContain("methods");
      expect(profile.sectionNames).toContain("conclusion");
    });
  });
});
