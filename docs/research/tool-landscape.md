# Tool landscape — what to adopt, what to reject

Status: survey of 2026-09-15. Every timing in this file comes from a run
against the reference checkout
`/home/douglas-gubert/dev/RocketChat/worktrees/accessor-consolidation`
(branch `develop`, `cfe9a3bfc4`). Claims about a tool come from the tool's
own repository, its own documentation, its npm metadata or its license text.
The appendix lists the commands.

## Recommendation

Adopt four tools: turbo `--dry=json` for the workspace map, `ast-grep` for
the boundary providers and the effect catalog, the Codecov public API for
coverage, and `dependency-cruiser` as a test oracle. Reject SCIP,
`scip-typescript`, stack-graphs, CodeQL, Joern, Glean, `madge`, `skott`,
`ts-prune` and every off-the-shelf complexity library. Build four things
ourselves: the tier 1 import scan, the call graph, the cyclomatic counter and
the module model. No tool on the market computes a CRAP-style number per
change at a module boundary. Our own cyclomatic counter is 50 lines, it runs
6.5 times faster than the ESLint rule, and it matches the D6 definition
exactly, so a dependency there buys nothing.

## Master table

`F1` module boundary, `F2` cyclomatic complexity, `F3` direct dependencies,
`F4` indirect dependencies, `F5` side effects, `F6` coverage. A mark means
the tool produces the fact in a form we can use. A dash means it does not.

| Tool | F1 | F2 | F3 | F4 | F5 | F6 | Maturity | License | Fit |
|---|---|---|---|---|---|---|---|---|---|
| turbo `--dry=json` | – | – | part | part | – | – | 2.9.14, active | MIT | **adopt** — workspace map |
| ast-grep | part | – | – | – | part | – | 0.45.3, active | MIT | **adopt** — providers, effects |
| Codecov API v2 | – | – | – | – | – | yes | public, no token | service | **adopt** — coverage source |
| istanbul `coverage-final.json` | – | – | – | – | – | yes | nyc 18.0.0, active | ISC / BSD-3 | **adopt** — best format |
| dependency-cruiser | – | – | yes | yes | – | – | 18.3.1, 2026-09-14 | MIT | **adopt as oracle** only |
| lcov | – | – | – | – | – | part | stable | — | fallback format |
| madge | – | – | yes | yes | – | – | 8.0.0, 2024-08 | MIT | reject |
| skott | – | – | yes | yes | – | – | 0.35.12, install broken | MIT | reject |
| knip | part | – | – | – | – | – | 6.35.1, active | ISC | reject, watch |
| ts-prune | part | – | – | – | – | – | 0.10.3, 2022 | MIT | reject, dead |
| Nx project graph | – | – | part | part | – | – | active | MIT | reject, wrong repo |
| SCIP + scip-typescript | part | – | yes | yes | – | – | 0.4.0, active | Apache-2.0 | reject for now |
| LSIF | part | – | yes | yes | – | – | superseded | MIT | reject |
| stack-graphs | part | – | part | part | – | – | **archived 2025-09-09** | Apache-2.0/MIT | reject |
| Glean | part | – | yes | yes | – | – | active, Haskell | BSD | reject |
| CodeQL | yes | yes | yes | yes | yes | – | active | **restricted** | reject on license |
| Joern | yes | yes | yes | yes | yes | – | active, JVM | Apache-2.0 | reject on cost |
| Semgrep OSS | part | – | – | – | part | – | active | LGPL-2.1 | reject for F5 |
| Semgrep Pro | – | – | – | – | yes | – | commercial | paid | out of scope |
| tree-sitter | part | part | part | – | part | – | active | MIT | keep for language 2 |
| ESLint `complexity` | – | part | – | – | – | – | 10.10.0, active | MIT | reject, wrong count |
| SonarJS ESLint plugin | – | – | – | – | – | – | 4.2.1, active | LGPL-3.0 | reject, cognitive only |
| typhonjs-escomplex | – | – | – | – | – | – | 0.1.0, 2022 | MPL-2.0 | reject, no TS |
| escomplex | – | – | – | – | – | – | alpha, 2022 | MIT | reject, dead |
| ts-complexity | – | part | – | – | – | – | 0.0.3, 2022 | ISC | reject, dead |
| lizard | – | part | – | – | – | – | active | MIT | keep for language 2 |
| scc, tokei | – | – | – | – | – | – | active | MIT | reject, file level |
| v8-to-istanbul | – | – | – | – | – | part | 9.3.0, 2024 | ISC | conditional |
| monocart-coverage-reports | – | – | – | – | – | yes | 2.13.0, active | MIT | conditional |
| code-maat | – | – | – | – | – | – | 2025-07 | GPL-3.0 | reject, VCS only |
| git-of-theseus | – | – | – | – | – | – | 2023-11 | Apache-2.0 | reject, VCS only |
| CodeScene | – | part | – | – | – | part | commercial | paid | reject, different goal |
| SonarQube new code | – | part | – | – | – | part | active | LGPL / paid | reject, file level |
| danger-js | – | – | – | – | – | – | active | MIT | possible CI shell |
| Code Climate | – | part | – | – | – | part | commercial | paid | reject |

## Adopted candidates

### turbo `--dry=json` — the workspace map (D15)

The reference repo already holds turbo 2.9.14. The command
`turbo run build --dry=json` runs no task and it prints the task graph.

Measured: **0.63 s**. The output names 79 packages. Each entry carries
`package`, `directory`, `dependencies` and `dependents`. Example:
`@rocket.chat/abac -> ee/packages/abac`.

This is the name-to-directory table that D15 needs, and it covers the nested
workspaces (`ee/packages/*`, `ee/apps/*`, `apps/meteor/ee/server/services`)
that a glob over `packages/*` misses. The `dependencies` and `dependents`
lists give a package-level dependency graph for free, which is a coarse
cross-check for F3 and F4.

Integration point: the **workspace map** step, before tier 1. Fall back to a
scan of the `workspaces` field when the repo has no turbo.

Limit: the graph is package-level. D1 modules are directories inside a
package, so this does not replace tier 1.

### ast-grep — boundary providers (D3) and the effect catalog (D7)

`ast-grep` 0.45.3 is a tree-sitter pattern matcher with a CLI and a JSON
output. It is MIT and it is active.

Measured, over all of `apps/meteor`: the pattern `API.v1.addRoute($$$ARGS)`
returns **133 matches in 0.26 s**. A `grep -rn "API\.v1\.addRoute("` over the
same tree returns **133**, so the agreement is exact. The pattern
`setTimeout($$$A)` over `apps/meteor/server` returns 34 matches.

This serves the `apiRouteProbe` of D3 and the syntactic half of the D7
catalog. A provider becomes a pattern string in the config instead of a
hand-written AST visitor. The same pattern language covers Python, Go and
Kotlin, so the provider config carries to a second language.

Integration point: **tier 1**, as the provider engine and as the first pass
of the effect catalog. Tier 2 still owns the propagation of an effect up the
call graph, because ast-grep has no call graph.

Cost: one binary dependency per platform. The npm package `@ast-grep/cli`
needs its own directory, because it conflicts with the peer ranges of the
other tools in a shared install.

### Codecov API v2 — the coverage source (open question 6)

Rocket.Chat publishes coverage to Codecov and the repository is public. The
API needs **no token**.

Measured at the reference commit `cfe9a3bfc4`:

| endpoint | result |
|---|---|
| `/repos/Rocket.Chat/` | `coverage 69.44`, 4323 files, 3 sessions |
| `/repos/Rocket.Chat/report/?sha=<sha>` | HTTP 200, **2.60 MB**, 4323 files |
| `/repos/Rocket.Chat/file_report/<path>` | 404 for a path with no coverage |

The report carries a `line_coverage` array per file: `[line, state]`. The
state counts sum exactly to the totals — 125322 entries of `0` against
`hits: 125322`, 50081 entries of `1` against `misses: 50081`, 5053 entries of
`2` against `partials: 5053`. So `0` is hit, `1` is miss and `2` is partial.
Confirm this against a file with a known result before the prototype trusts
it.

Three limits, all measured:

1. The report covers 4323 files. The repo holds 9282 source files, so 53% of
   the tree has no coverage row.
2. 3705 of the 4323 files sit under `apps/meteor`. **Zero** sit under
   `packages/apps`. A PR that only touches an internal package gets no
   coverage at all.
3. The data is line-level. It carries no function map, so D9 must map lines
   onto the symbol range itself.

`codecov.yml` sets `fixes: '/home/runner/work/Rocket.Chat/Rocket.Chat/::'`,
so the paths in the report are already repo-relative.

Integration point: the **coverage step**, as the default source when the
caller gives no local report. The commit is addressable by SHA, so the base
tree and the head tree each get their own report. That satisfies D9's
requirement that the report and the tree match.

### istanbul `coverage-final.json` — the format we should ask for

We generated both formats with nyc 18.0.0 from a two-function file. The
difference is decisive for D9.

`coverage-final.json` carries a `fnMap`:

```json
"0": { "name": "add",
       "decl": { "start": {"line":1,"column":9},  "end": {"line":1,"column":12} },
       "loc":  { "start": {"line":1,"column":19}, "end": {"line":1,"column":65} },
       "line": 1 }
```

with `f: {"0":1,"1":0}` for the hit count per function, and a `branchMap`
with a location per branch and `b` for the hit count per branch arm.

`lcov.info` carries `FN:1,add` — the **start line and the name only**. It
carries no end line, so the consumer must recover the range from the AST.

The `fnMap` gives the symbol name, the full body range and the hit count in
one record. That maps onto a boundary symbol with no inference. The
`branchMap` also pairs with D6: it carries branch locations that we can
compare against our own branch count.

Rocket.Chat's own script emits the weaker format. `apps/meteor` runs
`.testunit:server:cov` as `nyc -r text -r lcov mocha`, and `test:e2e:nyc` as
`nyc report --reporter=lcovonly`. A one-word change (`-r json`) would emit
`coverage-final.json` beside the lcov.

Integration point: the **coverage step**. Support three inputs in this order
of preference: `coverage-final.json`, the Codecov report, `lcov.info`.

### dependency-cruiser — a test oracle, not the engine

`dependency-cruiser` 18.3.1 is MIT and it is the best-maintained tool in this
category; npm shows a publish on 2026-09-14. It resolves correctly, but it is
too slow to carry tier 1.

Measured:

| scope | wall | peak RSS | modules | edges |
|---|---|---|---|---|
| `packages/apps/src` | 1.04 s | 340 MB | 653 | 1603 |
| `apps/meteor/server` | 7.09 s | 916 MB | 5429 | 22427 |
| `apps/meteor` + `packages` + `ee` | **45.56 s** | **3.89 GB** | 24536 | 59886 |

Tier 1 does the same job in 2.6 s at 0.28 ms per file. dependency-cruiser
costs 1.86 ms per module, so it is 6.6 times slower per unit and 17.5 times
slower for the whole job. D4 needs two trees, so the real comparison is 91 s
against 5 s, at 3.9 GB. That rules it out as the engine.

Two accuracy findings that transfer to our own tier 1:

1. **Type-only imports need a flag.** Without `--ts-pre-compilation-deps`,
   `packages/apps/src` reports 222 modules and 351 edges. With the flag it
   reports 653 modules and 1603 edges, of which **341 are `type-only`**. The
   flag changes the edge count by a factor of 4.6. This matches the 24.2%
   type-only rate in `probe-findings.md`, and it confirms open question 8:
   a type-only import is a real edge and it must be marked.
2. **The `dist` redirect is not solved by any tool.** The 68 distinct
   `@rocket.chat/*` specifiers in `apps/meteor/server` resolve to **68 paths
   under `<package>/dist/`, and 0 under `<package>/src/`**. Example:
   `@rocket.chat/apps -> packages/apps/dist/index.js`. dependency-cruiser
   does follow the workspace symlink back to the real package directory,
   which is better than the raw `node_modules/@rocket.chat/apps` path that
   the TypeScript checker gives, but it still lands on the build output.
   D15 stands, unchanged.

Integration point: **the test suite**. Run dependency-cruiser over a fixture
and compare its edge set against tier 1's edge set. It answers open question
10 — how often tier 1 is wrong — without a second engine in the product.

## Rejected, and why

- **SCIP and `scip-typescript`** — the format carries occurrences and
  relationships, not call edges. Measured on `packages/apps`: 20233
  occurrences, 3983 definitions, and only **1120 occurrences (5.5%) carry an
  `enclosing_range`**, so we cannot rebuild caller-to-callee from it. The
  index of `apps/meteor` cost **65.1 s and 4.1 GB RSS** for a 134 MB file,
  against 12.3 s for a ts-morph program load. It serves F1, F3 and F4 but not
  F2, F5 or F6.
- **LSIF** — superseded by SCIP. `sourcegraph/lsif-node` is archived since
  2022-07-20. Same missing call edges.
- **stack-graphs** — **archived by GitHub on 2025-09-09**: "This repository is
  no longer supported or updated by GitHub." It also solves name resolution
  only, not the call graph.
- **Glean** — a Haskell server with its own storage. TypeScript reaches it
  only through SCIP or LSIF, so it inherits the missing call edges and adds
  an index server.
- **CodeQL** — the license forbids it. The CLI terms forbid use "in
  connection with any codebase that is not an Open Source Codebase (e.g.,
  code in a private repo in GitHub)" and forbid use to "generate any CodeQL
  database for or during automated analysis, CI or CD", except for an open
  source codebase hosted on GitHub.com. A paid GitHub Advanced Security
  license lifts both restrictions. A code-review tool must run on private
  repositories, so the free terms do not cover our use.
- **Joern** — it computes every fact, on a JVM, from a code property graph.
  It needs JDK 21 and a CPG build per tree. The cost is far above 12.3 s and
  the TypeScript frontend is not its strongest. Revisit only if we need
  inter-procedural data flow.
- **Semgrep OSS** — taint mode is intra-procedural: "Taint propagators only
  work intraprocedurally, that is, within a function or method."
  Inter-procedural and inter-file analysis are Semgrep Pro features. F5 needs
  propagation across functions, so the free engine does not serve it.
- **madge** — 1.02 s on `packages/apps/src` and 6.35 s on
  `apps/meteor/server`, so it is comparable to dependency-cruiser in speed,
  but it reports a plain file-to-file map with no dependency type. It cannot
  mark a type-only edge. Last publish 2024-08-05.
- **skott** — `npm install skott` **fails**. Version 0.35.12 depends on
  `skott-webapp@^2.4.0`, and the newest published `skott-webapp` is 2.3.0.
- **`ts-prune`** — last publish 2022-05-22. Its own README points to knip.
- **knip** — fast (0.54 s on `packages/apps`) and well maintained, but it
  answers "which export is unused", which our tier 1 importer index already
  answers as the used surface of D2. It also needs a config per workspace.
- **Nx project graph** — Rocket.Chat is a turbo and yarn workspace, not an
  Nx workspace. Adopting Nx to read a graph is not proportionate.
- **ESLint `complexity` rule** — it counts a different set of nodes. The rule
  source increments on `CatchClause`, `ConditionalExpression`,
  `LogicalExpression`, `ForStatement`, `ForInStatement`, `ForOfStatement`,
  `IfStatement`, `WhileStatement`, `DoWhileStatement`, `SwitchCase[test]`,
  a logical assignment operator, **`AssignmentPattern`**, an optional
  `MemberExpression` and an optional `CallExpression`. The last three are not
  in D6. Measured on `apps/meteor/server`: the rule reports 7307 functions
  and a total of **22418**, our D6 counter reports 7238 functions and
  **20176**, a gap of 2242. The same tree holds 1583 optional member
  accesses, 27 optional calls, 327 default parameters, 283 destructuring
  defaults and 7 logical assignments — 2227 increments, which explains the
  gap almost exactly. The rule also reports only the head position of a
  function, not its range, and it gives no symbol id. It is 6.5 times slower
  than our counter (4250 ms against 658 ms).
- **SonarJS ESLint plugin** — its rule list holds `cognitive-complexity` and
  `regex-complexity` and no cyclomatic rule. Cognitive complexity weights
  nesting and it is not comparable to McCabe. LGPL-3.0 also complicates
  distribution.
- **typhonjs-escomplex** — it **fails to parse TypeScript**. On
  `AppSettingsManager.ts` it throws `Unexpected token, expected "from" (2:12)`
  at the `import type` line. It parses plain JavaScript (30 methods on
  `rateLimiter.js`). Last publish 2022-06-28.
- **escomplex**, **ts-complexity** — last published 2022, both effectively
  unmaintained. `ts-complexity` also failed to resolve an absolute tsconfig
  path in our run.
- **scc, tokei** — file-level line counts. `scc` estimates a complexity score
  by keyword frequency per file, not per function. Neither is addressable by
  symbol.
- **Rollup `treeshake.moduleSideEffects` and the `sideEffects` package.json
  field** — these are a *declaration* by the package author, not an analysis.
  They answer "may I drop this module", at module granularity, and they say
  nothing about which effect a function triggers.
- **`es-module-lexer`** — it lists the imports and exports of a module very
  fast. It performs no name resolution and no call analysis. Tier 1 already
  parses with the TypeScript scanner at 0.22 ms per file, which is fast
  enough, and it needs the type-only flag that the lexer does not give.
- **`eslint-plugin-functional`** — it enforces a functional style (no
  mutation, no `let`, no exception). It flags impurity as a lint error. D7
  rejected impurity inference already, and this plugin confirms the reason:
  it flags almost every line of Rocket.Chat.
- **code-maat** — it reads version-control history only: coupling, churn,
  age, authors. It measures no complexity, no coverage, no boundary and no
  dependency. GPL-3.0.
- **git-of-theseus** — a survival plot of code age. Last push 2023-11-25. No
  overlap with the six facts.
- **CodeScene** — commercial, free for open source. It measures Code Health,
  hotspots and change coupling, and it reviews a PR. Its unit is the file,
  not the module boundary, and it does not expose a per-symbol complexity
  and coverage pair. It answers "which file is risky over time". We answer
  "what did this change do to this module's boundary". Different questions.
- **SonarQube new code** — the reference-branch new-code definition is the
  right idea, and the default gate holds "New code test coverage ≥ 80%". It
  reports per-file coverage and complexity, not per boundary symbol, and it
  computes no CRAP-style pair. Confirms the shape of D4; replaces nothing.
- **Code Climate** — commercial, file-level maintainability grades. Same gap
  as SonarQube, with less transparency about the metric.
- **danger-js** — it is a CI rule runner for a PR, with no analysis of its
  own. Keep it in mind as the CI shell that posts our JSON later. It is not
  a source of any fact.
- **Infer** — Java, C, C++, Objective-C. No TypeScript. Out of scope.
- **v8-to-istanbul** and **monocart-coverage-reports** — both are good, and
  both are unnecessary today. They convert V8 coverage into the istanbul
  shape. Rocket.Chat already produces istanbul data through nyc. Adopt
  `monocart-coverage-reports` only if a future runner emits raw V8 coverage.

## The multi-language story

D11 asks for a `LanguageAdapter` seam that emits a neutral graph. The survey
finds no format that carries the whole neutral graph for more than one
language.

| option | F1, F3, F4 | F2 | F5 | F6 | verdict |
|---|---|---|---|---|---|
| SCIP | yes, many languages | no | no | no | half the graph |
| stack-graphs | yes, in principle | no | no | no | archived |
| tree-sitter + our own queries | yes | yes | yes | n/a | **best path** |
| lizard | no | yes, 28 languages | no | no | a useful supplement |
| Joern CPG | yes | yes | yes | no | too heavy |

Keep our own neutral graph. Build the second adapter on **tree-sitter**,
with `ast-grep` as the pattern layer we already adopt for D3 and D7. The
reasons:

1. tree-sitter has a maintained grammar for Python, Go and Kotlin. It is
   MIT and very active.
2. A cyclomatic counter is a node-kind list per grammar. Our TypeScript
   counter is 50 lines and it runs in 658 ms over 1323 files. The Python
   list is the same shape.
3. `ast-grep` already gives the pattern engine, the file walk and the JSON
   output across those grammars, at 0.26 s over 5853 files.

The hard part does not move. tree-sitter gives no name resolution, so each
adapter must resolve an import path and a call target itself. That is exactly
the work that stack-graphs tried to generalize, and GitHub archived it.
Expect the same per-language cost we paid for TypeScript.

Add a **SCIP importer** as a second, optional adapter path. A language with a
mature SCIP indexer (Java, Kotlin, Python, Go) then serves F1, F3 and F4 on
day one, with F2, F5 and F6 marked unknown until the tree-sitter counter
lands. This makes SCIP an accelerator for the boundary facts, not the neutral
graph itself.

`lizard` is a useful supplement for a quick complexity number in a new
language, but it uses partial parsing — its own documentation says it
"calculates how complex the code 'looks' rather than how complex the code
really 'is'". It also emits a start line and no end line, so it is not
addressable by symbol range. Use it to sanity-check a new counter, not to
produce the number.

## What changes in design.md

- **D9 changes.** Prefer `coverage-final.json` over lcov. Its `fnMap` carries
  the function name, the full body range and the hit count, and its
  `branchMap` carries a location per branch. lcov carries `FN:<line>,<name>`
  with no end line. Order the inputs: `coverage-final.json`, then the Codecov
  report, then `lcov.info`. Record in the report which one the run used,
  because the three carry different precision.
- **Open question 6 is mostly answered.** Rocket.Chat publishes coverage to
  Codecov, the repo is public and the API needs no token. A report is
  addressable by SHA, so the base tree and the head tree each get one. Three
  gaps remain: the report covers 4323 of 9282 files, it holds zero files
  under `packages/apps`, and it is line-level. Restate the open question as
  "what do we do for a module with no coverage row", which D14's confidence
  value already answers in shape.
- **D15 keeps its content and gains a cheaper source.** Take the 79-package
  name-to-directory table from `turbo run build --dry=json` in 0.63 s
  instead of a hand-rolled workspace scan. The `dist` to `src` rewrite is
  still ours: 68 of 68 internal specifiers resolve into `dist` under every
  tool we tested.
- **D6's node list is confirmed, and no tool implements it.** ESLint's rule
  adds optional chaining, default parameters and destructuring defaults, and
  it over-counts by 11.1% on `apps/meteor/server`. Write the counter. Pin the
  node list in the code with a fixture that states the expected number.
- **Open question 8 gains evidence.** dependency-cruiser drops 341 of 1603
  edges in `packages/apps/src` when the type-only flag is off — a factor of
  4.6 on the edge count. Treat a type-only import as a real edge and mark it.
- **Open question 2 gains a refinement.** 17.5% of imports land on a barrel,
  but a barrel rarely crosses a module boundary. Of 37699 intra-repo edges,
  2334 (6.2%) land on a barrel, only **26 of 540 barrels re-export across a
  D1 module boundary**, and only **58 edges (0.2%)** would be attributed to
  the wrong module by a tool that stops at the barrel. So the depth-6
  re-export follower is needed for **fact 1** (which symbol came from where),
  not for facts 3 and 4. Lower its priority for the dependency facts and keep
  it for the boundary.
- **Open question 10 gains a method.** Use dependency-cruiser as the oracle.
  Run it over a fixture, compare its edge set against tier 1's, and report
  the disagreement rate. This is a test-only dependency.
- **Open question 12 is unchanged, and the evidence is stronger.** Different
  resolvers land on different files inside the same `dist`: the TypeScript
  checker gives `dist/**/*.d.ts` under `preserveSymlinks`, dependency-cruiser
  gives `dist/index.js` through the package entry. Both are build output. The
  `src` override stays the cheapest answer.
- **D3 gains an implementation.** Write a provider as an `ast-grep` pattern,
  not as an AST visitor. Measured: 133 matches in 0.26 s over `apps/meteor`,
  which equals the `grep` count exactly.
- **D7 gains a tier 1 half.** Use `ast-grep` patterns for the catalog hits.
  Keep the propagation in tier 2. Open question 5 (catalog coverage) is still
  open and it is now cheap to measure: run each catalog pattern over the tree
  and count.
- **D11 stands.** No format carries the whole neutral graph. SCIP carries the
  boundary half for many languages and no call edges, so it becomes an
  optional adapter, not the seam itself.

## Appendix — how the measurements ran

All runs used Node v24.20.0 on Linux. Tools were installed in a scratch
directory, not in the project. The scratch directory is removed.

| tool | version | command |
|---|---|---|
| dependency-cruiser | 18.3.1 | `depcruise --no-config --ts-pre-compilation-deps --output-type json --ts-config <tsconfig> --do-not-follow node_modules <dirs>` |
| madge | 8.0.0 | `madge --json --extensions ts,tsx,js,jsx <dir>` |
| scip-typescript | 0.4.0 | `scip-typescript index --output <file>` from the package root |
| ast-grep | 0.45.3 | `ast-grep run --pattern '<p>' --lang ts --json=compact <dir>` |
| turbo | 2.9.14 | `turbo run build --dry=json` |
| knip | 6.35.1 | `knip --directory <pkg> --config <cfg> --reporter json` |
| eslint | 10.10.0 | `Linter.verify` with `@typescript-eslint/parser` and `complexity: ['warn', {max: 0}]` |
| nyc | 18.0.0 | `nyc --reporter=json --reporter=lcovonly node t.js` |
| Codecov | API v2 | `GET https://api.codecov.io/api/v2/github/RocketChat/repos/Rocket.Chat/report/?sha=<sha>` |

The D6 counter used the TypeScript compiler's `createSourceFile` with no type
checker. It counts `if`, `for`, `for..in`, `for..of`, `while`, `do`, `case`,
`catch`, ternary, `&&`, `||` and `??`, starts each function at 1, and stops
at a nested function boundary.

One warning about a measurement of this kind. The first version of that
counter wrote `sum += walk(node)`, which reads `sum` before `walk` mutates
it, so it discarded every nested count. The bad version reported 15474 for
`apps/meteor/server`; the correct version reports 20176. A cross-check
against a second implementation caught it. Cross-check every metric against a
second implementation before the prototype reports it.
