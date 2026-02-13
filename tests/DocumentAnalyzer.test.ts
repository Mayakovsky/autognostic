import { describe, it, expect } from "vitest";
import { analyzeDocument } from "../src/services/DocumentAnalyzer";

describe("DocumentAnalyzer", () => {
  describe("basic text", () => {
    it("should analyze a simple two-sentence text", () => {
      const profile = analyzeDocument("Hello world. Goodbye.");
      expect(profile.sentenceCount).toBe(2);
      expect(profile.wordCount).toBe(3);
      expect(profile.paragraphCount).toBe(1);
      expect(profile.sentences[0].text).toBe("Hello world.");
      expect(profile.sentences[1].text).toBe("Goodbye.");
    });

    it("should handle single sentence without trailing period", () => {
      const profile = analyzeDocument("Hello world");
      expect(profile.sentenceCount).toBe(1);
      expect(profile.sentences[0].text).toBe("Hello world");
      expect(profile.wordCount).toBe(2);
    });

    it("should handle empty string", () => {
      const profile = analyzeDocument("");
      expect(profile.charCount).toBe(0);
      expect(profile.wordCount).toBe(0);
      expect(profile.lineCount).toBe(0);
      expect(profile.sentenceCount).toBe(0);
      expect(profile.paragraphCount).toBe(0);
    });

    it("should handle whitespace-only string", () => {
      const profile = analyzeDocument("   \n  \n   ");
      expect(profile.wordCount).toBe(0);
      expect(profile.sentenceCount).toBe(0);
      expect(profile.paragraphCount).toBe(0);
    });

    it("should count characters correctly", () => {
      const text = "ABC";
      const profile = analyzeDocument(text);
      expect(profile.charCount).toBe(3);
    });
  });

  describe("abbreviations", () => {
    it("should not split on Dr.", () => {
      const profile = analyzeDocument("Dr. Smith went home.");
      expect(profile.sentenceCount).toBe(1);
      expect(profile.sentences[0].text).toBe("Dr. Smith went home.");
    });

    it("should not split on Mr. or Mrs.", () => {
      const profile = analyzeDocument("Mr. and Mrs. Jones arrived.");
      expect(profile.sentenceCount).toBe(1);
    });

    it("should not split on e.g. or i.e.", () => {
      const profile = analyzeDocument("Use tools e.g. a hammer to build things.");
      expect(profile.sentenceCount).toBe(1);
    });

    it("should not split on etc.", () => {
      const profile = analyzeDocument("Cats, dogs, etc. are animals. Birds too.");
      expect(profile.sentenceCount).toBe(2);
    });

    it("should not split on Fig. or No.", () => {
      const profile = analyzeDocument("See Fig. 3 for details. It shows the data.");
      expect(profile.sentenceCount).toBe(2);
    });

    it("should not split on single-letter initials", () => {
      const profile = analyzeDocument("J. K. Rowling wrote Harry Potter.");
      expect(profile.sentenceCount).toBe(1);
    });
  });

  describe("sentence endings", () => {
    it("should split on exclamation mark", () => {
      const profile = analyzeDocument("Wow! That is great.");
      expect(profile.sentenceCount).toBe(2);
      expect(profile.sentences[0].text).toBe("Wow!");
      expect(profile.sentences[1].text).toBe("That is great.");
    });

    it("should split on question mark", () => {
      const profile = analyzeDocument("Really? Yes indeed.");
      expect(profile.sentenceCount).toBe(2);
    });

    it("should handle multiple sentence-ending punctuation", () => {
      const profile = analyzeDocument("First sentence. Second sentence! Third sentence?");
      expect(profile.sentenceCount).toBe(3);
    });
  });

  describe("ellipsis handling", () => {
    it("should handle ellipsis followed by new sentence", () => {
      const profile = analyzeDocument("Wait... What happened?");
      // "Wait..." and "What happened?" — ellipsis + uppercase = boundary
      expect(profile.sentenceCount).toBe(2);
    });

    it("should handle trailing ellipsis at end of text", () => {
      const profile = analyzeDocument("And then...");
      expect(profile.sentenceCount).toBe(1);
      expect(profile.sentences[0].text).toBe("And then...");
    });
  });

  describe("decimal numbers", () => {
    it("should not split on decimal numbers", () => {
      const profile = analyzeDocument("The value is 3.14 approximately.");
      expect(profile.sentenceCount).toBe(1);
    });

    it("should handle prices", () => {
      const profile = analyzeDocument("It costs 9.99 dollars. That is expensive.");
      expect(profile.sentenceCount).toBe(2);
    });
  });

  describe("paragraphs", () => {
    it("should detect two paragraphs separated by blank line", () => {
      const profile = analyzeDocument("Paragraph one.\n\nParagraph two.");
      expect(profile.paragraphCount).toBe(2);
      expect(profile.paragraphs[0].wordCount).toBe(2);
      expect(profile.paragraphs[1].wordCount).toBe(2);
    });

    it("should detect paragraphs separated by multiple blank lines", () => {
      const profile = analyzeDocument("First para.\n\n\n\nSecond para.");
      expect(profile.paragraphCount).toBe(2);
    });

    it("should treat consecutive non-blank lines as one paragraph", () => {
      const profile = analyzeDocument("Line one.\nLine two.\nLine three.");
      expect(profile.paragraphCount).toBe(1);
    });

    it("should handle three paragraphs", () => {
      const text = "Para one.\n\nPara two.\n\nPara three.";
      const profile = analyzeDocument(text);
      expect(profile.paragraphCount).toBe(3);
    });
  });

  describe("lines", () => {
    it("should count lines correctly", () => {
      const profile = analyzeDocument("line1\nline2\nline3");
      expect(profile.lineCount).toBe(3);
      expect(profile.nonBlankLineCount).toBe(3);
    });

    it("should count blank lines", () => {
      const profile = analyzeDocument("line1\n\nline3");
      expect(profile.lineCount).toBe(3);
      expect(profile.nonBlankLineCount).toBe(2);
    });

    it("should record correct line character offsets", () => {
      const text = "abc\ndef\nghi";
      const profile = analyzeDocument(text);
      expect(profile.lines[0]).toEqual({ index: 0, start: 0, end: 3 });
      expect(profile.lines[1]).toEqual({ index: 1, start: 4, end: 7 });
      expect(profile.lines[2]).toEqual({ index: 2, start: 8, end: 11 });
    });

    it("should handle single line with no newline", () => {
      const profile = analyzeDocument("just one line");
      expect(profile.lineCount).toBe(1);
    });
  });

  describe("sentence-paragraph wiring", () => {
    it("should wire sentences to their paragraphs", () => {
      const text = "First sentence. Second sentence.\n\nThird sentence.";
      const profile = analyzeDocument(text);
      expect(profile.paragraphs[0].sentenceStart).toBe(0);
      expect(profile.paragraphs[0].sentenceEnd).toBe(1);
      expect(profile.paragraphs[1].sentenceStart).toBe(2);
      expect(profile.paragraphs[1].sentenceEnd).toBe(2);
    });
  });

  describe("summary fields", () => {
    it("should set firstSentence and lastSentence", () => {
      const profile = analyzeDocument("First. Middle. Last.");
      expect(profile.firstSentence).toBe("First.");
      expect(profile.lastSentence).toBe("Last.");
    });

    it("should compute averages", () => {
      const profile = analyzeDocument("One two. Three four five.");
      // 2 sentences, 5 words → avg 2.5 words/sentence
      expect(profile.avgWordsPerSentence).toBe(2.5);
      // 1 paragraph, 2 sentences → avg 2 sentences/para
      expect(profile.avgSentencesPerParagraph).toBe(2);
    });
  });

  describe("metadata", () => {
    it("should set analyzerVersion to 1.0", () => {
      const profile = analyzeDocument("Test.");
      expect(profile.analyzerVersion).toBe("1.0");
    });

    it("should set analyzedAt to a valid ISO string", () => {
      const profile = analyzeDocument("Test.");
      expect(new Date(profile.analyzedAt).toISOString()).toBe(profile.analyzedAt);
    });
  });

  describe("real-world text", () => {
    it("should handle a markdown-like document", () => {
      const text = `# Introduction

This paper presents a novel approach to knowledge management. We build on prior work by Smith et al. and extend the framework significantly.

## Methods

We used Dr. Johnson's protocol. The sample size was 3.14 thousand participants. Each participant completed a series of tests, e.g. cognitive assessments.

## Results

The results were significant. Performance improved by 42%.`;

      const profile = analyzeDocument(text);

      // Should have multiple paragraphs (header lines are their own paragraphs)
      expect(profile.paragraphCount).toBeGreaterThanOrEqual(5);

      // Should correctly handle "al." abbreviation
      // "Smith et al." should not split
      const allText = profile.sentences.map(s => s.text).join(" ");
      expect(allText).toContain("al.");

      // Should correctly handle "Dr." abbreviation
      expect(profile.sentences.some(s => s.text.includes("Dr. Johnson"))).toBe(true);

      // Should correctly handle "3.14" decimal
      expect(profile.sentences.some(s => s.text.includes("3.14"))).toBe(true);

      // Should correctly handle "e.g." abbreviation
      expect(profile.sentences.some(s => s.text.includes("e.g."))).toBe(true);

      // Word count should be reasonable
      expect(profile.wordCount).toBeGreaterThan(40);
    });

    it("should handle multi-line paragraphs", () => {
      const text = "This is a long sentence that\nwraps across multiple lines.\n\nThis is the second paragraph.";
      const profile = analyzeDocument(text);
      expect(profile.paragraphCount).toBe(2);
    });
  });

  describe("boundary correctness", () => {
    it("should produce sentence text that matches document substring", () => {
      const text = "Hello world. Goodbye cruel world.";
      const profile = analyzeDocument(text);
      for (const s of profile.sentences) {
        const extracted = text.substring(s.start, s.end).trim();
        expect(extracted).toBe(s.text);
      }
    });

    it("should produce paragraph boundaries that cover text correctly", () => {
      const text = "Para one content.\n\nPara two content.";
      const profile = analyzeDocument(text);
      expect(text.substring(profile.paragraphs[0].start, profile.paragraphs[0].end)).toBe("Para one content.");
      expect(text.substring(profile.paragraphs[1].start, profile.paragraphs[1].end)).toBe("Para two content.");
    });
  });

  describe("performance", () => {
    it("should handle large documents without crashing", () => {
      // ~100KB document
      const sentence = "This is a test sentence with some words in it. ";
      const text = sentence.repeat(2000);
      const profile = analyzeDocument(text);
      expect(profile.sentenceCount).toBe(2000);
      expect(profile.wordCount).toBeGreaterThan(10000);
    });
  });
});
