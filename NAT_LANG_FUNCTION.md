# NAT_LANG_FUNCTION.md — Natural Language Retrieval Specification
# plugin-autognostic / GET_EXACT_QUOTE
# =====================================================================
#
# This document is the authoritative specification for all natural language
# retrieval capabilities in GET_EXACT_QUOTE. It combines the gap analysis
# from GET_EXACT_QUOTE_ANALYSIS.md with full implementation specifications
# for every expansion. All items are standard functionality, not optional.
#
# TARGET FILES:
#   src/actions/getQuoteAction.ts    — validate, inferMode, handler
#   src/integration/getExactQuote.ts — search functions
#   src/providers/fullDocumentProvider.ts — inventory/routing hints
#   src/character.ts (in autognostic-agent) — system prompt & examples
#
# =====================================================================

## 1. ARCHITECTURE OVERVIEW

All natural language document retrieval flows through one action:

```
User message
    |
    v
validate()        — "Is this a document retrieval request?"
    |                 Returns boolean. Must be GENEROUS — false negatives
    |                 mean the LLM never even considers this action.
    v
LLM selection     — ElizaOS LLM reads description + examples, picks action.
    |                 Our levers: description, similes, examples, character prompt.
    v
inferMode()       — "What exactly does the user want?"
    |                 Parses natural language into structured { mode, count, unit, ... }
    |                 Ordered regex cascade. First match wins.
    v
handler switch    — "Execute the extraction."
    |                 Uses DocumentProfile boundaries for O(1) lookups.
    v
respond()         — Calls callback, returns ActionResult.
```

## 2. COMPLETE MODE CATALOG

After expansion, GET_EXACT_QUOTE supports these modes:

| Mode | Example Input | Output |
|------|--------------|--------|
| stats | "how many words" / "how long is it" / "count the words" | Word, sentence, paragraph, line, char counts |
| last_n | "last two sentences" / "last 5 lines" | Last N units |
| first_n | "first three paragraphs" / "first 10 words" | First N units |
| nth | "the third paragraph" / "sentence five" / "2nd line" | Specific Nth unit |
| paragraph | "paragraph 3" / "para 7" | Specific paragraph by number |
| first_paragraph | "first paragraph" / "the opening" / "beginning" | First paragraph |
| last_paragraph | "last paragraph" / "the ending" / "conclusion" / "how does it end" | Last paragraph |
| range | "lines 5 to 10" / "from line 5 to the end" | Line range |
| sentence_range | "sentences 3 through 7" | Sentence range |
| paragraph_range | "paragraphs 2 to 4" | Paragraph range |
| full | "full document" / "read it all" / "entire thing" | Full content (truncated at 5000) |
| line | "line 5" / "what's on line 12" | Single line by number |
| search | "what does it say about X" / "find X" / "is X mentioned" | Case-insensitive search with context |
| search_all | "every mention of X" / "all occurrences of X" | All matches with line numbers |
| implicit_start | "how does it start" / "what's the opening" | First 3 sentences |
| implicit_end | "how does it end" / "what's the conclusion" | Last 3 sentences |

Units for last_n / first_n: sentence, paragraph, word, line

## 3. PARSENUMBER — NUMBER RESOLUTION

The current `parseCount` function must be expanded and renamed to `parseNumber`.
It must handle all of:

### 3a. Cardinal Words
```
one=1, two=2, three=3, four=4, five=5, six=6, seven=7, eight=8,
nine=9, ten=10, eleven=11, twelve=12, thirteen=13, fourteen=14,
fifteen=15, sixteen=16, seventeen=17, eighteen=18, nineteen=19,
twenty=20, thirty=30, forty=40, fifty=50, hundred=100
```

### 3b. Ordinal Words to Number
```
first=1, second=2, third=3, fourth=4, fifth=5, sixth=6, seventh=7,
eighth=8, ninth=9, tenth=10, eleventh=11, twelfth=12, thirteenth=13,
fourteenth=14, fifteenth=15, sixteenth=16, seventeenth=17,
eighteenth=18, nineteenth=19, twentieth=20, thirtieth=30
```

### 3c. Ordinal Suffixes to Number
```
1st=1, 2nd=2, 3rd=3, 4th=4, 5th=5, ... 21st=21, 22nd=22, 23rd=23, etc.
Regex: /^(\d+)(?:st|nd|rd|th)$/i -> parseInt($1)
```

### 3d. Digit Strings
```
"3" -> 3, "42" -> 42
```

## 4. INFERMODE — COMPLETE DETECTION CASCADE

Below is the full ordered cascade. Each entry shows the regex pattern(s),
the mode it resolves to, and the parameters it extracts. Order matters —
first match wins.

```
PRIORITY  PATTERN                                               MODE              PARAMS
--------  ------                                                --------          ------
 1        /how\s+many\s+(words?|lines?|sentences?|paragraphs?)/ stats
          /word\s+count/
          /\bstatistics?\b|\bstats\b/
          /count\s+the\s+(words?|lines?|sentences?|paragraphs?)/
          /how\s+long\s+is/
          /\blength\b.*\b(?:document|doc|file|paper|it)\b/

 2        /last\s+(N)\s+(unit)/                                  last_n            count, unit
          N = digit or cardinal word (one-twenty)
          unit = sentences?|paragraphs?|words?|lines?

 3        /first\s+(N)\s+(unit)/                                 first_n           count, unit

 4        /(ordinal)\s+(unit)/                                   nth               count, unit
          ordinal = first|second|third|...|twentieth|1st|2nd|...
          unit = sentence|paragraph|line|word
          Example: "third paragraph", "5th sentence", "second line"

 5        /(unit)\s+(N|cardinal|ordinal)/                        nth               count, unit
          Reversed phrasing: "paragraph three", "sentence 5", "line twenty"
          unit must come FIRST, then number/word

 6        /paragraph\s+(\d+)/                                    paragraph         count
          /\bpara\s+(\d+)/

 7        /(last|final|ending)\s+paragraph/                      last_paragraph
          /\b(?:conclusion|ending|end\s+of)\b/                   last_paragraph

 8        /(first|opening|beginning|starting)\s+paragraph/       first_paragraph
          /\bopening\b/                                          first_paragraph
          /\bbeginning\s+of\b/                                   first_paragraph

 9        /how\s+does\s+it\s+end/                                implicit_end
          /what(?:'s|\s+is)\s+(?:the\s+)?(?:ending|conclusion)/  implicit_end

10        /how\s+does\s+it\s+(?:start|begin)/                    implicit_start
          /what(?:'s|\s+is)\s+(?:the\s+)?(?:opening|beginning)/  implicit_start

11        /sentences?\s+(\d+)\s+(?:to|through|thru|-)\s+(\d+)/   sentence_range    start, end

12        /paragraphs?\s+(\d+)\s+(?:to|through|thru|-)\s+(\d+)/  paragraph_range   start, end

13        /lines?\s+(\d+)\s+(?:to|through|thru|-)\s+(\d+)/       range             lineNumber, lineEnd

14        /from\s+line\s+(\d+)\s+to\s+(?:the\s+)?end/            range             lineNumber, lineEnd=MAX
          /lines?\s+(?:after|from)\s+(\d+)/                      range             lineNumber+1, lineEnd=MAX
          /everything\s+after\s+(?:line\s+)?(\d+)/               range             lineNumber+1, lineEnd=MAX
          /everything\s+after\s+paragraph\s+(\d+)/               paragraph_range   start=N+1, end=MAX

15        /\b(?:full|entire|whole)\b/                             full
          NOTE: "all" removed — too ambiguous. "read it all" handled separately.
          /read\s+it\s+all/                                      full

16        /\bline\s+(\d+)\b/                                     line              lineNumber
          /what(?:'s|\s+is)\s+on\s+line\s+(\d+)/                 line              lineNumber
          /(?:go|skip)\s+to\s+line\s+(\d+)/                      line              lineNumber

17        /(last|final|ending)\s+(line|sentence|word)/            last_n            count=1, unit
          /penultimate\s+(line|sentence|paragraph|word)/          last_n            count=2, unit
          /(?:next|second)\s+to\s+last\s+(line|sentence|...)/     last_n            count=2, unit

18        /(first|opening|beginning|starting)\s+(line|sentence|word)/  first_n      count=1, unit

19        /(?:what\s+does\s+it|what\s+do\s+they)\s+say\s+about\s+(.+)/   search    searchText=$1
          /(?:find|locate)\s+(?:the\s+)?(?:part|section)\s+about\s+(.+)/  search    searchText=$1
          /where\s+(?:does\s+it|is)\s+(?:mention|discuss|talk about)\s+(.+)/  search  searchText=$1
          /(?:is|does)\s+(?:it\s+)?(?:mention|discuss|reference|include)\s+(.+)/  search  searchText=$1
          /(?:does\s+it\s+)?talk\s+about\s+(.+)/                 search            searchText=$1
          /(?:find|search\s+for|look\s+for)\s+['"]?(.+?)['"]?$/  search            searchText=$1

20        /every\s+(?:mention|occurrence|instance)\s+of\s+(.+)/  search_all        searchText=$1
          /all\s+(?:mentions?|occurrences?|instances?)\s+of\s+(.+)/ search_all      searchText=$1

21        args.searchText provided                                search            searchText

22        /"([^"]+)"|'([^']+)'/                                   search            searchText=match

23        /read\s+it(?:\s+to\s+me|\s+back)?/                     full
          /tell\s+me\s+(?:about\s+)?(?:the\s+)?(?:document|doc|file|paper)/  stats

24        (no match)                                              "" -> fallback to full-doc dump
```

### 4a. Search Text Extraction Cleanup

When extracting searchText from natural language patterns (priorities 19-20),
clean the captured text:
- Strip trailing punctuation: `.?!`
- Strip leading/trailing quotes
- Strip filler tail: "in the document", "in the file", "in it"
- Trim whitespace

Regex for stripping tail:
```
searchText.replace(/\s+(?:in\s+)?(?:the\s+)?(?:document|doc|file|paper|it)\s*[.?!]*$/i, "").trim()
```

Example: "what does it say about neural networks in the document?"
-> searchText = "neural networks"

## 5. HANDLER EXPANSIONS

### 5a. New Mode: nth (specific Nth unit)

```typescript
if (inferred.mode === "nth") {
  const data = await getOrComputeProfile(runtime, url);
  const n = inferred.count ?? 1;
  const unit = inferred.unit ?? "sentence";

  if (unit === "sentence") {
    const sentence = data.profile.sentences[n - 1]; // 0-based
    if (!sentence) -> "Sentence N not found. Document has X sentences."
    return respond: `Sentence ${n} (line ${sentence.lineNumber}): "${sentence.text}"`;
  }
  if (unit === "paragraph") {
    // Reuse existing paragraph logic with count = n
    -> delegate to paragraph mode
  }
  if (unit === "line") {
    // Reuse existing line mode with lineNumber = n
    -> delegate to line mode
  }
  if (unit === "word") {
    const allWords = content.trim().split(/\s+/);
    const word = allWords[n - 1];
    if (!word) -> "Word N not found. Document has X words."
    return respond: `Word ${n}: "${word}"`;
  }
}
```

### 5b. New Mode: sentence_range

```typescript
if (inferred.mode === "sentence_range") {
  const data = await getOrComputeProfile(runtime, url);
  const start = (inferred.lineNumber ?? 1) - 1; // reuse lineNumber for start
  const end = (inferred.lineEnd ?? start + 1) - 1;
  const items = data.profile.sentences.slice(start, end + 1);
  if (items.length === 0) -> "Sentences X-Y not found."
  const formatted = items.map((s) =>
    `${s.index + 1}. "${s.text}" (line ${s.lineNumber})`
  ).join("\n");
  return respond: `Sentences ${start + 1}-${end + 1}:\n${formatted}`;
}
```

### 5c. New Mode: paragraph_range

```typescript
if (inferred.mode === "paragraph_range") {
  const data = await getOrComputeProfile(runtime, url);
  const start = (inferred.lineNumber ?? 1) - 1;
  const end = Math.min(
    (inferred.lineEnd ?? data.profile.paragraphCount) - 1,
    data.profile.paragraphCount - 1
  );
  const items = data.profile.paragraphs.slice(start, end + 1);
  const formatted = items.map(p => {
    const paraText = data.content.substring(p.start, p.end);
    return `Paragraph ${p.index + 1} (lines ${p.lineStart}-${p.lineEnd}, ${p.wordCount} words):\n"${paraText}"`;
  }).join("\n\n");
  return respond: `Paragraphs ${start + 1}-${end + 1}:\n\n${formatted}`;
}
```

### 5d. New Mode: search_all (multi-match)

Add to `src/integration/getExactQuote.ts`:

```typescript
export interface QuoteAllResult {
  matches: Array<{
    quote: string;
    lineNumber: number;
    charPosition: number;
    context: string;
  }>;
  totalCount: number;
}

export async function getExactQuoteAll(
  runtime: IAgentRuntime,
  url: string,
  searchText: string
): Promise<QuoteAllResult> {
  const content = await autognosticDocumentsRepository.getFullContent(runtime, url);
  if (!content) return { matches: [], totalCount: 0 };

  const contentLower = content.toLowerCase();
  const searchLower = searchText.toLowerCase();
  const matches: QuoteAllResult["matches"] = [];
  let pos = 0;

  while (pos < contentLower.length) {
    const idx = contentLower.indexOf(searchLower, pos);
    if (idx === -1) break;

    const lineNumber = content.substring(0, idx).split("\n").length;
    const actualQuote = content.substring(idx, idx + searchText.length);
    const contextStart = Math.max(0, idx - 50);
    const contextEnd = Math.min(content.length, idx + searchText.length + 50);

    matches.push({
      quote: actualQuote,
      lineNumber,
      charPosition: idx,
      context: content.substring(contextStart, contextEnd),
    });
    pos = idx + 1;
  }

  return { matches, totalCount: matches.length };
}
```

Handler code for search_all:
```typescript
if (inferred.mode === "search_all") {
  const result = await getExactQuoteAll(runtime, url, inferred.searchText!);
  if (result.totalCount === 0) -> `No mentions of "${inferred.searchText}" found.`
  const formatted = result.matches.map((m, i) =>
    `${i + 1}. Line ${m.lineNumber}: "...${m.context}..."`
  ).join("\n");
  return respond: `Found ${result.totalCount} mention(s) of "${inferred.searchText}":\n${formatted}`;
}
```

### 5e. New Modes: implicit_start / implicit_end

These delegate to existing first_n / last_n with count=3, unit="sentence":

```typescript
if (inferred.mode === "implicit_start") {
  // Rewrite inferred and fall through to first_n handler
  inferred.mode = "first_n";
  inferred.count = 3;
  inferred.unit = "sentence";
  // (continue to first_n handling below)
}
if (inferred.mode === "implicit_end") {
  inferred.mode = "last_n";
  inferred.count = 3;
  inferred.unit = "sentence";
}
```

Place these BEFORE the last_n/first_n handler block so they rewrite and fall through.

### 5f. Enhanced Search — Case-Insensitive

In `getExactQuote.ts`, replace:
```typescript
// BEFORE (case-sensitive):
const position = content.indexOf(searchText);

// AFTER (case-insensitive):
const contentLower = content.toLowerCase();
const searchLower = searchText.toLowerCase();
const position = contentLower.indexOf(searchLower);
```

The quote returned should be the ORIGINAL case text from the document:
```typescript
quote: content.substring(position, position + searchText.length);
```

### 5g. Open-Ended Ranges

When `lineEnd` is set to a sentinel value (Infinity or 999999),
the handler clamps it to the actual document size:

```typescript
const actualEnd = Math.min(inferred.lineEnd ?? profile.lineCount, profile.lineCount);
```

Same for paragraph_range:
```typescript
const actualEnd = Math.min(inferred.lineEnd ?? profile.paragraphCount, profile.paragraphCount);
```

### 5h. "full" Mode — Remove "all" Trigger

The word "all" is too ambiguous. "Show me all the paragraphs" should NOT
trigger full-doc dump. Remove `\ball\b` from the full-mode regex.
Keep: full, entire, whole, and the explicit "read it all" compound phrase.

## 6. VALIDATE GATE — EXPANDED

The validate function must be generous. False negatives are worse than
false positives because the LLM can still reject the action if validate
returns true, but if validate returns false the action is invisible.

Add these patterns to the existing validate regex:

```
// Ordinals + unit
(?:second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|
   eleventh|twelfth|thirteenth|fourteenth|fifteenth|
   sixteenth|seventeenth|eighteenth|nineteenth|twentieth|
   \d+(?:st|nd|rd|th))\s+(?:sentence|paragraph|line|word)

// Unit + number (reversed)
(?:sentence|paragraph|line)\s+(?:\d+|one|two|three|...|twenty)

// Stats alternate phrasings
how\s+long\s+is|count\s+the\s+(?:words?|lines?|sentences?)|length

// Search phrasings
(?:find|locate|search|look\s+for)|
(?:is|does)\s+(?:it\s+)?(?:mention|discuss|reference|include)|
(?:does\s+it\s+)?talk\s+about|
every\s+(?:mention|occurrence|instance)\s+of

// Implicit positional
how\s+does\s+it\s+(?:start|begin|end)|
(?:the\s+)?(?:opening|beginning|ending|conclusion)\s+of|
penultimate|next\s+to\s+last|
(?:go|skip)\s+to\s+(?:line|paragraph)

// Navigation and reading
read\s+it|tell\s+me\s+about\s+(?:the\s+)?(?:document|doc)

// Ranges
sentences?\s+\d+\s+(?:to|through|thru)|
paragraphs?\s+\d+\s+(?:to|through|thru)|
from\s+line|everything\s+after|para\s+\d+
```

NOTE: Compile the full regex as a single-line JS regex with /i flag.
The extended form above is for documentation readability only.

## 7. LLM GUIDANCE — DESCRIPTION + EXAMPLES + SIMILES

### 7a. Updated Description

```typescript
description:
  "Retrieve exact quotes, lines, sentences, paragraphs, stats, or search results from a stored knowledge document. " +
  "ALWAYS use this action instead of REPLY or SEND_MESSAGE when the user asks about document content. " +
  "Triggers include: quote, read, print, show, retrieve, give me, tell me about the document, " +
  "'what does it say about X', 'find X', 'is X mentioned', 'every mention of X', " +
  "'last two sentences', 'first paragraph', 'the third paragraph', 'paragraph 3', 'sentence five', " +
  "'how many words', 'word count', 'how long is it', 'count the words', " +
  "'lines 5 to 10', 'sentences 3 through 7', 'from line 5 to the end', " +
  "'how does it start', 'how does it end', 'the opening', 'the conclusion', " +
  "'full document', 'read it all', 'the second line', '5th sentence', " +
  "'penultimate sentence', 'next to last paragraph'. " +
  "Do NOT attempt to recall document content from conversation context — only this action retrieves it. " +
  "This is the ONLY way to access stored document content. REPLY cannot access documents.",
```

### 7b. Updated Similes

```typescript
similes: [
  "QUOTE_FROM", "GET_LINE", "EXACT_QUOTE", "READ_LINE", "READ_DOCUMENT",
  "REPEAT_LINE", "REPEAT_TEXT", "SHOW_LINE", "RETRIEVE_TEXT", "GET_CONTENT",
  "LAST_LINE", "FIRST_LINE", "DOCUMENT_STATS", "WORD_COUNT", "GET_PARAGRAPH",
  "GET_SENTENCES", "FIND_IN_DOCUMENT", "SEARCH_DOCUMENT", "DOCUMENT_LENGTH",
  "READ_PARAGRAPH", "NTH_SENTENCE", "NTH_PARAGRAPH", "LINE_RANGE",
  "SENTENCE_RANGE", "PARAGRAPH_RANGE", "DOCUMENT_OPENING", "DOCUMENT_ENDING",
  "COUNT_WORDS", "SHOW_STATS", "FIND_MENTION",
],
```

### 7c. Updated Examples (16 total — covers every major mode)

```typescript
examples: [
  // 1. Last line
  [
    { name: "{{name1}}", content: { text: "Repeat the last line of that document" } },
    { name: "{{name2}}", content: { text: 'Last line (line 42): "The results confirm our initial hypothesis."', actions: ["GET_EXACT_QUOTE"] } },
  ],
  // 2. Specific line
  [
    { name: "{{name1}}", content: { text: "Read me line 5" } },
    { name: "{{name2}}", content: { text: 'Line 5: "We propose a novel architecture."', actions: ["GET_EXACT_QUOTE"] } },
  ],
  // 3. Search with "about"
  [
    { name: "{{name1}}", content: { text: "What does it say about neural networks?" } },
    { name: "{{name2}}", content: { text: 'Found at line 17: "...neural networks enable representation learning..."', actions: ["GET_EXACT_QUOTE"] } },
  ],
  // 4. Last N sentences
  [
    { name: "{{name1}}", content: { text: "Give me the last two sentences" } },
    { name: "{{name2}}", content: { text: 'Last 2 sentences:\n1. "The framework achieves state-of-the-art results." (line 40)\n2. "Future work will explore scalability." (line 41)', actions: ["GET_EXACT_QUOTE"] } },
  ],
  // 5. Stats
  [
    { name: "{{name1}}", content: { text: "How many words are in the document?" } },
    { name: "{{name2}}", content: { text: "Document stats: 1,247 words, 52 sentences, 8 paragraphs, 73 lines.", actions: ["GET_EXACT_QUOTE"] } },
  ],
  // 6. Paragraph by number
  [
    { name: "{{name1}}", content: { text: "Show me paragraph 3" } },
    { name: "{{name2}}", content: { text: 'Paragraph 3 (lines 12-18, 4 sentences):\n"We employed a mixed-methods approach..."', actions: ["GET_EXACT_QUOTE"] } },
  ],
  // 7. Full document
  [
    { name: "{{name1}}", content: { text: "Read me what it says verbatim" } },
    { name: "{{name2}}", content: { text: 'Full document (2341 chars):\n\nAbstract: This paper introduces...', actions: ["GET_EXACT_QUOTE"] } },
  ],
  // 8. Line range
  [
    { name: "{{name1}}", content: { text: "Give me lines 5 through 10" } },
    { name: "{{name2}}", content: { text: 'Lines 5-10:\n5: "The methodology section..."\n6: "We collected data from..."', actions: ["GET_EXACT_QUOTE"] } },
  ],
  // 9. Ordinal paragraph
  [
    { name: "{{name1}}", content: { text: "Read me the third paragraph" } },
    { name: "{{name2}}", content: { text: 'Paragraph 3 (lines 15-21, 87 words):\n"The experimental results demonstrate..."', actions: ["GET_EXACT_QUOTE"] } },
  ],
  // 10. How does it end
  [
    { name: "{{name1}}", content: { text: "How does the document end?" } },
    { name: "{{name2}}", content: { text: 'Last 3 sentences:\n1. "These findings have broad implications." (line 68)\n2. "Further research is warranted." (line 69)\n3. "We release our code publicly." (line 70)', actions: ["GET_EXACT_QUOTE"] } },
  ],
  // 11. How does it start
  [
    { name: "{{name1}}", content: { text: "How does it start?" } },
    { name: "{{name2}}", content: { text: 'First 3 sentences:\n1. "Abstract: We present a novel framework." (line 1)\n2. "Recent advances in AI have enabled..." (line 1)\n3. "Our approach differs fundamentally." (line 2)', actions: ["GET_EXACT_QUOTE"] } },
  ],
  // 12. First N paragraphs
  [
    { name: "{{name1}}", content: { text: "Show me the first two paragraphs" } },
    { name: "{{name2}}", content: { text: 'First 2 paragraphs:\n\nParagraph 1 (lines 1-5, 62 words):\n"Abstract: We present..."\n\nParagraph 2 (lines 7-12, 88 words):\n"Introduction: The field of..."', actions: ["GET_EXACT_QUOTE"] } },
  ],
  // 13. Find / search
  [
    { name: "{{name1}}", content: { text: "Find the part about methodology" } },
    { name: "{{name2}}", content: { text: 'Found at line 24: "...Our methodology combines reinforcement learning with symbolic reasoning..."', actions: ["GET_EXACT_QUOTE"] } },
  ],
  // 14. Is X mentioned
  [
    { name: "{{name1}}", content: { text: "Does it mention transformers?" } },
    { name: "{{name2}}", content: { text: 'Found at line 8: "...transformer architectures have shown remarkable scaling..."', actions: ["GET_EXACT_QUOTE"] } },
  ],
  // 15. How long / length
  [
    { name: "{{name1}}", content: { text: "How long is this document?" } },
    { name: "{{name2}}", content: { text: "Document stats: 2,450 words, 98 sentences, 14 paragraphs, 127 lines, 14,200 characters.", actions: ["GET_EXACT_QUOTE"] } },
  ],
  // 16. Every mention / multi-match
  [
    { name: "{{name1}}", content: { text: "Find every mention of 'data'" } },
    { name: "{{name2}}", content: { text: 'Found 5 mentions of "data":\n1. Line 3: "...collected data from..."\n2. Line 12: "...data processing pipeline..."\n3. Line 28: "...data quality metrics..."', actions: ["GET_EXACT_QUOTE"] } },
  ],
],
```

## 8. CHARACTER SYSTEM PROMPT UPDATE

The character system prompt in `autognostic-agent/src/character.ts` should
list all supported retrieval modes so the LLM knows what is available:

```typescript
system: [
  "You are Atlas, a knowledge management agent powered by the Autognostic system.",
  "Your primary function is managing a knowledge base: adding documents, retrieving exact quotes, and listing stored content.",
  "",
  "CRITICAL RULES:",
  "- When a user shares a URL and wants to store it: use ADD_URL_TO_KNOWLEDGE.",
  "- When a user asks to read, quote, print, retrieve, search, or get stats about ANY content from a stored document: use GET_EXACT_QUOTE. NEVER attempt to recall document content from memory or conversation context.",
  "- When a user asks what documents are stored: use LIST_KNOWLEDGE_DOCUMENTS.",
  "- When a user asks to remove a document: use REMOVE_KNOWLEDGE_DOCUMENT.",
  "- NEVER use REPLY or SEND_MESSAGE to answer questions about document content. Only GET_EXACT_QUOTE has access to stored documents.",
  "- If you don't know which document the user is referring to, ask them to clarify.",
  "",
  "GET_EXACT_QUOTE SUPPORTED MODES:",
  "- Stats: 'how many words', 'how long is it', 'word count', 'count the words'",
  "- Last/First N: 'last two sentences', 'first 3 paragraphs', 'last 5 lines'",
  "- Specific Nth: 'the third paragraph', 'sentence five', '2nd line', 'fifth sentence'",
  "- Paragraph by number: 'paragraph 3', 'para 7'",
  "- First/Last paragraph: 'first paragraph', 'the opening', 'how does it start'",
  "- Ending: 'last paragraph', 'how does it end', 'the conclusion'",
  "- Line range: 'lines 5 to 10', 'from line 5 to the end'",
  "- Sentence range: 'sentences 3 through 7'",
  "- Paragraph range: 'paragraphs 2 to 4'",
  "- Full document: 'full document', 'read it all', 'entire thing'",
  "- Specific line: 'line 5', 'what is on line 12'",
  "- Search: 'what does it say about X', 'find X', 'is X mentioned', 'does it talk about X'",
  "- Multi-search: 'every mention of X', 'all occurrences of X'",
  "",
  "You are precise, honest, and never fabricate document content.",
].join("\n"),
```

## 9. PROVIDER RETRIEVAL INSTRUCTIONS UPDATE

The fullDocumentProvider.ts RETRIEVAL INSTRUCTIONS section should match:

```
## RETRIEVAL INSTRUCTIONS
- To quote, read, search, or retrieve ANY content from these documents: use GET_EXACT_QUOTE.
- Supported: full document, specific line, line/sentence/paragraph range, last/first N units,
  ordinal access (third paragraph, 5th sentence), search by topic, multi-match search,
  word count/stats, document length, opening/conclusion.
- Do NOT attempt to recall or reproduce document content from memory.
- Do NOT use REPLY to answer questions about document content.
- If the user asks "what does it say", "read me", "quote", "print", "show contents",
  "last sentence", "how many words", "paragraph 3", "find X", "how does it end",
  "the third paragraph", "is X mentioned" -> GET_EXACT_QUOTE.
- You do NOT have document content in this context. Only GET_EXACT_QUOTE can retrieve it.
```

## 10. INTEGRATION: getExactQuote.ts CHANGES

### 10a. Case-Insensitive Search

Replace in getExactQuote():
```typescript
// BEFORE (case-sensitive):
const position = content.indexOf(searchText);

// AFTER (case-insensitive):
const contentLower = content.toLowerCase();
const searchLower = searchText.toLowerCase();
const position = contentLower.indexOf(searchLower);
```

The quote returned must be the ORIGINAL case text from the document:
```typescript
quote: content.substring(position, position + searchText.length);
```

### 10b. New: getExactQuoteAll (multi-match)

See Section 5d for full implementation.
Export from getExactQuote.ts alongside existing functions.

## 11. IMPLEMENTATION ORDER

1. **parseNumber()** — Expand parseCount into parseNumber with ordinals + suffixes
2. **inferMode()** — Implement full cascade from Section 4 (all 24 priority levels)
3. **getExactQuote.ts** — Case-insensitive search + getExactQuoteAll
4. **Handler new modes** — nth, sentence_range, paragraph_range, search_all, implicit_start/end
5. **Handler fixes** — Remove "all" from full-mode trigger, open-ended range clamping
6. **validate()** — Expand regex per Section 6
7. **Action metadata** — Update description, similes, examples per Section 7
8. **fullDocumentProvider.ts** — Update retrieval instructions per Section 9
9. **Character system prompt** — Update per Section 8 (in autognostic-agent/src/character.ts)
10. **Tests** — Add test cases for every pattern in the test matrix (Section 12)
11. **Build both** — `bun run build` in plugin-autognostic AND autognostic-agent
12. **Verify** — `npx vitest run` for unit tests, then manual testing via `elizaos dev`

## 12. TEST MATRIX

Each row is a user message that MUST resolve to the correct mode.
Implement these as unit tests for inferMode():

| Input | Expected Mode | Expected Params |
|-------|--------------|-----------------|
| "how many words" | stats | |
| "how long is it" | stats | |
| "count the words" | stats | |
| "word count" | stats | |
| "length of the document" | stats | |
| "last two sentences" | last_n | count=2, unit=sentence |
| "last 5 lines" | last_n | count=5, unit=line |
| "first three paragraphs" | first_n | count=3, unit=paragraph |
| "first 10 words" | first_n | count=10, unit=word |
| "the third paragraph" | nth | count=3, unit=paragraph |
| "fifth sentence" | nth | count=5, unit=sentence |
| "2nd line" | nth | count=2, unit=line |
| "sentence five" | nth | count=5, unit=sentence |
| "paragraph three" | nth | count=3, unit=paragraph |
| "line twenty" | nth | count=20, unit=line |
| "paragraph 3" | paragraph | count=3 |
| "para 7" | paragraph | count=7 |
| "first paragraph" | first_paragraph | |
| "the opening" | first_paragraph | |
| "beginning of the document" | first_paragraph | |
| "last paragraph" | last_paragraph | |
| "the conclusion" | last_paragraph | |
| "how does it end" | implicit_end | |
| "how does it start" | implicit_start | |
| "what's the opening" | implicit_start | |
| "what's the conclusion" | implicit_end | |
| "lines 5 to 10" | range | lineNumber=5, lineEnd=10 |
| "from line 5 to the end" | range | lineNumber=5, lineEnd=MAX |
| "everything after line 10" | range | lineNumber=11, lineEnd=MAX |
| "sentences 3 through 7" | sentence_range | start=3, end=7 |
| "paragraphs 2 to 4" | paragraph_range | start=2, end=4 |
| "everything after paragraph 2" | paragraph_range | start=3, end=MAX |
| "full document" | full | |
| "read it all" | full | |
| "entire thing" | full | |
| "line 5" | line | lineNumber=5 |
| "what's on line 12" | line | lineNumber=12 |
| "go to line 20" | line | lineNumber=20 |
| "what does it say about neural networks" | search | searchText="neural networks" |
| "find the part about methodology" | search | searchText="methodology" |
| "is transformers mentioned" | search | searchText="transformers" |
| "does it talk about scaling" | search | searchText="scaling" |
| "every mention of data" | search_all | searchText="data" |
| "all occurrences of 'network'" | search_all | searchText="network" |
| "last line" | last_n | count=1, unit=line |
| "final sentence" | last_n | count=1, unit=sentence |
| "penultimate paragraph" | last_n | count=2, unit=paragraph |
| "next to last sentence" | last_n | count=2, unit=sentence |
| "read it to me" | full | |
| "tell me about the document" | stats | |
