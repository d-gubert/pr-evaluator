# PR evaluator — prototype design

Status: agreed in the interview of 2026-09-15, then corrected by the probe
round and the tool research of the same day. Decisions are load-bearing.
Open questions are at the end.

Backing measurements:
- `probe-findings.md` — call resolution and barrel probes.
- `research/tool-landscape.md` — what we adopt, what we build, what we reject.
- `research/gitnexus.md` — why we do not depend on gitnexus.

Reference checkout:
`/home/douglas-gubert/dev/RocketChat/worktrees/accessor-consolidation`.
Fixture PRs: 41981, 42125, 41201. PR 42125 targets a feature branch, not
`develop`, so the base ref is not always the default branch.

## Purpose

The tool measures the risk of a change. It takes a base ref and a head ref.
It finds the modules the change touches. It reports six facts per module,
with the base value, the head value and the delta.

The six facts:

1. Module boundary — the symbols the module exposes to other modules.
2. Cyclomatic complexity — per boundary symbol.
3. Direct dependencies added — per module.
4. Indirect dependencies added — per module.
5. Side effects triggered — per boundary symbol, rolled up per module.
6. Test coverage — per boundary symbol.

The CRAP framework is the inspiration. The prototype does not compute a
composite score. We first look at real numbers from real PRs.

## Decisions

### D1 — A module is a directory

A module is a directory that a config pattern matches. An entry file is not
a requirement.

The config overrides the pattern per path. Rejected: workspace packages only
(too coarse for apps/meteor), import-graph clustering (boundaries move
between runs).

Patterns for Rocket.Chat, corrected against the checkout. `apps/meteor/app`
now holds 89 files; the mass moved to `apps/meteor/client` (3116 files) and
`apps/meteor/server` (1372 files).

```json
{
  "modules": [
    "apps/meteor/server/*",
    "apps/meteor/server/services/*",
    "apps/meteor/client/*",
    "apps/meteor/app/*/*",
    "apps/meteor/ee/server/*",
    "packages/*/src",
    "packages/*/*/src"
  ]
}
```

The last pattern covers the nested workspaces, such as
`packages/apps/base-runtime`. Open question 11 still applies: validate this
set against the three fixture PRs.

### D2 — The boundary has a declared surface and a used surface

The declared surface is what the module exposes. The used surface is the
subset that other modules import. The gap is a finding: an export that
nobody uses widens the boundary for no benefit.

With an entry file, the declared surface is the export list of that file.
Without an entry file, the declared surface falls back to every export that
something outside the directory imports.

A module can hold no executable code. `packages/apps/src/converters` holds 13
files and zero call sites, and PR 42125 adds more such modules. A type-only
module is a first-class case: its boundary consists of types, its complexity
is 0, and its coverage is not applicable. A breaking change to an exported
type still breaks consumers, so the boundary still matters.

### D3 — A boundary provider list, not only exports

The boundary is a list of providers. Rocket.Chat exposes much of its surface
through registration, not through exports.

The prototype ships two providers:

- `exportProvider` — `export function x()`
- `apiRouteProbe` — `API.v1.addRoute('livechat/x')`

`ast-grep` 0.45.3 is the pattern layer. The pattern
`API.v1.addRoute($$$ARGS)` over apps/meteor returns 133 matches in 0.26s,
which equals the `grep` count. A provider is therefore a pattern in config,
not code. This is what makes the later providers cheap.

Later: Meteor methods, slash commands, callback hooks. The second provider
exists to prove the seam, not to cover the framework.

### D4 — The delta comes from two trees

The tool builds the full model for the base commit and for the head commit,
then subtracts. This gives true "added" numbers and it catches removals.
The cost is two analysis passes.

The CLI creates a git worktree for the base tree. The base worktree reuses
the `node_modules` of the head checkout through a symlink.

### D5 — Two tiers of analysis

Tier 1 runs over the whole repo, both trees, and it is syntactic. It reads
import statements and resolves paths by convention. It produces the module
graph and the importer index. It costs seconds.

Tier 2 runs over the touched modules only, and it is typed. It uses ts-morph
or the TypeScript compiler API. It produces the call graph, the complexity
counts and the effect hits. It costs tens of seconds.

Tier 1 is approximate. Tier 2 is the authority where the two overlap.

Tier 1 must follow re-export chains, because 17.5% of imports land on a
barrel file. The follow depth is 6. A general fixed-point algorithm is not
needed: 91% of the 369 barrels are one hop, and the deepest chain in the
repo is 4.

The research round narrowed where this matters. Of 37699 intra-repo edges,
2334 land on a barrel, but only 26 of 540 barrels re-export across a D1
module boundary. Only 58 edges, 0.2% of the total, would be attributed to
the wrong module. **The re-export follower serves fact 1, the used surface.
Facts 3 and 4 do not need it.** Build it for fact 1 and do not block the
dependency counts on it.

Measured cost, from `probe-findings.md`: tier 1 scans 9282 files in 2.6s, so
two trees cost about 5s. Tier 2 loads `packages/apps` in 1.7s and
`apps/meteor` in 12.3s, then spends 0.1s to 0.5s per module.

### D6 — Complexity is transitive inside the module

For each boundary symbol, the tool sums the complexity of the symbol and of
every internal function the symbol can reach. The walk stops at the module
edge. A thin facade over a complex body scores as the complex body.

```
export function handleUpload()  // own 3
  -> validate()                 // 8
  -> resize()                   // 14
  -> store()                    // 2
boundary complexity = 27
```

A shared helper counts once per boundary symbol that reaches it. The module
total is therefore not the sum of its boundary symbols. The report states
both numbers and labels them.

The walk cannot always continue. Measured followability inside a module is
74% to 92%. The walk stops early for four reasons:

1. the callee is a callback typed as an inline `FunctionType`;
2. the callee is an abstract method, so the implementation is in a subclass;
3. the callee is an interface method with no implementation in scope;
4. the callee is dynamic, such as `cache.get('user.convertById')(...)`.

The tool marks the boundary symbol in each case and it counts the stops. The
complexity number is then a floor, and the report says so. See D14.

McCabe definition, pinned: a function starts at 1. Add 1 for each `if`,
`for`, `for..in`, `for..of`, `while`, `do`, `case`, `catch`, ternary, `&&`,
`||` and `??`. Optional chaining does not count.

We write the counter. No library matches this definition. ESLint's
`complexity` rule also increments on an optional `MemberExpression`, an
optional `CallExpression` and an `AssignmentPattern`. Measured on
`apps/meteor/server`, ESLint reports 22418 against our 20176, a 11.1%
excess, which 1583 optional member accesses, 27 optional calls, 327 default
parameters, 283 destructuring defaults and 7 logical assignments explain
almost exactly. ESLint also reports the function head position, not a line
range, so it cannot feed D9. Our counter is about 50 lines and it runs in
658ms where ESLint takes 4250ms.

### D7 — Side effects come from a catalog and propagate

A config-extensible catalog names the effect sources. Effects propagate up
the call graph to the boundary symbol, over the same edges that D6 walks.

```yaml
db:      Models.*.{insert,update,remove}
network: fetch, axios, got
fs:      node:fs
process: process.env, process.exit
timer:   setTimeout, setInterval
emit:    api.broadcast, Meteor.call
```

`ast-grep` matches the catalog entries, the same engine as D3. Semgrep OSS
cannot do this job: its taint mode is intra-procedural, and the
inter-procedural engine is a paid feature.

Effect propagation walks the same edges as D6, so it stops at the same four
places. An unmarked "no effects" result is therefore also a floor.

Rejected: impurity inference, because it flags almost everything.

### D8 — Indirect dependencies are internal, with a hop count

An indirect dependency is a module that this module reaches through another
module inside the repo. The report keeps the hop count, so depth 1 and
depth 5 stay distinguishable.

This needs the path remap of D15. Without it, every internal dependency of
apps/meteor reports as external and the number is near zero.

Deferred: the transitive closure of external packages, read from the
lockfile. It answers a supply-chain question, not a coupling question. Add
it later as a second, separate number.

### D9 — Coverage attaches to the boundary symbol

The tool never runs the tests. It maps line hits onto the transitive
internal function set of the boundary symbol — the same set that D6 counts.

Input order, decided by what each format carries:

1. **istanbul `coverage-final.json`** — preferred. Its `fnMap` carries the
   function name, the `decl`, and a full `loc` with **start and end**
   line and column, plus `f` hit counts and a `branchMap` with per-branch
   locations. This maps onto a symbol directly.
2. **The Codecov public API** — see open question 6, now answered.
3. **`lcov.info`** — last resort. It carries `FN:<line>,<name>` with no end
   line, so a symbol range must be reconstructed from our own AST.

Rocket.Chat runs `nyc -r text -r lcov`, so it emits the weaker format today.
One added `-r json` would emit the preferred one.

Complexity and coverage then describe the same code, which a CRAP-style
score needs later.

The base report is optional. The tool reports a coverage delta only when it
has both reports. Coverage is optional everywhere; the report says
"unknown" when a report is absent.

### D10 — The report covers touched modules and their direct dependents

A dependent row carries the blast radius. It does not carry new complexity
numbers. Rejected: full transitive dependents, because a change to a core
package would list hundreds of modules.

This needs the path remap of D15 as well, in the reverse direction.

### D11 — The language adapter emits a neutral graph

The core owns modules, deltas, dependent search and scoring. The adapter
owns the language.

```ts
interface LanguageAdapter {
  matches(file: string): boolean;
  scanImports(tree: Tree): ImportEdge[];        // tier 1
  analyze(modules: ModuleRef[]): {
    symbols: SymbolNode[];
    exports: ExportEdge[];
    calls: CallEdge[];
    branchCounts: Map<SymbolId, number>;
    effectHits: EffectHit[];
  };                                            // tier 2
}
```

A new language implements one interface and it inherits every metric. This
keeps the numbers comparable between languages.

### D12 — The output is facts, not a score

JSON is the contract. The table is a view of the JSON. Each fact carries
the base value, the head value and the delta. A composite risk score comes
after we validate the facts against real PRs.

### D13 — Fixtures are synthetic and real

Synthetic repos with known-correct expected numbers drive the unit tests.
The three fixture PRs drive snapshot tests. The synthetic ones prove
correctness. The real ones prove that the tool survives apps/meteor.

**Cross-check every metric against a second implementation.** The research
agent wrote a complexity counter with an evaluation-order bug that discarded
nested counts. It reported 15474 against a true 20176 for
`apps/meteor/server`, a 23% undercount, and only a second implementation
caught it. A wrong number looks exactly like a right one.

`dependency-cruiser` is the oracle for the dependency graph. We do not ship
it. We compare our tier 1 output against it on the fixtures.

### D14 — Every module carries a confidence value

The probe round found one failure mode in four places: a number that is a
floor, not a total. D6 stops at a callback, an abstract method, an interface
method or a dynamic call. D7 stops at the same places. D15 fails where a
`dist` build is stale. A `.js` file under `checkJs: false` resolves badly.

A silent floor is worse than a missing number, because a reviewer reads it as
a total. Each module therefore carries a confidence value and the reasons
that lowered it. The report shows the reasons next to the numbers.

### D15 — Internal packages remap from `dist` to `src`

`node_modules/@rocket.chat/apps` is a symlink to `packages/apps`, and
apps/meteor sets `preserveSymlinks`. A call from apps/meteor into an internal
package therefore resolves to
`node_modules/@rocket.chat/apps/dist/server/ProxiedApp.d.ts` — a built
declaration file, with no body, inside the repo, that looks external.

`turbo --dry=json` supplies the map in 0.63s: 79 packages with `directory`,
`dependencies` and `dependents`, including the nested `ee/packages/*`. We do
not write a workspace crawler. Rocket.Chat already runs turbo.

Two mechanisms, one per tier:

- **Tier 1 never leaves the git-tracked source tree.** It resolves a bare
  specifier through the turbo map and it refuses to follow a symlink into
  `node_modules`. gitnexus proves this works: a query for `node_modules` or
  `/dist/` across its whole Rocket.Chat index returns zero rows, and it
  lands on `packages/apps/src/...` where the type checker lands on
  `dist/*.d.ts`.
- **Tier 2 remaps after the fact.** The type checker resolves where it
  resolves, so we rewrite a resolved path of the form
  `<pkg>/dist/**.d.ts` back to `<pkg>/src/**.ts`.

The problem is not specific to ts-morph. `dependency-cruiser` follows the
workspace symlink to the real package directory, which is better, and then
still lands in `dist`: 68 of 68 distinct `@rocket.chat/*` specifiers in
`apps/meteor/server` resolve into `<pkg>/dist/`, none into `src/`.

D8 and D10 depend on this. It is a prerequisite, not a refinement. Open
question 12 covers what to do when the `dist` build is stale.

### D16 — Adopt four tools, build the engine

`research/tool-landscape.md` holds the survey. The result is that no tool
supplies our facts, and four tools remove work at the edges.

Adopted:

| tool | job | measured |
|---|---|---|
| `turbo --dry=json` | the workspace map of D15 | 0.63s, 79 packages |
| `ast-grep` 0.45.3 | boundary providers (D3), effect catalog (D7) | 133 matches, 0.26s |
| Codecov public API v2 | coverage when no local report exists (D9) | 2.60 MB, no token |
| istanbul `coverage-final.json` | the preferred coverage format (D9) | carries start and end |

Oracle, not a dependency: `dependency-cruiser` 18.3.1, for the D13
cross-check.

We build: tier 1, the call graph, the cyclomatic counter, the module model.

Rejected, with the reason in one line each:

- **SCIP / `scip-typescript`** — carries no call edges, and only 1120 of
  20233 occurrences (5.5%) carry an `enclosing_range`, so caller-to-callee
  cannot be rebuilt. `apps/meteor` costs 65.1s and 4.1 GB against 12.3s for
  a ts-morph load.
- **gitnexus** — PolyForm-Noncommercial license; its `IMPORTS` edge is
  file-to-file and resolves bare specifiers by basename, so about 58% of
  cross-package edges are wrong. See `research/gitnexus.md`.
- **CodeQL** — the CLI license forbids use with a codebase that is not open
  source, and forbids database generation in CI or CD, without a paid
  Advanced Security license.
- **Semgrep OSS** — taint mode is intra-procedural only.
- **stack-graphs** — GitHub archived it on 2025-09-09.
- **`dependency-cruiser` as the engine** — 45.56s and 3.89 GB for the whole
  repo, against 2.6s for our tier 1.
- **`typhonjs-escomplex`** — cannot parse TypeScript; fails on `import type`.
- **`skott`** — cannot be installed; it depends on an unpublished version.
- **ESLint `complexity`, SonarJS** — wrong definition, and no line range.
- **LSIF, Glean, Joern, madge, ts-prune, knip** — see the rejection list in
  the research file.

## Pipeline

```
base ref, head ref
   |
   v
[worktree setup]  base worktree + symlinked node_modules
   |
   v
[workspace map]  turbo --dry=json: 79 pkgs, name -> dir       (D15)  0.6s
   |
   v
[tier 1]  syntactic scan, whole repo, both trees        ~2.6s/tree
   |        -> module graph, importer index, direct deps
   |        -> follows re-export chains, depth 6
   v
[module detection]  config patterns -> module set, both trees
   |
   v
[change set]  git diff -> touched modules + direct dependents
   |
   v
[tier 2]  typed analysis, touched modules only, both trees
   |        -> boundary symbols, call graph, complexity, effects
   |        -> marks every stop in the walk               (D14)
   v
[coverage]  coverage-final.json | Codecov | lcov            (D9)
   |            -> per boundary symbol
   |
   v
[delta]  head model - base model
   |
   v
[report]  JSON + table
```

## Open questions

These are the things we do not know yet. Each one can change the design.

1. ~~**Call resolution rate.**~~ ANSWERED by the probe round. Followability
   inside a module is 74% to 92%, and unresolved calls are 0% to 3%. D6 and
   D7 stand. The residual risk moved into D14. Caveat: the two resolution
   strategies disagree on 1.2% to 16.3% of calls, so we keep both.

2. ~~**Barrel files.**~~ ANSWERED by the probe round. 17.5% of imports land
   on a barrel, 91% of barrels are one hop, and the deepest chain is 4. A
   follow depth of 6 closes it. Unresolved relative imports are 0.5%.

3. **Module identity across the two trees.** A renamed directory looks like
   one module removed and one module added. The delta then becomes noise. We
   need a rename heuristic, probably from git rename detection. We do not
   know how well it maps to module granularity.

4. **tsconfig selection.** PARTLY ANSWERED. The typed pass works in the
   worktree with `node_modules` present and no extra build step:
   `apps/meteor/tsconfig.json` loads 5853 files in 12.3s. Still open: which
   tsconfig to load for a given file, because the repo holds one per
   package. A change that spans apps/meteor and packages/apps needs two
   programs, and the two disagree about the same symbol — see D15.

5. **Effect catalog coverage.** We do not know how much Rocket.Chat I/O goes
   through recognizable names. Wrappers hide the source. Measure the hit
   rate before we trust the effect numbers.

6. ~~**Coverage data availability.**~~ ANSWERED. The Codecov public API v2
   needs no token for Rocket.Chat. `/report/?sha=cfe9a3bfc4` returns HTTP
   200 and 2.60 MB, with per-file `line_coverage` as `[line, state]`, state
   0=hit, 1=miss, 2=partial. The three counts match `hits`, `misses` and
   `partials` exactly. The coverage is line-level only, so D9 must map lines
   onto our own symbol ranges. See open question 15 for what it does not
   cover.

7. **Test files inside a module.** A test file adds dependencies and
   effects. Proposal to confirm: exclude test files from the metrics of the
   module, and use them only for the test-to-source map.

8. ~~**Type-only imports.**~~ DECIDED: a type-only import is a direct
   dependency, and the report marks it as type-only. The separation is not
   cosmetic. Measured on `packages/apps/src`, a dependency scan reports 222
   modules and 351 edges when it ignores type-only imports, and 653 modules
   and 1603 edges when it includes them, of which 341 edges are type-only. A
   4.6× difference in the edge count decides whether a reviewer sees a real
   coupling change or noise.

9. **Delta noise.** A format-only change moves line numbers and it may move
   the numbers. We do not know how stable the metrics are against a pure
   reformat. Test this with a synthetic fixture.

10. **Tier disagreement.** Tier 1 and tier 2 may disagree about the same
    import. D5 says tier 2 wins. We do not know how often they disagree; a
    high rate means tier 1 is too weak to carry the importer index.

11. **Config patterns for apps/meteor.** The patterns in D1 are corrected
    against the checkout, but they are still untested against a change.
    Validate them against the three fixture PRs before we build on them.

12. **Stale `dist`.** D15 reads the built declarations of a sibling package.
    We do not know what to do when the build is stale: require a build
    before a run, detect staleness, or override the path so that `src` wins.
    The override is cheapest, and it breaks where the built API differs from
    the source.

13. **JavaScript files.** apps/meteor sets `checkJs: false`, so calls in
    `.js` files resolve badly. `server/startup/rateLimiter.js` produced most
    of the unresolved calls in its module. Do we enable `checkJs` for our
    own program, accept the gap, or let it lower the D14 confidence?

14. **Confidence, expressed how.** D14 says every module carries a
    confidence value. We have not decided whether that is a number, a set of
    reason tags, or both, and we do not know how a reviewer should act on a
    low value. gitnexus records a `reason` on every edge, which is the
    cheapest version of this idea and worth copying.

15. **Coverage does not cover the packages.** Codecov reports 4323 of 9282
    files, and 3705 of those sit under `apps/meteor`. **Zero files under
    `packages/apps` are covered.** Two of our three fixture PRs change
    `packages/apps` most. So fact 6 will read "unknown" for the modules
    that change most often. We must decide what the report does then, and
    whether an unknown coverage should lower the D14 confidence or suppress
    a risk score entirely.

16. **Which tsconfig, restated.** Open question 4 asked which tsconfig to
    load. The research narrowed it: `scip-typescript` needed 65.1s and
    4.1 GB on apps/meteor where ts-morph needs 12.3s, so the cost is in the
    program, not in the tool. A change that spans apps/meteor and
    packages/apps needs two programs that disagree about the same symbol.
    We still do not know whether to load two programs and reconcile, or to
    build one synthetic tsconfig for the touched set.
