# Plan: yast CLI

## Goal

Turn the single-file script of commit 5ff6e5b into a CLI with clear module boundaries.
The CLI reads a session log and writes the step-through HTML page.

- If the user gives a session path (or ID), the CLI uses it.
- If not, the CLI lists the sessions of the profile directory
  (`$CLAUDE_CONFIG_DIR`, else `~/.claude`) and lets the user pick one.
- The output rules stay: `-o FILE`, `--stdout`, else `<session-id>.trace.html` in the current directory.
- The parser layer accepts more log formats later (logs of other harnesses).

## Architecture

```
bin/yast.ts        entry: calls run(argv, io)
src/cli/                    args, run, pick, list table          (T4)
src/sources/                find session files on disk            (T3)
src/formats/                parse one log file → Session          (T1)
src/model.ts                Session model (the contract)          (done)
src/view/                   Session → View (steps)                (T2)
src/render/                 View → HTML (page.html: the template) (T2)
dist/                       build output of tsc (not in git)      (T6)
```

All files are TypeScript (T6). `npm run build` compiles to `dist/` and copies `src/render/page.html`; the `bin` of `package.json` is `dist/bin/yast.js`. In the module names below, `.js` is the name of a module in an import (NodeNext); the file is `.ts`.

Data flow: `source → path → format.parse → Session → toView → renderHtml → file`.

Dependency rules (an import from a lower row to a higher row is not allowed):

| Module        | Can import                                  |
| ------------- | ------------------------------------------- |
| `cli`         | `sources`, `formats`, `view`, `render`      |
| `sources`     | node built-ins only                         |
| `formats`     | `model.ts` (types, and the makers of branded values) |
| `view`        | `model.ts` (types, and the makers of branded values) |
| `render`      | node built-ins only (it gets a View)        |

## Tasks

| Task | File | Depends on | Can run with |
| ---- | ---- | ---------- | ------------ |
| T1 Formats: registry and Claude Code parser | `tasks/T1-formats.md` | – | T2, T3 |
| T2 View and HTML renderer | `tasks/T2-view-render.md` | – | T1, T3 |
| T3 Session sources: profile dir, list, resolve | `tasks/T3-sources.md` | – | T1, T2 |
| T4 CLI: args, picker, run | `tasks/T4-cli.md` | T1, T2, T3 | – |
| T5 Wire up, end-to-end tests, docs, remove old script | `tasks/T5-finish.md` | T4 | – |
| T6 Convert to TypeScript, write the invariants as types | `tasks/T6-typescript.md` | T5 | – |

## Fixed inputs (do not edit)

- `src/model.ts`: the Session model (it was `src/model.js` until T6).
- `test/fixture.jsonl`: a Claude Code log with all event kinds.
- `test/golden/fixture.session.json`: the Session that T1 must produce from the fixture.
- `test/golden/fixture.steps.json`: the steps that T2 must produce from that Session.
  It is the output of the old script, so the refactor keeps the view the same.

## Rules for every task

- Node.js 18 or later. TypeScript, compiled to ES modules. Imports end with `.js` (NodeNext).
  No runtime dependencies. `typescript` and `@types/node` are dev dependencies.
  (T1–T5 used JavaScript with JSDoc types; T6 converted them.)
- Import model types with `import type { Session } from '../model.js'`.
- Tests use `node:test` and `node:assert/strict`. Put them in `test/<area>/*.test.ts`.
- Change only the files that your task lists. Do not change the fixed inputs.
  If a fixed input looks wrong, stop and report it. Do not work around it.
- Do not commit. Do not push. The lead reviews and commits.
- The old single-file script (commit 5ff6e5b) is the reference for behavior. Copy logic from it, but
  do not import it.
- Node 22 does not take a directory as a `node --test` argument. Use a glob on the compiled
  tests, for example `node --test 'dist/test/cli/*.test.js'` after `npm run build`, or
  `npm test` to build and run every test.
