# claude-quiz-mod

The **quiz-pane** Claude Code mod (function-hooks plugin): a flash-card quiz in a side pane while Claude works, with a live Claude-status header. Content comes from `~/GitHub/quiz-sets`. Built from Dev-Manager item #88.

## Status
- **State:** open
- **Summary:** quiz-pane mod built, code-reviewed and tested (20 plugin tests, tsc strict); first set CompTIA Security+ SY0-701 (32 blind-verified questions) ready in quiz-sets; /quiz-research skill researches and verifies new sets.
- **Updated:** 2026-10-28
- **Links:** https://github.com/sohosteve/claude-quiz-mod, https://github.com/sohosteve/quiz-sets
- **Open:**
  - Create and push the two public GitHub repos, then install the mod at user scope
  - Try it live in a 144+ column terminal and adjust the pane layout
  - Security+ V8 replaces SY0-701 around 2026-11-17: add a V8 set when its objectives are published
  - Later phase: web front end for managing sets and reviewing research output

## Rules
- Develop in place: `claude --plugin-dir .`, then `claude plugin validate .` and `claude plugin test .`.
- Plugin API constraints that bit during the build: `$` may only be passed to top-level function declarations; atoms used with `read`/`update` must be declared in the same file as the call (all state lives in `hooks/actions.ts`); render hooks never write state.
- Remote quiz content is untrusted: https only, 2 MB body cap, set path always `sets/<slug>.json`, control characters stripped before drawing.
- The `tool.call` hook must never await before `next(e)`: it sits on Claude's hot path.
