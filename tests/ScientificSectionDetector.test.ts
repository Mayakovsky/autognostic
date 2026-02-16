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

    it("handles empty text", () => {
      const profile = detectSections("");
      expect(profile.isScientificFormat).toBe(false);
      expect(profile.sections).toHaveLength(0);
    });
  });
});
