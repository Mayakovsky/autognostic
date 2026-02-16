import { describe, it, expect } from "vitest";
import {
  detectPhrases,
  detectClauses,
  countPhrases,
  countClauses,
} from "../src/services/GrammarEngine";
import type { SentenceBoundary } from "../src/services/DocumentAnalyzer.types";

function makeSentence(text: string, index = 0): SentenceBoundary {
  return { index, start: 0, end: text.length, lineNumber: 1, wordCount: text.split(/\s+/).length, text };
}

describe("GrammarEngine", () => {
  describe("detectPhrases", () => {
    it("returns single phrase for simple sentence", () => {
      const phrases = detectPhrases("The cat sat on the mat", 0);
      expect(phrases).toHaveLength(1);
      expect(phrases[0].text).toBe("The cat sat on the mat");
    });

    it("splits on commas", () => {
      const phrases = detectPhrases("One, two, three", 0);
      expect(phrases).toHaveLength(3);
      expect(phrases[0].text).toBe("One");
      expect(phrases[1].text).toBe("two");
      expect(phrases[2].text).toBe("three");
    });

    it("splits on semicolons", () => {
      const phrases = detectPhrases("First part; second part", 0);
      expect(phrases).toHaveLength(2);
      expect(phrases[0].text).toBe("First part");
      expect(phrases[1].text).toBe("second part");
    });

    it("splits on colons", () => {
      const phrases = detectPhrases("Here it is: the answer", 0);
      expect(phrases).toHaveLength(2);
    });

    it("splits on em-dashes", () => {
      const phrases = detectPhrases("The result\u2014a surprise\u2014was clear", 0);
      expect(phrases).toHaveLength(3);
    });

    it("does not split commas between digits", () => {
      const phrases = detectPhrases("The value is 1,000 dollars", 0);
      expect(phrases).toHaveLength(1);
    });

    it("does not split inside parentheses", () => {
      const phrases = detectPhrases("The method (first, second, third) worked", 0);
      expect(phrases).toHaveLength(1);
    });

    it("does not split inside quotes", () => {
      const phrases = detectPhrases('He said "hello, world" to them', 0);
      expect(phrases).toHaveLength(1);
    });

    it("assigns correct sentenceIndex", () => {
      const phrases = detectPhrases("a, b", 5);
      expect(phrases[0].sentenceIndex).toBe(5);
      expect(phrases[1].sentenceIndex).toBe(5);
    });
  });

  describe("detectClauses", () => {
    it("returns single clause for simple sentence", () => {
      const clauses = detectClauses("The cat sat on the mat", 0);
      expect(clauses).toHaveLength(1);
      expect(clauses[0].type).toBe("independent");
    });

    it("detects dependent clause with 'because'", () => {
      const clauses = detectClauses("I stayed home because it was raining", 0);
      expect(clauses.length).toBeGreaterThanOrEqual(2);
      const dep = clauses.find(c => c.type === "dependent");
      expect(dep).toBeDefined();
      expect(dep!.text).toMatch(/because/i);
    });

    it("detects dependent clause with 'although'", () => {
      const clauses = detectClauses("Although it rained, we went outside", 0);
      expect(clauses.length).toBeGreaterThanOrEqual(2);
      expect(clauses[0].type).toBe("dependent");
    });

    it("splits coordinating conjunction after comma", () => {
      const clauses = detectClauses("I ran fast, but I still lost", 0);
      expect(clauses.length).toBeGreaterThanOrEqual(2);
    });

    it("requires >= 2 words per clause", () => {
      const clauses = detectClauses("Go because reasons apply", 0);
      // Each clause should have >= 2 words
      for (const c of clauses) {
        expect(c.wordCount).toBeGreaterThanOrEqual(2);
      }
    });
  });

  describe("countPhrases / countClauses", () => {
    it("counts phrases across multiple sentences", () => {
      const sentences = [
        makeSentence("One, two, three", 0),
        makeSentence("Simple sentence", 1),
      ];
      expect(countPhrases(sentences)).toBe(4); // 3 + 1
    });

    it("counts clauses across multiple sentences", () => {
      const sentences = [
        makeSentence("I ran because it rained", 0),
        makeSentence("The sun shone", 1),
      ];
      const count = countClauses(sentences);
      expect(count).toBeGreaterThanOrEqual(3); // 2 + 1
    });
  });
});
