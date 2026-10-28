# claude-quiz-mod

The **quiz-pane** Claude Code mod (function-hooks plugin): a flash-card quiz in a side pane while Claude works, with a live Claude-status header. Content comes from `~/GitHub/quiz-sets`. Built from Dev-Manager item #88.

## Status
- **State:** open
- **Summary:** quiz-pane mod built, installed at user scope, tested (31 plugin tests, tsc strict). Pane pops up only during waits: after 10s of a turn or while background agents run, and closes itself 3s after; first set CompTIA Security+ SY0-701 (32 blind-verified questions); /quiz-research skill researches and verifies new sets.
- **Updated:** 2026-10-28
- **Links:** https://github.com/sohosteve/claude-quiz-mod, https://github.com/sohosteve/quiz-sets
- **Open:**
  - Push the auto-popup change and `claude plugin update quiz-pane`, then try it live (unasked panes need 144 cols, 110 after one /quiz)
  - Security+ V8 replaces SY0-701 around 2026-11-17: add a V8 set when its objectives are published
  - Later phase: web front end for managing sets and reviewing research output

## Rules
- Develop in place: `claude --plugin-dir .`, then `claude plugin validate .` and `claude plugin test .`.
- Plugin API constraints that bit during the build: `$` may only be passed to top-level function declarations; atoms used with `read`/`update` must be declared in the same file as the call (all state lives in `hooks/actions.ts`); render hooks never write state.
- Remote quiz content is untrusted: https only, 2 MB body cap, set path always `sets/<slug>.json`, control characters stripped before drawing.
- The `tool.call` hook must never await before `next(e)`: it sits on Claude's hot path.
- Pop-up lifecycle lives in `tick()` (`hooks/actions.ts`): one 1s ticker spans turn + background agents; `autoOpened` marks a pane the plugin may close, `/quiz` and a close by hand release it.
- Tests: the kit's `$` has no `ui.close`, so a close by hand cannot be raised from a test.
