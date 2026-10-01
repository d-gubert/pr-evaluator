# T6: Convert the project to TypeScript

Read `docs/plan.md`, `README.md`, and `src/model.js` first.

## Goal

Convert every `.js` file in `bin/`, `src/`, and `test/` to TypeScript. The behavior of the
CLI does not change. Write the invariants of the data as types, so that the compiler rejects
data that breaks them.

## Rules for the types

- Prefer `type` aliases to `interface`. Use an `interface` only where a `type` cannot do the
  job, and write a comment that says why.
- Make the model data `readonly` (properties and arrays).
- Do not use `any`. At the JSON boundary (log lines, `toolUseResult`, tool `input`) use
  `unknown` and narrow it with type guards.
- No `@ts-ignore`, no `@ts-expect-error` outside tests, and no `as` casts that hide a real
  mismatch. An `as const` is fine.
- `tsconfig.json`: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `noImplicitOverride`, `verbatimModuleSyntax`, `module`/`moduleResolution` `NodeNext`,
  `target` ES2022.

## Invariants to encode

Encode each one in the types where TypeScript can express it. Where it cannot, say so in a
comment next to the type and keep (or add) a runtime check or a test.

1. `Session.events`: the first event is `session_start`, the last is `session_end`, and
   neither occurs anywhere else. At most one `context` event, and only directly after
   `session_start`.
2. `SessionEvent` is a discriminated union on `type`. Each event kind is its own named type.
3. `ToolCall`: `result` is `null` exactly when `status` is `'no result'`.
4. A `tool_use` block refers to a `ToolCall` by id. Use a branded `ToolUseId` type for both.
   Also brand `SessionId`. Use a branded or template-literal type for ISO timestamps, and keep
   `''` for an unknown time as an explicit union member.
5. `api_error.count` is 1 or more. `compaction.trigger` is `'auto' | 'manual'`.
6. `Hook.outcome`: the known outcomes as literal types, plus open strings from other harnesses
   (`KnownOutcome | (string & {})`).
7. `Step.k` (the view tags) has at least one element: `readonly [Kind, ...Kind[]]`.
8. CLI arguments are a discriminated union of modes: `help`, `version`, `list`, `trace`.
   `list` cannot carry a session or an output target. The output target of `trace` is
   `{ kind: 'stdout' } | { kind: 'file', path } | { kind: 'default' }`, so `-o` with
   `--stdout` cannot be represented.
9. Exit codes are the union `0 | 1 | 2 | 130`.
10. The format registry and the source registry are non-empty readonly tuples.

## Build and run

- Add `typescript` and `@types/node@^22` as devDependencies (`npm install`). Commit
  `package-lock.json`. No runtime dependencies.
- `tsc` compiles to `dist/`. `package.json` `bin` points to `dist/bin/session-trace.js`. Add
  `"build"`, `"typecheck"` (`tsc --noEmit`), and `"prepare"` (runs the build) scripts.
  Add `dist/` to `.gitignore`.
- The renderer reads `src/render/page.html` at run time. Make it work from `dist/` too (copy
  the asset in the build, or import it as a module string). Choose one, and say why in the
  report.
- The tests are TypeScript too. `npm test` builds, then runs the compiled tests with
  `node --test` and a glob. Node 22 does not take a directory as a `node --test` argument.
- `engines` stays `node >=18`. The compiled output must not need type stripping.

## Fixed inputs (do not change)

- `test/fixture.jsonl`, `test/golden/fixture.session.json`, `test/golden/fixture.steps.json`.
- The HTML, CSS, and script of the page in `src/render/page.html` (apart from build changes).
- The command-line options, the output rules, the exit codes, and the stderr messages.

If a golden file does not satisfy a new type (for example, an invariant that the fixture
breaks), stop and report the exact mismatch. Do not change the golden file.

## Definition of done

1. No `.js` source or test files remain in `bin/`, `src/`, or `test/`. `src/model.js` becomes
   `src/model.ts`.
2. `npm run typecheck` gives no errors. `grep -rnE '\bany\b|@ts-ignore|^\s*(export )?interface ' src bin`
   finds nothing, or each hit has a comment that says why.
3. Every invariant 1–10 is in the types. For each invariant that the compiler enforces, a
   type-level test uses `// @ts-expect-error` to show that the compiler rejects a bad value
   (for example `test/types/invariants.test.ts`). For each invariant that a type cannot
   enforce, a runtime test covers it.
4. `npm test` passes. The golden tests still pass: the parse of the fixture deep-equals
   `fixture.session.json`, and its view deep-equals `fixture.steps.json`.
5. After `npm run build`, `node dist/bin/session-trace.js --list` exits 0, and
   `node dist/bin/session-trace.js <path of test/fixture.jsonl> --stdout` prints a page that
   starts with `<!doctype html>`.
6. `README.md` and `docs/adding-a-format.md` describe the TypeScript layout, the build, and the
   example format module in TypeScript. `docs/plan.md` uses the new file names.
7. The layer rules of `docs/plan.md` still hold: only `src/cli/run.ts` imports more than one
   layer.
