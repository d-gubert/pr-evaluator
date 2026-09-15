# Probe findings — 2026-09-15

Two probes ran against
`/home/douglas-gubert/dev/RocketChat/worktrees/accessor-consolidation`
(branch `develop`, `cfe9a3bfc4`). The probes answer open question 1 and open
question 2 of `design.md`. They also produced four findings we did not
predict.

Run them again with:

```
./node_modules/.bin/tsx probes/call-resolution.ts --repo <repo> --tsconfig <path> --module <dir>...
./node_modules/.bin/tsx probes/barrel-depth.ts --repo <repo>
```

## Open question 1 — call resolution: PASS, with two caveats

The probe counts every call site in a module. It resolves the callee by two
strategies and classifies the target.

| module | files | calls | body in module | followability |
|---|---|---|---|---|
| packages/apps/src/server/runtime/base | 5 | 239 | 69 | **90.8%** |
| packages/apps/src/server/managers | 18 | 721 | 145 | **78.8%** |
| apps/meteor/app/apps/server/bridges | 32 | 1069 | 47 | **92.2%** |
| apps/meteor/app/apps/server/converters | 26 | 271 | 56 | **83.6%** |
| apps/meteor/server/startup | 61 | 461 | 28 | **73.7%** |

Followability = calls we can follow to an implementation inside the module,
over the calls we need to follow. Calls into the Node standard library, the
TypeScript lib and npm packages are excluded, because D6 stops at the module
edge anyway. Those calls are 42% to 88% of all call sites.

`unresolved` is 0% to 3%. TypeScript resolves almost every callee. The gap
is not a resolution failure. The gap has three causes, in order of size:

1. **A callback typed as an inline `FunctionType`.** Example:
   `apps/meteor/app/apps/server/converters/codecs/mappedData.ts:126`, the
   call `from(clone)`. The declaration is a type, so it has no body. This is
   the higher-order case we predicted. The `param` bucket reported 0%
   because these resolve to a `FunctionType` node, not to a parameter.
2. **An abstract or interface method.** Example:
   `BaseRuntimeSubprocessController.ts:145`, the call
   `this.buildProcessConfiguration()`. The implementation sits in a
   subclass, and the subclass is often in another module.
3. **A string-keyed registry.** Example:
   `apps/meteor/app/apps/server/converters/messages.ts:124`, the call
   `cache.get('user.convertById')(...)`. Nothing static can follow this.

Caveat A: the two resolution strategies disagree on 1.2% to 16.3% of calls.
The merge rule (prefer whichever strategy finds a body) handles it, and we
must keep both strategies.

Caveat B: `.js` files resolve badly. `apps/meteor/server/startup/rateLimiter.js`
produced most of the `unresolved` calls in its module, because
`checkJs` is false. apps/meteor still holds JavaScript.

**Verdict: D6 and D7 stand.** The prototype must mark a boundary symbol
when its transitive walk hits one of the three causes above, so a reviewer
knows the complexity number is a floor, not a total.

## Open question 2 — barrel files: PASS

The tier 1 scan covers 9282 files.

```
walk                35ms
parse             2025ms   (0.22ms/file)
resolve            548ms
TIER 1 TOTAL         2.6s
```

| measure | value |
|---|---|
| import statements | 40558 |
| type-only imports | 9825 (24.2%) |
| imports that land on a barrel | 7085 (**17.5%**) |
| unresolved imports | 11739 (28.9%) |
| of those, bare/external | 11544 |
| **unresolved relative imports** | **195 (0.5%)** |
| re-export statements | 1934 |
| `export *` | 1090 (56.4%) |
| barrel files | 369 |

Chain depth histogram: `1:337  2:21  3:7  4:3`. The deepest chain is 4
(`packages/core-typings/src/index.ts`). 91% of barrels are one hop.

**Verdict: D5 stands.** Tier 1 costs 2.6 seconds per tree, so two trees cost
about 5 seconds. A convention-based resolver misses 0.5% of relative
imports. The re-export follower needs a depth limit of about 6, not a
general fixed-point algorithm.

## New finding 1 — internal packages resolve to their built `dist`

This is the finding with the most consequences.

`node_modules/@rocket.chat/apps` is a symlink to `packages/apps`. apps/meteor
sets `preserveSymlinks`. So a call from apps/meteor into an internal package
resolves to `node_modules/@rocket.chat/apps/dist/server/ProxiedApp.d.ts` —
a built declaration file with no body, inside the repo, that looks external.

Consequences:

- D8 (internal indirect dependencies) needs a map from
  `node_modules/@rocket.chat/<name>` and from `<pkg>/dist/**.d.ts` back to
  `<pkg>/src/**.ts`. Without the map, every internal dependency of
  apps/meteor reports as external.
- D10 (direct dependents) has the same problem in reverse.
- The typed pass reads a **built** view of a sibling package. If the PR
  changes `packages/x/src` and `dist` is stale, tier 2 analyzes stale code.
  The barrel probe found 78 workspace packages; `packages/apps`,
  `packages/models` and `packages/core-typings` all have a `dist`.

## New finding 2 — the D1 patterns are wrong for this repo

`apps/meteor/app` now holds 89 files in 13 directories. The code moved.

| directory | files |
|---|---|
| apps/meteor/client | 3116 |
| apps/meteor/server | 1372 |
| apps/meteor/tests | 685 |
| apps/meteor/ee | 307 |
| apps/meteor/app | 89 |

`apps/meteor/server` holds 264 directories and 82 `index.ts` files.
`packages/apps` and `packages/apps-engine` hold 466 and 548 files.

Proposed replacement patterns, to validate against the three PRs:

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
`packages/apps/base-runtime`.

## New finding 3 — a module can hold no executable code

`packages/apps/src/converters` holds 13 files and **0 call sites**. It is
interfaces only. PR 42125 adds several such modules
(`packages/apps-engine/src/definition/callHistory`).

The report must treat a type-only module as a first-class case: complexity
0, coverage not applicable, and a boundary that consists of types. A type
export is still a boundary, and a breaking change to it still breaks
consumers.

## New finding 4 — tier 2 cost is acceptable

| tsconfig | source files | load time |
|---|---|---|
| packages/apps/tsconfig.json | 777 | 1.7s |
| apps/meteor/tsconfig.json | 5853 | 12.3s |

Per-module analysis after the load is 0.1s to 0.5s. apps/meteor needed no
heap flag in practice. Two trees and two tsconfig loads cost under 30
seconds, which fits a local loop.

The typed pass ran against a worktree with `node_modules` present and no
extra build step. Open question 4 is therefore partly answered: the typed
pass works. Whether it is *current* depends on new finding 1.

## What changes in design.md

- D6, D7: keep. Add a rule — mark a boundary symbol when the walk hits a
  `FunctionType`, an abstract method, an interface method or a dynamic
  callee. Report the marked count next to the complexity number.
- D5: keep. Set the re-export follow depth to 6.
- D8, D10: add the `node_modules/@rocket.chat/*` and `dist/*.d.ts` to `src`
  remap. It is a prerequisite, not a refinement.
- D1: replace the example patterns with the set above.
- D2: add the type-only module case.

## New open questions

12. **Stale `dist`.** Tier 2 reads the built declarations of sibling
    packages. Do we require a build before a run, detect staleness, or
    prefer `src` over `dist` through a path override? A path override is the
    cheapest, and it may break where the built API differs from source.
13. **JavaScript files in apps/meteor.** `checkJs` is false, so calls in
    `.js` files resolve badly. Do we enable `checkJs` for our own program,
    accept the gap, or report a per-module confidence value?
14. **Confidence, not just numbers.** Findings 1, and causes 1 to 3 of open
    question 1, all produce the same risk: a number that is a floor. The
    report probably needs a confidence field per module. This is a new
    design decision, not a detail.
