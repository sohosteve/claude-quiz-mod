# quiz-pane

A Claude Code mod that turns wait time into study time. While Claude works, a **Quiz** pane docks
beside the transcript: flash cards with 5 choices, an explanation and cited sources after each
answer. The pane's header shows Claude's live state (working time, current tool, running agents),
and the transcript stays fully visible, so you never lose sight of the task.

- `/quiz` opens the pane; `/quiz <set-slug>` jumps straight into a set.
- Keys inside the pane: `1`-`5` answer, `n` next card, `m` back to the sets list, `r` refresh sets.
- Score, streak and missed questions persist per set. Every third card replays a question you missed until you get it right.
- Sets come from [sohosteve/quiz-sets](https://github.com/sohosteve/quiz-sets) and are cached, so play works offline.

## Install

At the prompt of a terminal Claude Code session:

```
/plugin install quiz-pane --marketplace sohosteve/claude-quiz-mod
```

From a shell:

```
claude plugin install quiz-pane --marketplace sohosteve/claude-quiz-mod
```

Answer `y` to add the marketplace, then pick a scope (user scope = every session).

This repository is private: installing needs read access on GitHub and a git credential for github.com on the machine (`gh auth login`, then `gh auth setup-git`).

## Options (`/config`)

| Option | Default | What it does |
| --- | --- | --- |
| `source` | `https://raw.githubusercontent.com/sohosteve/quiz-sets/main` | Base URL or a local folder holding `index.json` and `sets/` |
| `autoOpen` | `true` | Open the pane when a turn starts. It docks unasked only on terminals 144+ columns wide; narrower, the status line says `/quiz` instead |

## Adding question sets

Use the `/quiz-research "<subject or cert>"` skill: it researches from official docs and standards,
blind-verifies every answer against its sources, and publishes to the quiz-sets repo. See that
repo's README for the format.

## Develop

```
claude plugin validate .
claude plugin test .
claude --plugin-dir .
```

Roadmap: a web front end for managing sets and reviewing research output.
