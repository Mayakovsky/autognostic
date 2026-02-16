# GET_EXACT_QUOTE — Command Logic Breakdown & Gap Analysis

## Current Architecture (3 Layers)

### Layer 1: Validate Gate
**File:** `getQuoteAction.ts` → `validate()`
**Purpose:** Returns true/false — decides if this action is even a CANDIDATE for the LLM to select.
**Mechanism:** Single regex against lowercased message text.

```
Currently matches:
├── quote, exact, verbatim, recite, word for word
├── line \d+
├── repeat + (line|sentence|paragraph|word)
├── read [me] [the] (line|back|from|what|document|doc|file|paper|it)
├── (first|last|next|previous) + (line|sentence|paragraph|word|N words|N sentences|...)
├── what does (it|the X) say
├── copy [the] (text|line|content)
├── print [the] (document|doc|file|contents|text|it|full)
├── show [me] [the] (document|doc|file|contents|text|full|paragraph)
├── (give|get) [me] [the] (text|contents|full|document|last|first)
├── contents of, full (document|text|contents)
├── what's in [the] (document|doc|file|paper)
├── how many (words|lines|sentences|paragraphs)
├── word count, statistics, stats
├── paragraph \d+
└── lines \d+ (to|through|thru)
```

**GAPS in validate:**
- "what's the fifth paragraph" — ordinal numbers (fifth, third) not matched
- "tell me about the document" — "tell me" not matched
- "summarize the document" — summarize not matched (intentional? overlaps with REPLY)
- "extract the introduction" — section names not matched
- "what does it start with" — start/begin phrasing not matched
- "how does it end" — end phrasing not matched
- "read it to me" / "read it back" — "read it" doesn't match current regex
- "count the words" — inverted word order not matched
- "how long is the document" — length query not matched
- "what's on line 5" — "what's on" not matched
- "go to paragraph 3" — "go to" not matched
- "the second sentence" — ordinal + unit without first/last keyword
- "middle of the document" — positional reference not matched
- "skip to line 20" — navigation language not matched

---

### Layer 2: Mode Inference (inferMode function)
**Purpose:** Parse the user's natural language into a structured mode + parameters.
**Mechanism:** Ordered regex matching — first match wins.

```
Current mode detection order:
│
├── 1. STATS: "how many words/lines/sentences/paragraphs", "word count", "stats", "statistics", "overview"
│
├── 2. LAST_N: "last (N|word) (sentences|paragraphs|words|lines)"
│       Example: "last two sentences", "last 5 lines"
│       Requires exact "last N unit" word order
│
├── 3. FIRST_N: "first (N|word) (sentences|paragraphs|words|lines)"
│       Example: "first three paragraphs"
│       Requires exact "first N unit" word order
│
├── 4. PARAGRAPH: "paragraph N"
│       Example: "paragraph 3"
│       Only matches digit, not ordinal ("third paragraph" → MISS)
│
├── 5. LAST_PARAGRAPH: "(last|final|ending) paragraph"
│
├── 6. FIRST_PARAGRAPH: "(first|opening|beginning|starting) paragraph"
│
├── 7. RANGE: "line(s) N (to|through|thru|-) M"
│       Example: "lines 5 to 10"
│
├── 8. FULL: "full|entire|whole|all"
│       Extremely broad — "all" triggers full mode even in "all the paragraphs"
│
├── 9. LINE: "line N" or args.lineNumber
│
├── 10. LAST (single): "(last|final|ending) (line|sentence|word)"
│        Maps to last_n with count=1
│
├── 11. FIRST (single): "(first|opening|beginning|starting) (line|sentence|word)"
│        Maps to first_n with count=1
│
├── 12. SEARCH (explicit): args.searchText provided
│
├── 13. SEARCH (quoted): text in "quotes" or 'quotes' in the message
│
└── 14. EMPTY → Falls through to full-fallback
```

**GAPS in mode inference:**
- Ordinals: "third paragraph", "fifth sentence", "second line" — no ordinal-to-number parsing
- Reversed phrasing: "paragraph three" vs "third paragraph" vs "the 3rd paragraph"
- "the sentence before last" / "penultimate" — relative references
- "next to last" — relative references
- "from line 5 to the end" — open-ended ranges
- "everything after paragraph 2" — open-ended slicing
- "sentences 3 through 7" — sentence ranges (only line ranges exist)
- "paragraphs 2 to 4" — paragraph ranges
- "how does it end" → should map to last_n sentences or last paragraph
- "what's the opening" → should map to first paragraph or first_n sentences
- "beginning of the document" → first paragraph
- "end of the document" → last paragraph
- "how long is it" → stats mode
- "count the words" → stats mode (inverted phrasing)
- "what does it say about X" → search mode (the "about" pattern)
- "find the part about X" → search mode
- "where does it mention X" → search mode
- "is X mentioned" → search mode (yes/no + quote)

---

### Layer 3: Handler Execution
**Purpose:** Given a mode + parameters, extract and return the content.
**Mechanism:** Switch on mode, use DocumentProfile boundaries or raw content.

```
Current handler modes:
│
├── stats       → profile.wordCount, sentenceCount, paragraphCount, etc.
├── last_n      → profile.sentences/paragraphs/lines.slice(-count) or content.split for words
├── first_n     → profile.sentences/paragraphs/lines.slice(0, count)
├── paragraph   → profile.paragraphs[N-1] → content.substring(start, end)
├── first_paragraph → profile.paragraphs[0]
├── last_paragraph  → profile.paragraphs[-1]
├── range       → profile.lines.slice(start, end+1) → content.substring per line
├── full        → getFullDocument() → first 5000 chars
├── line        → getLineContent(url, N)
├── search      → getExactQuote(url, text) → indexOf + context extraction
└── (fallback)  → full document dump
```

**GAPS in handler:**
- No sentence range mode ("sentences 3 through 7")
- No paragraph range mode ("paragraphs 2 to 4")
- No case-insensitive search (indexOf is case-sensitive)
- No fuzzy/partial word search ("transform" should find "transformers")
- No multi-match search (only returns first occurrence)
- Truncation at 5000 chars for full mode — no way to get chars 5001+

---

### Layer 4: LLM Action Selection (external to our code)
**Purpose:** ElizaOS's LLM reads action descriptions + examples to decide which action to invoke.
**Our levers:** description text, similes array, examples array, character system prompt.

**Current examples (8):**
1. "Repeat the last line" → last line
2. "Read me line 5" → specific line
3. "What does that paper say about transformers?" → search
4. "Give me the last two sentences" → last_n sentences
5. "How many words are in the document?" → stats
6. "Show me paragraph 3" → paragraph
7. "Read me what it says verbatim" → full
8. "Give me lines 5 through 10" → range

**GAPS in LLM guidance:**
- No example for ordinal paragraphs ("the third paragraph")
- No example for "how does it end" / "how does it start"
- No example for search with "about" / "mention" / "find"
- No example for first_n mode
- No example for stats via alternate phrasing ("how long is the document")
- Description doesn't mention ordinals, "about", "mention", "find", "length"
- Character system prompt doesn't list all supported modes

---

## Recommended Expansions (Priority Order)

### P0: Ordinal Numbers (blocks real usage)
Add ordinal parsing to `inferMode` and `parseCount`:
- "third paragraph" → paragraph 3
- "fifth sentence" → nth sentence (5)
- "second line" → line 2
- Ordinals: first through twentieth, plus "1st", "2nd", "3rd", "4th", "5th", etc.
- Reversed: "paragraph three" → paragraph 3

### P0: Reversed Unit+Number Phrasing
- "paragraph three" should work same as "paragraph 3"
- "sentence five" → nth sentence
- "line twenty" → line 20

### P1: Search Phrasing Expansion
- "what does it say about X" → search for X
- "find the part about X" → search for X
- "where does it mention X" → search for X
- "is X mentioned" → search for X (return yes/no + quote)
- "does it talk about X" → search for X
- Case-insensitive search (toLowerCase both content and query)

### P1: Implicit Mode from Context
- "how does it end" → last_n sentences (3) or last paragraph
- "how does it start" / "what's the opening" → first_n sentences (3) or first paragraph
- "beginning" → first paragraph
- "ending" / "conclusion" → last paragraph
- "how long is it" / "length" → stats

### P2: Open-ended Ranges
- "from line 5 to the end" → range(5, lineCount)
- "everything after paragraph 2" → paragraphs from 3 onward
- "lines after 10" → range(11, lineCount)

### P2: Sentence/Paragraph Ranges
- "sentences 3 through 7" → slice sentences[2:7]
- "paragraphs 2 to 4" → slice paragraphs[1:4]

### P2: Case-insensitive + Partial Search
- Current: `content.indexOf(searchText)` — exact match only
- Needed: `content.toLowerCase().indexOf(searchText.toLowerCase())`
- Bonus: partial word matching for stemmed queries

### P3: Multi-match Search
- "every mention of X" → return all occurrences with line numbers
- Currently only returns first match

### P3: Validate Gate Expansion
Add patterns for all new phrasings so the action is even considered by the LLM.

### P3: LLM Guidance Updates
- Add examples for ordinals, "about", "how does it end", search
- Update description with new trigger words
- Update character system prompt with complete mode list
