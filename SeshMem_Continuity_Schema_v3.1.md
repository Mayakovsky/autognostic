# SeshMem Continuity Schema v3.1

**Session Memory (SeshMem):** A structured, file-based continuity system that gives AI coding agents persistent context across stateless CLI sessions.

> SeshMem is not a product or a library. It is a *pattern* — a set of markdown files, conventions, update disciplines, and optional automation hooks that solve the cross-session amnesia problem inherent to all current AI coding CLIs. It is not dependent on any specific CLI tool — it works with anything that reads markdown.

---

## Table of Contents

1. [Design Principles](#1-design-principles)
2. [File Topology and Roles](#2-file-topology-and-roles)
3. [heartbeat.md — The Session Briefing](#3-heartbeatmd--the-session-briefing)
4. [CLAUDE.md Integration](#4-claudemd-integration)
5. [Supporting File Templates](#5-supporting-file-templates)
6. [SeshMem Workflow](#6-seshmem-workflow)
7. [Multi-Agent Handoff Protocol](#7-multi-agent-handoff-protocol)
8. [Hook Automation (Optional)](#8-hook-automation-optional)
9. [Error Handling and Fallbacks](#9-error-handling-and-fallbacks)
10. [Connectivity and Dependency Map](#10-connectivity-and-dependency-map)
11. [Anti-Patterns](#11-anti-patterns)
12. [Testing Infrastructure](#12-testing-infrastructure)
13. [Implementation Checklist](#13-implementation-checklist)
14. [Changelog](#14-changelog)

---

## 1. Design Principles

1. **heartbeat.md is the only file an agent must read to start working.** Everything else is linked, not inlined.
2. **Volatile state in heartbeat.md. Durable reference in `docs/`.** Prevents bloat, keeps the heartbeat scannable.
3. **Checklists over prose.** Agents parse checklists reliably. Paragraphs cause drift.
4. **Verified facts over claims.** If something "works," the heartbeat says *how it was verified* (command, test, manual check) and *when*.
5. **Update at session end, not session start.** The outgoing session knows more than the incoming one.
6. **Keep heartbeat.md under 120 lines.** Longer → content belongs in a linked doc.
7. **Fail gracefully.** Missing or stale heartbeat must never block work. The agent detects the problem, warns, and proceeds from CLAUDE.md + git state.
8. **No secrets in any SeshMem file.** These files become prompt context. Reference env vars by name (`$GITHUB_TOKEN`), never by value.
9. **Single source per fact.** If the same information exists in two files, one of them is wrong (or will be soon). Link, never duplicate.

---

## 2. File Topology and Roles

```
project-root/
├── heartbeat.md              ← "What's happening right now?" (volatile, every session)
├── CLAUDE.md                 ← "Who is the agent, how does it work here?" (stable)
├── docs/
│   ├── decisions.md          ← "Why did we choose X over Y?" (append-only)
│   ├── architecture.md       ← "How do the pieces fit together?"
│   ├── schema.md             ← "What are the tables and migrations?"
│   ├── known-issues.md       ← "What keeps breaking?"
│   └── runbook.md            ← "How do I set up / build / deploy / reset?"
├── TASKS.md                  ← "What's coming later?" (backlog)
├── CONTRIBUTING.md           ← "What rules must every change follow?" (stable)
└── .seshmem/                 ← Metadata (optional, gitignored)
    └── session-log.jsonl     ← Machine-readable session history overflow
```

| File | Updated | By |
|---|---|---|
| `heartbeat.md` | Every session | Outgoing agent |
| `CLAUDE.md` | Rarely | Human or architect session |
| `docs/decisions.md` | When decisions are made | Whoever decides |
| `docs/architecture.md` | On structural changes | Human or architect session |
| `docs/schema.md` | On schema changes | Agent that changes schema |
| `docs/known-issues.md` | When issues surface or resolve | Agent that encounters issue |
| `docs/runbook.md` | On environment changes | Agent or human that changes env |
| `TASKS.md` | As priorities shift | Human |
| `CONTRIBUTING.md` | Rarely | Human |

### Minimum Viable SeshMem

Only two files are required. Everything else is added when complexity demands it.

```
project-root/
├── heartbeat.md     ← Required
└── CLAUDE.md        ← Required (or equivalent agent config)
```

### Cross-Reference Rule

```
CORRECT:  "See [docs/schema.md](./docs/schema.md) for table definitions."
WRONG:    <copy-pasting the schema into heartbeat.md>
```

---

## 3. heartbeat.md — The Session Briefing

### Why It's Separate from CLAUDE.md

These files serve different purposes and must not be merged.

- **CLAUDE.md** = agent identity and operating manual. Changes rarely. Auto-loaded by Claude Code CLI. Answers: *"Who are you and how do you work here?"*
- **heartbeat.md** = situational briefing. Changes every session. Tool-agnostic. Answers: *"What's going on and what do I do next?"*

Merging them causes three problems: context rot (research shows attention degrades past ~150 instructions), noisy git diffs on what should be a stable file, and tool lock-in (heartbeat works with any agent; CLAUDE.md is Claude-specific).

### Template

```md
# HEARTBEAT — <project name>
> Last updated: YYYY-MM-DD HH:MM (local tz)
> Updated by: <agent-name or "human">
> Session label: <brief label, e.g. "error handling refactor">
> Staleness gate: <YYYY-MM-DD> — if today is >3 days past this, 
>   verify state before acting (see Staleness Gate below).

## Focus (1-3 goals, testable)
- [ ] <Goal A — what "done" looks like>
- [ ] <Goal B>

## What Works (verified)
- ✅ <feature> — verified via `<command>` on <date>
- ✅ <feature> — verified via `<manual check>` on <date>

## What's Broken
- ❌ <issue>
  - Symptom: <exact error message or behavior>
  - Repro: `<command to reproduce>`
  - Suspected cause: <hypothesis>
  - Workaround: <if any>
  - Linked: [ISSUE-NNN](./docs/known-issues.md#issue-nnn) (if documented)

## Next Actions (ordered)
1. <step> → `<file or function>`
2. <step> → `<file or function>`
3. <step> → `<file or function>`

## Session Log (last 5 entries, newest first)
| Date | Agent | What changed | Outcome |
|------|-------|-------------|---------|
| YYYY-MM-DD | <n> | <change> | <r> |

## Guardrails (DO / DON'T)
DO:
- <constraint>
DON'T:
- <boundary — thing that looks tempting but breaks stuff>

## Quick Commands
```bash
# Build
<command>

# Test
<command>

# Dev server / run
<command>

# Reset database
<command>
```

## Links
- [CLAUDE.md](./CLAUDE.md) — Agent identity + permissions
- [Architecture](./docs/architecture.md)
- [Schema](./docs/schema.md)
- [Decisions](./docs/decisions.md)
- [Known Issues](./docs/known-issues.md)
- [Runbook](./docs/runbook.md)
- [Tasks](./TASKS.md)
```

### Field Requirements

| Field | Required | Rules |
|---|---|---|
| Header (updated, by, label, staleness gate) | Yes | Updated every session end. |
| Focus | Yes | 1-3 items. Each must be testable. |
| What Works | Yes | Each entry needs verification method + date. Prune entries older than 2 weeks unless foundational. |
| What's Broken | If applicable | Each entry needs Symptom + Repro. Link to known-issues.md when documented there. |
| Next Actions | Yes | 3-7 ordered items. Each references a file or function. Vague actions ("improve error handling") aren't ready for heartbeat. |
| Session Log | Yes | Last 5 entries. Overflow → `.seshmem/session-log.jsonl` or trim oldest. |
| Guardrails | If applicable | Remove when no longer relevant. |
| Quick Commands | Yes | Must be copy-pasteable and periodically tested. |
| Links | Yes | Dead links signal a doc needs creation or the link needs removal. |

### Staleness Gate

The staleness gate is the single most important safety mechanism in SeshMem. It's a date-based tripwire that protects against ungraceful exits (crashes, context limits, ctrl-C), forgotten updates, and extended breaks.

**How it works:** If the current date exceeds the gate by >3 days, the incoming agent must:

1. NOT trust the What Works section without re-verification
2. Run Quick Commands to verify build/test state
3. Update the heartbeat before starting new work

The outgoing agent resets the staleness gate to today's date at every session end. If the agent crashes or forgets, the gate expires naturally and the next session self-corrects.

---

## 4. CLAUDE.md Integration

Add this line to the top of your CLAUDE.md:

```md
> 📡 Read [heartbeat.md](./heartbeat.md) first for current session state.
```

### Belongs in CLAUDE.md (not heartbeat.md)

- Project identity and purpose
- Package manager, test framework, build tools
- Autonomous permissions (what agent can change without asking)
- Architecture overview (or pointer to docs/architecture.md)
- Code patterns, conventions, git workflow
- Environment variable names (not values)

### Does NOT Belong in CLAUDE.md

- Current goals or tasks (→ heartbeat.md Focus / Next Actions)
- What's broken right now (→ heartbeat.md What's Broken)
- Session history (→ heartbeat.md Session Log)
- Decision rationale (→ docs/decisions.md)

---

## 5. Supporting File Templates

These docs prevent heartbeat.md from bloating. Create each only when the project needs it.

### docs/decisions.md

Append-only. Never delete — mark superseded.

```md
## DEC-001: <title> (YYYY-MM-DD)
**Status:** Active | Superseded by DEC-XXX
**Context:** <problem or question>
**Options:** 1) <A — tradeoff> 2) <B — tradeoff>
**Decision:** <chosen>
**Rationale:** <why>
**Revisit if:** <conditions>
```

### docs/known-issues.md

```md
## ISSUE-001: <title>
**Status:** Open | Workaround available | Resolved (YYYY-MM-DD)
**Symptom:** <exact error>
**Repro:** `<command>`
**Root cause:** <if known>
**Workaround:** <if any>
**Fix:** <status or PR>
```

### docs/runbook.md

```md
## First-Time Setup
<numbered steps, copy-pasteable>

## Daily Development
<dev server, tests, workflows>

## Database Operations
<migrate, seed, reset>

## Troubleshooting
| Symptom | Cause | Fix |
|---------|-------|-----|

## Environment Variables
| Variable | Required | Description |
|----------|----------|-------------|
```

### docs/architecture.md

```md
## Overview
<2-3 sentences>

## Components
<entry points, modules, responsibilities>

## Data Flow
<request lifecycle, data movement>

## External Dependencies
| Dependency | Purpose | Connection |
|------------|---------|------------|

## Key Files
| File | Responsibility |
|------|---------------|
```

### docs/schema.md

```md
## Tables
| Table | Purpose | Key columns |
|-------|---------|-------------|

## Relationships
<foreign keys, cascades>

## Migrations
| File | Description |
|------|-------------|

## Procedures
<apply, rollback, nuclear reset commands>
```

---

## 6. SeshMem Workflow

### Session Start (Agent Reads)

```
1. Read heartbeat.md
2. Check staleness gate:
   a. Current (≤3 days) → proceed from Next Actions
   b. Stale (>3 days) → run Quick Commands to verify state, update heartbeat first
   c. Missing → warn human, fall back to CLAUDE.md + git log, create heartbeat at session end
3. Follow Links to relevant docs/ as needed
4. Begin work
```

### During Session (Agent Works)

```
- Work through Next Actions in order
- Decision made → append to docs/decisions.md
- Issue discovered → append to docs/known-issues.md
- Architecture changed → update docs/architecture.md
- Schema changed → update docs/schema.md
- Environment changed → update docs/runbook.md
```

### Session End (Agent Writes)

This is the most critical phase. The outgoing agent has the context; if it doesn't write, the next session starts cold.

```
1. Update heartbeat.md:
   - Completed items → What Works (with verification + date)
   - New issues → What's Broken
   - New Next Actions for the following session
   - Session Log entry (date, agent name, change, outcome)
   - Timestamp, agent name, session label updated
   - Staleness gate reset to today
2. Update any affected docs/ files
3. Commit: "seshmem: <session label>"
```

**On emergency exit** (crash, context limit, compaction): write a minimal heartbeat update if possible. If not, the staleness gate protects the next session (see [Error Handling](#9-error-handling-and-fallbacks)).

---

## 7. Multi-Agent Handoff Protocol

### Rules

1. **Outgoing tool updates heartbeat.md before the human switches.** Non-negotiable.
2. **Incoming tool reads heartbeat.md before doing anything.**
3. **Session log entries identify the agent** using consistent names: `claude-pro`, `claude-code`, `cursor`, `human`.

### Handoff Matrix

| From → To | Mechanism |
|---|---|
| Claude Code → Claude Code (new session) | Automatic via heartbeat.md |
| Claude Code ↔ Cursor | heartbeat.md is tool-agnostic |
| Claude Pro (browser) → Claude Code | **Manual bridge:** ask Claude Pro to output heartbeat-formatted update, copy-paste into heartbeat.md |
| Any agent → Human | Human reads heartbeat.md |
| Human → Any agent | Human updates heartbeat.md with decisions/priorities |

The Claude Pro gap (no direct file access) is the biggest connectivity hole in a multi-tool workflow. Mitigations: manual copy-paste, Claude in Chrome (if available), or saving Claude Pro outputs as docs/ files referenced from heartbeat.

---

## 8. Hook Automation (Optional)

SeshMem works without automation. Manually updating heartbeat.md at session end is the baseline. Claude Code CLI hooks can supplement but not replace agent-written updates.

### Hooks

**SessionStart** — injects heartbeat into context:
```json
{
  "hooks": {
    "SessionStart": [{
      "hooks": [{
        "type": "command",
        "command": "cat heartbeat.md 2>/dev/null || echo 'NO HEARTBEAT FOUND — check CLAUDE.md and git log for context'"
      }]
    }]
  }
}
```

**PreCompact** — reminds agent to save state before compaction:
```json
{
  "hooks": {
    "PreCompact": [{
      "hooks": [{
        "type": "command",
        "command": "echo '⚠️ COMPACTION — update heartbeat.md with current state before continuing.'"
      }]
    }]
  }
}
```

**SessionEnd** — logs session metadata (cannot block exit):
```json
{
  "hooks": {
    "SessionEnd": [{
      "hooks": [{
        "type": "command",
        "command": "mkdir -p .seshmem && date -u +'{\"ended\":\"%Y-%m-%dT%H:%M:%SZ\"}' >> .seshmem/session-log.jsonl"
      }]
    }]
  }
}
```

### Known Limitations

| Limitation | Mitigation |
|---|---|
| SessionStart may not fire on brand-new sessions (known Claude Code bug) | CLAUDE.md directive "Read heartbeat.md first" serves as manual fallback |
| PreCompact cannot block compaction | Staleness gate catches missed updates on next session |
| SessionEnd cannot prevent exit | Staleness gate catches missed updates on next session |
| Hooks lack conversation context | Hooks remind the agent; the *agent* writes heartbeat.md |
| CLAUDE.md may be paraphrased after compaction | Keep CLAUDE.md under ~150 instructions; volatile state in heartbeat.md is expendable |

---

## 9. Error Handling and Fallbacks

| Failure | Detection | Recovery |
|---|---|---|
| **heartbeat.md missing** | File not found | Warn human. Fall back to CLAUDE.md + `git log --oneline -20`. Create fresh heartbeat at session end. |
| **heartbeat.md stale** (>3 days) | Staleness gate date | Don't trust What Works. Run Quick Commands to verify. Update heartbeat before new work. |
| **heartbeat.md corrupted** (merge conflicts, garbled) | Malformed content | Treat as missing. Reconstruct from git log + build state. |
| **Linked doc missing** | Dead link | Note it. Proceed without. Create doc if the gap is blocking. |
| **Linked doc contradicts heartbeat** | Conflicting info | heartbeat wins for volatile state (goals, broken). Linked doc wins for durable reference (schema, architecture). Flag in session log. |
| **Session crash** (no end-of-session update) | Stale staleness gate | Staleness gate triggers re-verification. Check git log for commits from crashed session. |
| **Two agents update simultaneously** | Git merge conflict | Resolve manually. Most recent session log entry = most current state. |
| **heartbeat.md > 120 lines** | Line count | Move session log overflow to .seshmem/. Move issue details to known-issues.md. Trim What Works to 2 weeks. |

---

## 10. Connectivity and Dependency Map

```
                    ┌─────────────────────────┐
                    │      CLAUDE.md          │
                    │  (stable, auto-loaded)  │
                    │                         │
                    │  "Read heartbeat.md     │
                    │   first" directive ──────┼──────┐
                    └─────────────────────────┘      │
                                                      ▼
┌──────────────┐    ┌─────────────────────────┐    ┌──────────────────┐
│ SessionStart │───▶│     heartbeat.md        │◀───│  SessionEnd /    │
│ Hook         │    │  (volatile briefing)    │    │  PreCompact Hook │
│ (reads)      │    │                         │    │  (reminds write) │
└──────────────┘    │  Links to:              │    └──────────────────┘
                    │  ├─ docs/decisions.md    │
                    │  ├─ docs/architecture.md │
                    │  ├─ docs/schema.md       │
                    │  ├─ docs/known-issues.md │
                    │  ├─ docs/runbook.md      │
                    │  └─ TASKS.md             │
                    └────────────┬─────────────┘
                                 │
                    ┌────────────▼─────────────┐
                    │    .seshmem/ (optional)   │
                    │  session-log.jsonl        │
                    └──────────────────────────┘

Data flow:
  Start:     CLAUDE.md (auto) → heartbeat.md (directive) → docs/* (as needed)
  Working:   Agent → updates docs/* as side effects
  End:       Agent → heartbeat.md (mandatory write) → git commit
  Emergency: Staleness gate protects next session
```

### Dependency Rules

1. **heartbeat.md depends on nothing.** Useful even if all other files are missing.
2. **CLAUDE.md depends on nothing** but benefits from heartbeat.md existing.
3. **docs/ files are standalone references.** No interdependencies.
4. **Hooks depend on heartbeat.md** but fail gracefully with fallback message.
5. **.seshmem/ depends on hooks.** Entirely optional.

No circular dependencies.

---

## 11. Anti-Patterns

| Anti-pattern | Why it fails | Fix |
|---|---|---|
| Everything in CLAUDE.md | Context rot past ~150 instructions | Split: CLAUDE.md for identity, heartbeat.md for state |
| heartbeat.md > 120 lines | Agent skims instead of reads | Link out to docs/ |
| Prose paragraphs in heartbeat | Agents parse checklists better | Checklists and one-liners |
| "X works" without verification | Next session builds on broken assumptions | Verification command + date required |
| Never updating heartbeat | Stale heartbeat misleads | Update every session; staleness gate catches misses |
| Duplicating content across files | Conflicting versions within 2-3 sessions | Single source per fact |
| No staleness gate | Stale state trusted as current | Always set and reset the gate |
| Heartbeat as task tracker | Heartbeat bloats | 3-7 next actions; overflow → TASKS.md |
| Secrets in SeshMem files | Leaked into prompt context | Reference by env var name only |
| Auto-generating heartbeat from hooks | Hooks lack conversation context | Hooks remind; agent writes |
| Updating heartbeat at session start | Captures intention, not results | Write at session end with actual outcomes |

---

## 12. Testing Infrastructure

Three test levels. Run Level 1 on every project. Run Levels 2-3 during initial SeshMem setup.

### Level 1: Validation Script

Automated structural check. Run from project root.

```bash
#!/bin/bash
# seshmem-validate.sh — returns 0 on pass, 1 on fail

ERRORS=0; WARNS=0

# File existence
[ -f heartbeat.md ] || { echo "FAIL: heartbeat.md missing"; ERRORS=$((ERRORS+1)); }
[ -f CLAUDE.md ] || { echo "FAIL: CLAUDE.md missing"; ERRORS=$((ERRORS+1)); }
grep -qi "heartbeat" CLAUDE.md 2>/dev/null || { echo "FAIL: CLAUDE.md missing heartbeat directive"; ERRORS=$((ERRORS+1)); }

# Required fields
for field in "Last updated" "Updated by" "Staleness gate" "Focus" "Next Actions" "Session Log" "Quick Commands" "Links"; do
  grep -qi "$field" heartbeat.md 2>/dev/null || { echo "FAIL: heartbeat.md missing '$field'"; ERRORS=$((ERRORS+1)); }
done

# Line count
LINES=$(wc -l < heartbeat.md 2>/dev/null || echo 999)
[ "$LINES" -le 120 ] || { echo "WARN: heartbeat.md is $LINES lines (limit: 120)"; WARNS=$((WARNS+1)); }

# Secret scan
for pat in "sk-" "ghp_" "Bearer " "password=" "api_key="; do
  grep -rqi "$pat" heartbeat.md CLAUDE.md docs/ TASKS.md 2>/dev/null && {
    echo "FAIL: Possible secret (pattern: $pat)"; ERRORS=$((ERRORS+1));
  }
done

# Dead link check
[ -f heartbeat.md ] && grep -oP '\]\(\./\K[^)]+' heartbeat.md 2>/dev/null | while read -r f; do
  [ -f "$f" ] || { echo "WARN: Dead link: $f"; WARNS=$((WARNS+1)); }
done

echo ""
[ $ERRORS -eq 0 ] && echo "✅ Passed ($WARNS warning(s))" && exit 0
echo "❌ Failed: $ERRORS error(s), $WARNS warning(s)" && exit 1
```

Items the script cannot automate (check manually):
- [ ] Every What Works entry has a verification method + date
- [ ] Every Next Action references a specific file or function
- [ ] No content is duplicated between heartbeat.md and CLAUDE.md
- [ ] Staleness gate date is reasonable (not future-dated by months)

### Level 2: Workflow Simulation

Run once during SeshMem setup. Can use a real agent or be done manually.

```md
## Setup
1. Create minimal project with heartbeat.md + CLAUDE.md
2. Populate heartbeat with initial state

## Session 1 (Normal Work)
- [ ] Agent reads heartbeat → works on Focus → completes ≥1 Next Action
- [ ] Agent updates heartbeat at session end (What Works + new Next Actions + Session Log + timestamps)

## Session 2 (Cold Start — New Agent Instance)
- [ ] New agent reads heartbeat → identifies goals without prior context → continues from Next Actions
- [ ] Updates heartbeat at end

## Session 3 (Multi-Agent Handoff)
- [ ] Agent A (tool X) updates heartbeat → Agent B (tool Y) reads it → works without re-deriving context
- [ ] Agent B's session log entry identifies itself by name

## Pass Criteria
- [ ] Session Log shows 3 entries from 3 sessions with agent names
- [ ] What Works section grew with verified entries
- [ ] heartbeat.md stayed ≤120 lines
```

### Level 3: Failure Recovery

Run once during setup. Each test targets one failure mode from Section 9.

| Test | Setup | Pass criteria |
|------|-------|--------------|
| **F1: Missing heartbeat** | Delete heartbeat.md, start session | Agent warns, falls back to CLAUDE.md + git log, creates heartbeat at end |
| **F2: Stale heartbeat** | Set staleness gate >3 days ago, start session | Agent detects staleness, runs Quick Commands to verify, updates before new work |
| **F3: Corrupted heartbeat** | Insert `<<<<<<<` merge markers, start session | Agent detects corruption, treats as missing, reconstructs |
| **F4: Dead links** | Add link to nonexistent file, start session | Agent notes dead link, proceeds without it |
| **F5: Oversized heartbeat** | Pad to 150+ lines, run validation script | Warning emitted |
| **F6: Crash recovery** | Skip heartbeat update, start new session | Staleness gate triggers re-verification |

---

## 13. Implementation Checklist

### Phase 1: Minimum Viable
- [ ] Create heartbeat.md from template (Section 3)
- [ ] Add heartbeat directive to CLAUDE.md (Section 4)
- [ ] Populate heartbeat with current project state
- [ ] Run validation script (Section 12, Level 1)

### Phase 2: Supporting Docs (add as needed)
- [ ] docs/decisions.md — if project has non-obvious choices
- [ ] docs/known-issues.md — if recurring bugs exist
- [ ] docs/runbook.md — if setup is non-trivial
- [ ] docs/architecture.md — if multiple components
- [ ] docs/schema.md — if project has a database

### Phase 3: Workflow Verification
- [ ] Run workflow simulation (Section 12, Level 2)
- [ ] Verify heartbeat updates at end of real sessions
- [ ] Verify multi-agent handoff (if applicable)

### Phase 4: Automation (optional)
- [ ] SessionStart hook (Section 8)
- [ ] PreCompact hook (Section 8)
- [ ] SessionEnd hook (Section 8)
- [ ] Validation script in CI or pre-commit

### Phase 5: Failure Hardening
- [ ] Run failure recovery tests (Section 12, Level 3)
- [ ] Confirm staleness gate catches missed updates
- [ ] Confirm graceful degradation when files are missing

---

## 14. Changelog

| Version | Date | Changes |
|---|---|---|
| 3.1 | 2026-02-08 | Optimization pass: merged File Topology + Roles into single section (was 2 sections with overlapping table). Consolidated heartbeat/CLAUDE.md relationship explanation to one location (was explained 3 times). Moved staleness gate explanation into Section 3 only, referenced elsewhere (was in 4 places). Compressed supporting file templates ~40% (removed redundant markdown scaffolding). Replaced Level 1 checklist + script duplication with script + manual-only supplement. Collapsed Level 3 tests from 6 verbose procedures to compact table (same coverage). Simplified SessionEnd hook JSON (removed fragile inline python). Cut "Phase 4: Emergency Exit" from workflow (duplicated error handling table). Tightened anti-patterns table phrasing. Net reduction: ~25% fewer lines, zero information loss. |
| 3.0 | 2026-02-07 | Added: staleness gate, connectivity map, error handling matrix, testing infrastructure (3 levels), implementation checklist, hook limitations, multi-agent handoff with Claude Pro gap analysis, minimum viable SeshMem, field requirements, emergency exit procedure. Fixed from v2: no fallback for missing heartbeat, no staleness detection, no testing path, no error handling for corruption/conflicts, hooks oversimplified. |
| 2.0 | 2026-02-07 | Rewrite from v1. Added CLAUDE.md/heartbeat.md separation, anti-patterns, workflow phases. Research-backed against OpenClaw heartbeat, AGENTS.md, session handoffs, Anthropic context engineering. |
| 1.0 | 2026-02-07 | Initial outline by Forces. |
