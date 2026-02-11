# Autognostic Fix Plan — Action Routing & Context Pollution
# =========================================================
# 
# ROOT CAUSE: LLM sees full document content in provider context, so it
# tries to answer from "memory" via REPLY instead of calling GET_EXACT_QUOTE.
# Callback messages like "Full document archived for direct quotes" get stored
# as conversation history and the LLM later confuses them with document content.
#
# This plan fixes 5 issues in dependency order.
# Each step is independently testable.
#
# EXECUTION: npx tsx scripts/apply-routing-fixes.ts
# VERIFY:    bun run build && npx tsx scripts/test-direct-embed.ts
# DEPLOY:    Remove-Item -Recurse -Force .\.eliza && elizaos dev


## STEP 1: Provider — Stop leaking raw content into LLM context
## File: src/providers/fullDocumentProvider.ts
##
## Problem: The provider dumps entire document text into the LLM prompt under
## "## FULL DOCUMENT CONTENT". The LLM sees this and thinks it already knows
## the answer, so it picks REPLY instead of GET_EXACT_QUOTE. It then
## confabulates by stitching fragments from context.
##
## Fix: Replace full document content with a routing-only inventory.
## The provider should tell the LLM WHAT documents exist and HOW to access
## them (via GET_EXACT_QUOTE), but never inject the actual text.
## 
## The provider's job is awareness + routing, not content delivery.
## Content delivery is GET_EXACT_QUOTE's job.


## STEP 2: Callback messages — Remove confusable text from action responses
## Files: src/actions/addUrlToKnowledgeAction.ts
##
## Problem: Callback text "Full document archived for direct quotes" gets stored
## as a memory. The LLM later treats it as document content, producing responses
## like: "Here is the full content: Its hour come round at last. Full document
## archived for direct quotes. The end."
##
## Fix: Change callback messages to structured status format that the LLM
## won't confuse with document content. Use bracketed prefixes:
##   "[STORED] potato_chimpanzee_falafel_garb.md — 2341 chars, 47 lines.
##    Use GET_EXACT_QUOTE to retrieve content."


## STEP 3: GET_EXACT_QUOTE — Strengthen description to win over REPLY
## File: src/actions/getQuoteAction.ts
##
## Problem: Even with examples, REPLY wins because the LLM sees the document
## inventory in context and thinks it can answer directly. The description
## needs explicit routing instructions that override the LLM's instinct to
## use REPLY for content questions.
##
## Fix: Add explicit anti-REPLY routing language to the description:
## "ALWAYS use this action instead of REPLY when the user asks about document
## content, quotes, lines, or text from stored documents."
## Also add a default mode fallback so vague requests like "print the document"
## still trigger the action (currently falls through to "invalid_params").


## STEP 4: Fix cyclic JSON in message bus
## File: src/actions/addUrlToKnowledgeAction.ts (and others returning ActionResult)
##
## Problem: Log shows "JSON.stringify cannot serialize cyclic structures" at
## 15:34:31 during sendMessage. Our safeSerialize handles the data field, but
## the ActionResult object itself may contain references the message bus can't
## serialize — specifically when the runtime injects itself into the callback
## response chain.
##
## Fix: Wrap the entire ActionResult return in safeSerialize, not just the
## data field. Also ensure callback payloads are plain objects.


## STEP 5: Validate function — Widen GET_EXACT_QUOTE trigger patterns
## File: src/actions/getQuoteAction.ts
##
## Problem: The validate regex misses common user queries like:
##   "print the document", "show me the contents", "what's in the file",
##   "give me the full text", "read the document"
## These fall through to REPLY.
##
## Fix: Add patterns for print/show/contents/text/give/get + document/file
## keywords. Also add "last N words" and "first N words" patterns.
