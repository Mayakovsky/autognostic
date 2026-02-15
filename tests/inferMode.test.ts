import { describe, it, expect } from "vitest";
import { inferMode, parseNumber } from "../src/actions/getQuoteAction";

describe("parseNumber", () => {
  it("parses cardinal words", () => {
    expect(parseNumber("one")).toBe(1);
    expect(parseNumber("five")).toBe(5);
    expect(parseNumber("twenty")).toBe(20);
  });

  it("parses ordinal words", () => {
    expect(parseNumber("first")).toBe(1);
    expect(parseNumber("third")).toBe(3);
    expect(parseNumber("twentieth")).toBe(20);
  });

  it("parses ordinal suffixes", () => {
    expect(parseNumber("1st")).toBe(1);
    expect(parseNumber("2nd")).toBe(2);
    expect(parseNumber("3rd")).toBe(3);
    expect(parseNumber("21st")).toBe(21);
    expect(parseNumber("42nd")).toBe(42);
  });

  it("parses digit strings", () => {
    expect(parseNumber("3")).toBe(3);
    expect(parseNumber("42")).toBe(42);
  });
});

describe("inferMode — Section 12 test matrix", () => {
  // Stats
  it.each([
    ["how many words", "stats"],
    ["how long is it", "stats"],
    ["count the words", "stats"],
    ["word count", "stats"],
    ["length of the document", "stats"],
  ])('"%s" → %s', (input, mode) => {
    expect(inferMode(input).mode).toBe(mode);
  });

  // Last N
  it.each([
    ["last two sentences", "last_n", { count: 2, unit: "sentence" }],
    ["last 5 lines", "last_n", { count: 5, unit: "line" }],
  ])('"%s" → %s', (input, mode, params) => {
    const result = inferMode(input);
    expect(result.mode).toBe(mode);
    expect(result.count).toBe(params.count);
    expect(result.unit).toBe(params.unit);
  });

  // First N
  it.each([
    ["first three paragraphs", "first_n", { count: 3, unit: "paragraph" }],
    ["first 10 words", "first_n", { count: 10, unit: "word" }],
  ])('"%s" → %s', (input, mode, params) => {
    const result = inferMode(input);
    expect(result.mode).toBe(mode);
    expect(result.count).toBe(params.count);
    expect(result.unit).toBe(params.unit);
  });

  // Nth (ordinal + unit)
  it.each([
    ["the third paragraph", "nth", { count: 3, unit: "paragraph" }],
    ["fifth sentence", "nth", { count: 5, unit: "sentence" }],
    ["2nd line", "nth", { count: 2, unit: "line" }],
  ])('"%s" → %s', (input, mode, params) => {
    const result = inferMode(input);
    expect(result.mode).toBe(mode);
    expect(result.count).toBe(params.count);
    expect(result.unit).toBe(params.unit);
  });

  // Nth (unit + number, reversed)
  it.each([
    ["sentence five", "nth", { count: 5, unit: "sentence" }],
    ["paragraph three", "nth", { count: 3, unit: "paragraph" }],
    ["line twenty", "nth", { count: 20, unit: "line" }],
  ])('"%s" → %s', (input, mode, params) => {
    const result = inferMode(input);
    expect(result.mode).toBe(mode);
    expect(result.count).toBe(params.count);
    expect(result.unit).toBe(params.unit);
  });

  // Paragraph N
  it.each([
    ["paragraph 3", "paragraph", { count: 3 }],
    ["para 7", "paragraph", { count: 7 }],
  ])('"%s" → %s', (input, mode, params) => {
    const result = inferMode(input);
    expect(result.mode).toBe(mode);
    expect(result.count).toBe(params.count);
  });

  // First/Last paragraph
  it("first paragraph → first_paragraph", () => {
    expect(inferMode("first paragraph").mode).toBe("first_paragraph");
  });
  it("the opening → first_paragraph", () => {
    expect(inferMode("the opening").mode).toBe("first_paragraph");
  });
  it("beginning of the document → first_paragraph", () => {
    expect(inferMode("beginning of the document").mode).toBe("first_paragraph");
  });
  it("last paragraph → last_paragraph", () => {
    expect(inferMode("last paragraph").mode).toBe("last_paragraph");
  });
  it("the conclusion → last_paragraph", () => {
    expect(inferMode("the conclusion").mode).toBe("last_paragraph");
  });

  // Implicit end/start
  it("how does it end → implicit_end", () => {
    expect(inferMode("how does it end").mode).toBe("implicit_end");
  });
  it("how does it start → implicit_start", () => {
    expect(inferMode("how does it start").mode).toBe("implicit_start");
  });
  it("what's the opening → implicit_start", () => {
    expect(inferMode("what's the opening").mode).toBe("implicit_start");
  });
  it("what's the conclusion → implicit_end", () => {
    expect(inferMode("what's the conclusion").mode).toBe("implicit_end");
  });

  // Ranges
  it("lines 5 to 10 → range", () => {
    const result = inferMode("lines 5 to 10");
    expect(result.mode).toBe("range");
    expect(result.lineNumber).toBe(5);
    expect(result.lineEnd).toBe(10);
  });
  it("from line 5 to the end → range (open-ended)", () => {
    const result = inferMode("from line 5 to the end");
    expect(result.mode).toBe("range");
    expect(result.lineNumber).toBe(5);
    expect(result.lineEnd).toBe(999999);
  });
  it("everything after line 10 → range", () => {
    const result = inferMode("everything after line 10");
    expect(result.mode).toBe("range");
    expect(result.lineNumber).toBe(11);
    expect(result.lineEnd).toBe(999999);
  });
  it("sentences 3 through 7 → sentence_range", () => {
    const result = inferMode("sentences 3 through 7");
    expect(result.mode).toBe("sentence_range");
    expect(result.lineNumber).toBe(3);
    expect(result.lineEnd).toBe(7);
  });
  it("paragraphs 2 to 4 → paragraph_range", () => {
    const result = inferMode("paragraphs 2 to 4");
    expect(result.mode).toBe("paragraph_range");
    expect(result.lineNumber).toBe(2);
    expect(result.lineEnd).toBe(4);
  });
  it("everything after paragraph 2 → paragraph_range", () => {
    const result = inferMode("everything after paragraph 2");
    expect(result.mode).toBe("paragraph_range");
    expect(result.lineNumber).toBe(3);
    expect(result.lineEnd).toBe(999999);
  });

  // Full
  it.each([
    ["full document", "full"],
    ["read it all", "full"],
    ["entire thing", "full"],
  ])('"%s" → %s', (input, mode) => {
    expect(inferMode(input).mode).toBe(mode);
  });

  // Line
  it("line 5 → line", () => {
    const result = inferMode("line 5");
    expect(result.mode).toBe("line");
    expect(result.lineNumber).toBe(5);
  });
  it("what's on line 12 → line", () => {
    const result = inferMode("what's on line 12");
    expect(result.mode).toBe("line");
    expect(result.lineNumber).toBe(12);
  });
  it("go to line 20 → line", () => {
    const result = inferMode("go to line 20");
    expect(result.mode).toBe("line");
    expect(result.lineNumber).toBe(20);
  });

  // Search
  it("what does it say about neural networks → search", () => {
    const result = inferMode("what does it say about neural networks");
    expect(result.mode).toBe("search");
    expect(result.searchText).toBe("neural networks");
  });
  it("find the part about methodology → search", () => {
    const result = inferMode("find the part about methodology");
    expect(result.mode).toBe("search");
    expect(result.searchText).toBe("methodology");
  });
  it("is transformers mentioned → search", () => {
    const result = inferMode("is transformers mentioned");
    expect(result.mode).toBe("search");
    expect(result.searchText).toContain("transformers");
  });
  it("does it talk about scaling → search", () => {
    const result = inferMode("does it talk about scaling");
    expect(result.mode).toBe("search");
    expect(result.searchText).toContain("scaling");
  });

  // Search all (multi-match)
  it("every mention of data → search_all", () => {
    const result = inferMode("every mention of data");
    expect(result.mode).toBe("search_all");
    expect(result.searchText).toBe("data");
  });
  it("all occurrences of 'network' → search_all", () => {
    const result = inferMode("all occurrences of 'network'");
    expect(result.mode).toBe("search_all");
    expect(result.searchText).toBe("network");
  });

  // Single last/first unit
  it("last line → last_n count=1", () => {
    const result = inferMode("last line");
    expect(result.mode).toBe("last_n");
    expect(result.count).toBe(1);
    expect(result.unit).toBe("line");
  });
  it("final sentence → last_n count=1", () => {
    const result = inferMode("final sentence");
    expect(result.mode).toBe("last_n");
    expect(result.count).toBe(1);
    expect(result.unit).toBe("sentence");
  });
  it("penultimate paragraph → last_n count=2", () => {
    const result = inferMode("penultimate paragraph");
    expect(result.mode).toBe("last_n");
    expect(result.count).toBe(2);
    expect(result.unit).toBe("paragraph");
  });
  it("next to last sentence → last_n count=2", () => {
    const result = inferMode("next to last sentence");
    expect(result.mode).toBe("last_n");
    expect(result.count).toBe(2);
    expect(result.unit).toBe("sentence");
  });

  // Reading / tell me
  it("read it to me → full", () => {
    expect(inferMode("read it to me").mode).toBe("full");
  });
  it("tell me about the document → stats", () => {
    expect(inferMode("tell me about the document").mode).toBe("stats");
  });
});
