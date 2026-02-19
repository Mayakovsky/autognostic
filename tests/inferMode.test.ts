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
  // Specific stats (single unit)
  it.each([
    ["how many words", "stat_specific", { unit: "word" }],
    ["count the words", "stat_specific", { unit: "word" }],
    ["word count", "stat_specific", { unit: "word" }],
    ["how many sentences", "stat_specific", { unit: "sentence" }],
    ["sentence count", "stat_specific", { unit: "sentence" }],
    ["how many lines", "stat_specific", { unit: "line" }],
    ["line count", "stat_specific", { unit: "line" }],
    ["count the paragraphs", "stat_specific", { unit: "paragraph" }],
    ["paragraph count", "stat_specific", { unit: "paragraph" }],
    ["how many characters", "stat_specific", { unit: "character" }],
    ["character count", "stat_specific", { unit: "character" }],
    ["number of words", "stat_specific", { unit: "word" }],
    ["total lines", "stat_specific", { unit: "line" }],
  ])('"%s" → %s unit=%s', (input, mode, params) => {
    const result = inferMode(input);
    expect(result.mode).toBe(mode);
    expect(result.unit).toBe((params as { unit: string }).unit);
  });

  // Full stats overview
  it.each([
    ["how long is it", "stats"],
    ["length of the document", "stats"],
    ["give me the stats", "stats"],
    ["statistics", "stats"],
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
    expect(result.count).toBe((params as { count: number }).count);
    expect(result.unit).toBe((params as { unit: string }).unit);
  });

  // First N
  it.each([
    ["first three paragraphs", "first_n", { count: 3, unit: "paragraph" }],
    ["first 10 words", "first_n", { count: 10, unit: "word" }],
  ])('"%s" → %s', (input, mode, params) => {
    const result = inferMode(input);
    expect(result.mode).toBe(mode);
    expect(result.count).toBe((params as { count: number }).count);
    expect(result.unit).toBe((params as { unit: string }).unit);
  });

  // Nth (ordinal + unit)
  it.each([
    ["the third paragraph", "nth", { count: 3, unit: "paragraph" }],
    ["fifth sentence", "nth", { count: 5, unit: "sentence" }],
    ["2nd line", "nth", { count: 2, unit: "line" }],
  ])('"%s" → %s', (input, mode, params) => {
    const result = inferMode(input);
    expect(result.mode).toBe(mode);
    expect(result.count).toBe((params as { count: number }).count);
    expect(result.unit).toBe((params as { unit: string }).unit);
  });

  // Nth reversed (unit + number)
  it.each([
    ["sentence five", "nth", { count: 5, unit: "sentence" }],
    ["paragraph three", "nth", { count: 3, unit: "paragraph" }],
    ["line twenty", "nth", { count: 20, unit: "line" }],
  ])('"%s" → %s', (input, mode, params) => {
    const result = inferMode(input);
    expect(result.mode).toBe(mode);
    expect(result.count).toBe((params as { count: number }).count);
    expect(result.unit).toBe((params as { unit: string }).unit);
  });

  // Paragraph by number
  it.each([
    ["paragraph 3", "paragraph"],
    ["para 7", "paragraph"],
  ])('"%s" → %s', (input, mode) => {
    expect(inferMode(input).mode).toBe(mode);
  });

  // First/last paragraph
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
  it("the conclusion → section", () => {
    const result = inferMode("the conclusion");
    expect(result.mode).toBe("section");
    expect(result.sectionName).toBe("conclusion");
  });

  // Implicit start/end
  it("how does it end → implicit_end", () => {
    expect(inferMode("how does it end").mode).toBe("implicit_end");
  });
  it("how does it start → implicit_start", () => {
    expect(inferMode("how does it start").mode).toBe("implicit_start");
  });
  it("what's the opening → implicit_start", () => {
    expect(inferMode("what's the opening").mode).toBe("implicit_start");
  });
  it("what's the conclusion → section", () => {
    const result = inferMode("what's the conclusion");
    expect(result.mode).toBe("section");
    expect(result.sectionName).toBe("conclusion");
  });

  // Ranges
  it("lines 5 to 10 → range", () => {
    const r = inferMode("lines 5 to 10");
    expect(r.mode).toBe("range");
    expect(r.lineNumber).toBe(5);
    expect(r.lineEnd).toBe(10);
  });
  it("from line 5 to the end → range (open-ended)", () => {
    const r = inferMode("from line 5 to the end");
    expect(r.mode).toBe("range");
    expect(r.lineNumber).toBe(5);
  });
  it("everything after line 10 → range", () => {
    const r = inferMode("everything after line 10");
    expect(r.mode).toBe("range");
    expect(r.lineNumber).toBe(11);
  });
  it("sentences 3 through 7 → sentence_range", () => {
    const r = inferMode("sentences 3 through 7");
    expect(r.mode).toBe("sentence_range");
    expect(r.lineNumber).toBe(3);
    expect(r.lineEnd).toBe(7);
  });
  it("paragraphs 2 to 4 → paragraph_range", () => {
    const r = inferMode("paragraphs 2 to 4");
    expect(r.mode).toBe("paragraph_range");
    expect(r.lineNumber).toBe(2);
    expect(r.lineEnd).toBe(4);
  });
  it("everything after paragraph 2 → paragraph_range", () => {
    const r = inferMode("everything after paragraph 2");
    expect(r.mode).toBe("paragraph_range");
    expect(r.lineNumber).toBe(3);
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
  it.each([
    ["line 5", "line"],
    ["what's on line 12", "line"],
    ["go to line 20", "line"],
  ])('%s → %s', (input, mode) => {
    expect(inferMode(input).mode).toBe(mode);
  });

  // Search
  it.each([
    ["what does it say about neural networks", "search"],
    ["find the part about methodology", "search"],
    ["is transformers mentioned", "search"],
    ["does it talk about scaling", "search"],
  ])('%s → %s', (input, mode) => {
    expect(inferMode(input).mode).toBe(mode);
  });

  // Search all
  it.each([
    ["every mention of data", "search_all"],
    ["all occurrences of 'network'", "search_all"],
  ])('%s → %s', (input, mode) => {
    expect(inferMode(input).mode).toBe(mode);
  });

  // Last/final single unit, penultimate
  it("last line → last_n count=1", () => {
    const r = inferMode("last line");
    expect(r.mode).toBe("last_n");
    expect(r.count).toBe(1);
    expect(r.unit).toBe("line");
  });
  it("final sentence → last_n count=1", () => {
    const r = inferMode("final sentence");
    expect(r.mode).toBe("last_n");
    expect(r.count).toBe(1);
    expect(r.unit).toBe("sentence");
  });
  it("penultimate paragraph → last_n count=2", () => {
    const r = inferMode("penultimate paragraph");
    expect(r.mode).toBe("last_n");
    expect(r.count).toBe(2);
    expect(r.unit).toBe("paragraph");
  });
  it("next to last sentence → last_n count=2", () => {
    const r = inferMode("next to last sentence");
    expect(r.mode).toBe("last_n");
    expect(r.count).toBe(2);
    expect(r.unit).toBe("sentence");
  });

  // Read it / tell me about
  it("read it to me → full", () => {
    expect(inferMode("read it to me").mode).toBe("full");
  });
  it("tell me about the document → stats", () => {
    expect(inferMode("tell me about the document").mode).toBe("stats");
  });

  // --- Section routing (P5.5) ---
  it("show me the abstract → section(abstract)", () => {
    const r = inferMode("show me the abstract");
    expect(r.mode).toBe("section");
    expect(r.sectionName).toBe("abstract");
  });
  it("show me the summary → section(abstract)", () => {
    const r = inferMode("show me the summary");
    expect(r.mode).toBe("section");
    expect(r.sectionName).toBe("abstract");
  });
  it("give me the overview → section(abstract)", () => {
    const r = inferMode("give me the overview");
    expect(r.mode).toBe("section");
    expect(r.sectionName).toBe("abstract");
  });
  it("read the methods → section(methods)", () => {
    const r = inferMode("read the methods");
    expect(r.mode).toBe("section");
    expect(r.sectionName).toBe("methods");
  });
  it("what's in the introduction → section(introduction)", () => {
    const r = inferMode("what's in the introduction");
    expect(r.mode).toBe("section");
    expect(r.sectionName).toBe("introduction");
  });
  it("the discussion → section(discussion)", () => {
    const r = inferMode("the discussion");
    expect(r.mode).toBe("section");
    expect(r.sectionName).toBe("discussion");
  });
  it("show me the results section → section(results)", () => {
    const r = inferMode("show me the results section");
    expect(r.mode).toBe("section");
    expect(r.sectionName).toBe("results");
  });
  it("the references → section(references)", () => {
    const r = inferMode("the references");
    expect(r.mode).toBe("section");
    expect(r.sectionName).toBe("references");
  });

  // --- Section list ---
  it("list the sections → section_list", () => {
    expect(inferMode("list the sections").mode).toBe("section_list");
  });
  it("what sections does it have → section_list", () => {
    expect(inferMode("what sections does it have").mode).toBe("section_list");
  });

  // --- Compound requests ---
  it("first and third sentences → compound", () => {
    const r = inferMode("first and third sentences");
    expect(r.mode).toBe("compound");
    expect(r.parts).toHaveLength(2);
    expect(r.parts![0].count).toBe(1);
    expect(r.parts![1].count).toBe(3);
    expect(r.unit).toBe("sentence");
  });
  it("second and fifth paragraphs → compound", () => {
    const r = inferMode("second and fifth paragraphs");
    expect(r.mode).toBe("compound");
    expect(r.parts).toHaveLength(2);
    expect(r.parts![0].count).toBe(2);
    expect(r.parts![1].count).toBe(5);
  });

  // --- Keyword counting (countOnly) ---
  it("how many times does 'data' appear → search_all countOnly", () => {
    const r = inferMode("how many times does 'data' appear");
    expect(r.mode).toBe("search_all");
    expect(r.countOnly).toBe(true);
    expect(r.searchText).toBe("data");
  });
  it("how many times does the word neural appear → search_all countOnly", () => {
    const r = inferMode("how many times does the word neural appear");
    expect(r.mode).toBe("search_all");
    expect(r.countOnly).toBe(true);
    expect(r.searchText).toContain("neural");
  });

  // --- Nth mode: CRITICAL — must never fall through to full-doc dump ---
  it("third sentence → nth (returns only that sentence)", () => {
    const r = inferMode("third sentence");
    expect(r.mode).toBe("nth");
    expect(r.count).toBe(3);
    expect(r.unit).toBe("sentence");
  });
  it("5th paragraph → nth", () => {
    const r = inferMode("5th paragraph");
    expect(r.mode).toBe("nth");
    expect(r.count).toBe(5);
    expect(r.unit).toBe("paragraph");
  });
  it("second line → nth", () => {
    const r = inferMode("second line");
    expect(r.mode).toBe("nth");
    expect(r.count).toBe(2);
    expect(r.unit).toBe("line");
  });

  // --- P7 no longer catches "conclusion" ---
  it("last paragraph → last_paragraph (not section)", () => {
    expect(inferMode("last paragraph").mode).toBe("last_paragraph");
  });
  it("ending → last_paragraph", () => {
    expect(inferMode("ending").mode).toBe("last_paragraph");
  });
});
