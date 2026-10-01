# T5: Wire up, end-to-end tests, docs, remove the old script

Read `docs/plan.md` first. T1–T4 are done.

## Scope

Files you change, create, or delete (and no others):

- `package.json`: `"bin": {"session-trace": "./bin/session-trace.js"}`,
  `"scripts": {"test": "node --test", "trace": "node bin/session-trace.js"}`, `"files"` for
  `bin`, `src`, and `README.md`, `"engines": {"node": ">=18"}`.
- Delete `session-trace.mjs` and `test/run.mjs`.
- `test/e2e/cli.test.js`: runs `bin/session-trace.js` as a child process.
- `README.md`: rewrite for the CLI.
- `docs/adding-a-format.md`: how to add a log format of another harness.

## Behavior

The e2e tests use a temporary profile through `CLAUDE_CONFIG_DIR` and a temporary cwd.
They must not touch `~/.claude` or the repo tree.

## Definition of done

1. E2E tests: `--help` exits 0; `--version` prints the package version; `--list` lists the
   copied fixture; a path writes `<id>.trace.html` in the cwd; `-o out/x.html` works when
   `out/` exists; `--stdout` prints HTML that starts with `<!doctype html>`; no argument with
   no TTY exits 2; a bad option exits 2.
2. `README.md` (Simplified Technical English: short sentences, active voice) documents install
   (`npm link` or `node bin/session-trace.js`), usage, options, the profile directory and
   `CLAUDE_CONFIG_DIR`, the output rules, the module layout, the privacy warning (put it before
   the step that shares a page), and the limits from the old README.
3. `docs/adding-a-format.md` shows the `Format` interface, a minimal example format module,
   where to register it, and how to add a source for its session files. It points to
   `src/model.js` as the contract.
4. No code, test, README, or `package.json` refers to `session-trace.mjs` or `test/run.mjs`.
   The task files keep their references: they are the record of the work as dispatched.
5. `npm test` passes. `node bin/session-trace.js --list` exits 0 on this machine.
