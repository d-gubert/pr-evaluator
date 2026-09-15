# pr-evaluator

The tool measures the risk of a change. It takes a base ref and a head ref. It
finds the modules the change touches. It reports the facts of `docs/design.md`
per module, with the base value, the head value and the delta.

This is a prototype. It does not compute a composite score. Read
`docs/design.md` for the decisions and `docs/prototype-findings.md` for what
the prototype measured.

## Run it

```bash
pnpm install
pnpm evaluate -- --repo <path-to-repo> --base <ref> --head <ref>
```

Options:

| option | meaning |
|---|---|
| `--repo <path>` | the repository. It must hold `node_modules`. |
| `--base <ref>` | the base ref. Required. |
| `--head <ref>` | the head ref. Default `HEAD`. |
| `--config <file>` | module patterns, effect catalog, providers. See `src/config.ts`. |
| `--coverage-head <file>` | istanbul `coverage-final.json` or `lcov.info`. |
| `--coverage-base <file>` | the same, for the base tree. |
| `--json <file>` | write the full report. JSON is the contract; the table is a view. |
| `--symbols <n>` | how many changed symbols to print per module. Default 6. |
| `--keep-worktree` | keep the temporary worktrees, to debug a run. |

Example:

```bash
pnpm evaluate -- --repo ~/dev/RocketChat/worktrees/accessor-consolidation \
  --base 17dfc71b4a~1 --head 17dfc71b4a --json report.json
```

## Symbol mode

A second entry reports the same facts for one symbol, on one tree, with no diff.
It exists to look at a number the module unit hides. Read `docs/symbol-mode.md`.

```bash
pnpm symbol -- --repo <path-to-repo> --symbol <file>#<Name>
pnpm symbol -- --repo <path-to-repo> --symbol <Name> --compare-edges --html out.html
```

| option | meaning |
|---|---|
| `--symbol <ref>` | `<file>#<Name>`, `<file>#<Class>.<method>`, or a bare name to search. |
| `--edge file\|module\|package\|repo` | where the transitive walk stops. Default `module`, which is D6. |
| `--compare-edges` | walk at all four edges and print the four results together. |
| `--follow-dist` | enter a sibling package through its source, not its built `.d.ts`. |
| `--full-program` | load the whole tsconfig. Default is a lazy program. |
| `--no-closures` | keep every `function-type` stop. The closure pass of D17 is on by default. |
| `--html <file>` | the whole report as one self-contained page. |
| `--dot <file>` | the call graph as Graphviz. |

A run costs 11s to 13s on Rocket.Chat, against 43s for the two-tree module run.

## What it reports

| fact | state | decision |
|---|---|---|
| 1. module boundary | built | D1, D2, D3 |
| 2. cyclomatic complexity | built | D6 |
| 3. direct dependencies | built | D8 |
| 4. indirect dependencies, with a hop count | built | D8 |
| 5. side effects | built | D7 |
| 6. test coverage | built, never exercised against a real report | D9 |

Every module carries a confidence value and the reasons that lowered it. A
marked complexity number is a floor, not a total. (D14)

## Requirements

- Node 22 or later, and pnpm.
- `ast-grep` on the PATH, for the effect catalog and the boundary providers.
  Without it the tool still reports facts 1, 2, 3 and 4.
- `turbo` in the target repository, for the workspace map. A `package.json`
  crawl fills the gaps.

## Cost, measured on Rocket.Chat

| step | cost |
|---|---|
| workspace map | 0.9s per tree |
| tier 1, 8731 files | 2.5s to 4.2s per tree |
| module model | 0.4s per tree |
| tier 2, a `packages/*` program | 2s to 6s per tree |
| tier 2, the `apps/meteor` program | 22s per tree |

A whole run over two trees costs 20s to 60s, and the tier 2 program load
dominates.

## Tests

```bash
pnpm exec tsx test/complexity-fixture.ts                       # 17 hand-counted cases
pnpm exec tsx test/complexity-crosscheck.ts <repo> <dir>        # D13, two implementations
pnpm exec tsx test/closures-fixture.ts                          # D17, 9 hand-counted cases
pnpm typecheck
```

The cross-check compares the statement walk against a token walk over every
file of a directory. The two must agree exactly. It found three real bugs in
the counter, so run it after every change to `src/complexity.ts`.

## Layout

| file | job |
|---|---|
| `src/config.ts` | module patterns, effect catalog, boundary providers |
| `src/workspace.ts` | the turbo map, and the `dist` to `src` remap (D15) |
| `src/tier1.ts` | the syntactic scan and the re-export follower (D5) |
| `src/modules.ts` | module detection, the boundary surface, the dependencies |
| `src/complexity.ts` | the cyclomatic counter and its cross-check counter (D6) |
| `src/closures.ts` | the local closure pass, which removes a false stop (D17) |
| `src/tier2.ts` | the typed pass: call graph, complexity, effects (D5, D6, D7) |
| `src/effects.ts` | the ast-grep layer (D3, D7) |
| `src/coverage.ts` | istanbul and lcov, reduced to line hits (D9) |
| `src/delta.ts` | head model minus base model (D4) |
| `src/report.ts` | the table view (D12) |
| `src/git.ts` | the worktrees and the change set (D4) |
| `src/cli.ts` | the pipeline |
| `src/symbol.ts` | symbol mode: the six facts for one symbol, on one tree |
| `src/symbol-report.ts` | the symbol view, plus the Graphviz export |
| `src/symbol-html.ts` | the symbol report as one self-contained page |
| `src/symbol-cli.ts` | the symbol entry |
