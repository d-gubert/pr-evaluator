# gitnexus — evaluation for the PR evaluator

Date: 2026-09-15. All output below comes from real calls against real
indexes. Test indexes that this evaluation created are removed again.

## Verdict

gitnexus supplies useful data for two of our six facts and it cannot supply
the other four. It gives us a real transitive call graph across package
boundaries (fact 2 and fact 5 walk), and it gives us a statement-level
control-flow graph behind `analyze --pdg` (fact 2 counts). It cannot supply
fact 3 and fact 4, because its cross-package import graph resolves bare
specifiers by file basename and produces about 58% wrong edges; and it holds
no coverage data at all (fact 6).

The blocker for D4 is separate and hard. gitnexus answers every query from a
pre-built index of one checked-out working tree. One changed file forces a
full re-index, measured at 17.2s for 1559 files. To model our base tree we
must run a full `gitnexus analyze` on the base worktree, which costs about
60 to 70 seconds and 800 MB of disk for Rocket.Chat.

## What gitnexus is

| item | value |
|---|---|
| package | `gitnexus` 1.6.9, npm, installed through volta |
| binary | `/home/douglas-gubert/.volta/bin/gitnexus` |
| source | https://github.com/abhigyanpatwari/GitNexus |
| license | **PolyForm-Noncommercial-1.0.0** |
| language | TypeScript, runs on Node |
| parser | tree-sitter (native bindings; `postinstall` builds the grammars) |
| graph store | LadybugDB (`@ladybugdb/core` 0.18), a Kuzu-compatible embedded graph DB |
| query language | Cypher |
| index location | `<repo>/.gitnexus/`, registry at `~/.gitnexus/registry.json` |
| daemon | no daemon. The MCP server runs as a stdio child process. |
| author claim | "does not compute cyclomatic complexity or traditional code metrics" |

The parser is tree-sitter, not the TypeScript compiler. gitnexus therefore
never reads a `tsconfig.json`, never needs `node_modules`, and never resolves
a type. Every relation it records is a syntactic or name-based heuristic.
This one fact explains both its strengths and its failures below.

The license matters. PolyForm-Noncommercial forbids commercial use. We
cannot ship a product that depends on gitnexus without a separate license.

## Index state

`list_repos` returned 5 indexes, all of Rocket.Chat.

| path | indexed | commits behind |
|---|---|---|
| `~/.herdr/worktrees/main/worktree-clear-meadow-acaa` | 2026-08-31 | 106 |
| `dev/RocketChat/worktrees/devcontainers` | 2026-09-02 | 82 |
| `dev/RocketChat/worktrees/main` | 2026-07-28 | 141 |
| `dev/RocketChat/worktrees/review` | 2026-07-23 | 328 |
| `dev/RocketChat/worktrees/zod-converters` | 2026-08-24 | 145 |

**Our reference checkout `worktrees/accessor-consolidation` is not indexed.**
Every index is stale. The freshest is 82 commits behind.

This report queries `worktrees/devcontainers` (9797 files, 60128 nodes,
153046 edges), because it is the freshest full Rocket.Chat index.

## The graph schema, verbatim

`CALL show_tables()` against the devcontainers index:

```
| id  | name          | type |
| 0   | File          | NODE |
| 1   | Folder        | NODE |
| 2   | Function      | NODE |
| 3   | Class         | NODE |
| 4   | Interface     | NODE |
| 5   | Method        | NODE |
| 6   | CodeElement   | NODE |
| 7   | Community     | NODE |
| 8   | Process       | NODE |
| 9   | Struct        | NODE |
| 10  | Enum          | NODE |
| 11  | Macro         | NODE |
| 12  | Typedef       | NODE |
| 13  | Union         | NODE |
| 14  | Namespace     | NODE |
| 15  | Trait         | NODE |
| 16  | Impl          | NODE |
| 17  | TypeAlias     | NODE |
| 18  | Const         | NODE |
| 19  | Static        | NODE |
| 20  | Variable      | NODE |
| 21  | Property      | NODE |
| 22  | Record        | NODE |
| 23  | Delegate      | NODE |
| 24  | Annotation    | NODE |
| 25  | Constructor   | NODE |
| 26  | Template      | NODE |
| 27  | Module        | NODE |
| 28  | Section       | NODE |
| 29  | Route         | NODE |
| 30  | Tool          | NODE |
| 31  | BasicBlock    | NODE |
| 237 | CodeEmbedding | NODE |
| 236 | CodeRelation  | REL  |
```

Every edge lives in one relation table, `CodeRelation`:

```
| property | type   |
| type     | STRING |
| confidence | DOUBLE |
| reason   | STRING |
| step     | INT32  |
```

`Function`, `Method`, `Class`, `Interface`, `Const` share one property set:

```
| id          | STRING | primary key |
| name        | STRING |
| filePath    | STRING |   repo-relative, POSIX separators
| startLine   | INT64  |
| endLine     | INT64  |
| isExported  | BOOL   |
| content     | STRING |   the full source text of the symbol
| description | STRING |
```

`Class` adds `parameterCount INT32` and `returnType STRING`. `File` carries
only `id, name, filePath, content`.

**There is no complexity property, no branch count and no coverage property
anywhere in the schema.**

`BasicBlock`, written only by `analyze --pdg`:

```
| id        | STRING | primary key |
| filePath  | STRING |
| startLine | INT64  |
| endLine   | INT64  |
| text      | STRING |
| callees   | STRING |
| calleeIds | STRING |
```

The `BasicBlock.id` encodes the owning function's start line, for example
`BasicBlock:apps/src/server/managers/AppListenerManager.ts:337:1:2`. There is
no `Function -> BasicBlock` edge, so a join on `filePath` plus line range is
the only way to scope blocks to a symbol.

### Node counts (devcontainers, 9797 files)

```
| Const     | 13611 |
| Function  | 13572 |
| Method    | 12962 |
| File      |  9797 |
| Property  |  3029 |
| Folder    |  1825 |
| Community |  1614 |
| Interface |  1222 |
| Class     |  1145 |
| Section   |   684 |
| Process   |   300 |
| Variable  |   208 |
| Route     |   159 |
```

`TypeAlias`, `Enum` and `Namespace` have tables but zero rows. A TypeScript
`type X = ...` and an `enum` are therefore invisible. D2's type-only module
survives only as `Interface` nodes.

### Edge counts (default index, no `--pdg`)

```
| CALLS            | 31606 |
| DEFINES          | 30202 |
| ACCESSES         | 25724 |
| IMPORTS          | 24464 |
| CONTAINS         | 12283 |
| HAS_METHOD       | 12248 |
| MEMBER_OF        |  8577 |
| HAS_PROPERTY     |  2974 |
| METHOD_IMPLEMENTS|  1730 |
| STEP_IN_PROCESS  |  1272 |
| METHOD_OVERRIDES |  1058 |
| EXTENDS          |   491 |
| IMPLEMENTS       |   255 |
| HANDLES_ROUTE    |   159 |
| ENTRY_POINT_OF   |     3 |
```

### Edge counts with `--pdg` (my 1559-file slice)

```
| CFG           | 9990 |
| REACHING_DEF  | 5363 |
| CALLS         | 2814 |
| CDG           | 2720 |
| IMPORTS       | 2298 |
| CALL_SUMMARY  |  541 |
```

`--pdg` adds `CFG`, `CDG`, `REACHING_DEF` and `CALL_SUMMARY`. The tool
description also names `TAINTED`, `SANITIZES`, `TAINT_PATH` and
`POST_DOMINATE`, which my slice did not produce.

### How a CALLS edge got made

```cypher
MATCH (a)-[r:CodeRelation {type:'CALLS'}]->(b)
RETURN r.reason, r.confidence, count(*) ORDER BY count(*) DESC
```

```
| import-resolved         | 0.85 | 21359 |
| local-call              | 0.85 |  4858 |
| global                  | 0.85 |  4408 |
| scope-resolution: call  | 0.63 |   592 |
| interface-dispatch      | 0.85 |   189 |
| scope-resolution: call  | 0.61 |    72 |
| ... (scope-resolution, confidence 0.49 to 0.65) |
```

`global` means "a symbol somewhere in the repo has this name". Confidence is
a flat 0.85 for everything except `scope-resolution`, so it does not separate
a safe edge from a guess.

## The six facts

| # | fact | verdict | query |
|---|---|---|---|
| 1 | Module boundary — declared | **partly** | `MATCH (n) WHERE n.filePath STARTS WITH '<dir>' AND n.isExported = true` |
| 1 | Module boundary — used | **partly** | `MATCH (a)-[:CodeRelation {type:'CALLS'}]->(b) WHERE b.filePath STARTS WITH '<dir>' AND NOT a.filePath STARTS WITH '<dir>'` |
| 2 | Cyclomatic complexity | **partly**, needs `--pdg` | `MATCH (a:BasicBlock)-[r:CodeRelation {type:'CFG'}]->(b) ... RETURN r.reason, count(*)` |
| 3 | Direct dependencies added | **cannot** | `MATCH (a:File)-[:CodeRelation {type:'IMPORTS'}]->(b:File)` — 58% wrong across packages |
| 4 | Indirect dependencies added | **cannot** | same edge, same defect, amplified by transitivity |
| 5 | Side effects triggered | **partly** — the walk yes, the catalog no | variable-length `CALLS` walk, below |
| 6 | Test coverage | **cannot** | no coverage property in `show_tables` / `table_info` |

### Fact 2 walk and fact 5 walk — the transitive call set

This is what gitnexus does best. Kuzu recursive syntax, filtered to `CALLS`:

```cypher
MATCH p = (a:Method)-[r:CodeRelation*1..5 (rel, n | WHERE rel.type = 'CALLS')]->(b)
WHERE a.id = 'Method:apps/meteor/app/apps/server/bridges/listeners.ts:AppListenerBridge.handleEvent#1'
RETURN DISTINCT b.name, b.filePath, length(p) AS hops ORDER BY hops
```

```
| messageEvent        | apps/meteor/app/apps/server/bridges/listeners.ts          | 1 |
| livechatEvent       | apps/meteor/app/apps/server/bridges/listeners.ts          | 1 |
| userEvent           | apps/meteor/app/apps/server/bridges/listeners.ts          | 1 |
| roomEvent           | apps/meteor/app/apps/server/bridges/listeners.ts          | 1 |
| uploadEvent         | apps/meteor/app/apps/server/bridges/listeners.ts          | 1 |
| defaultEvent        | apps/meteor/app/apps/server/bridges/listeners.ts          | 1 |
| executeListener     | packages/apps/src/server/managers/AppListenerManager.ts   | 2 |
| getConverters       | packages/apps/src/IAppServerOrchestrator.ts               | 2 |
| getTempFilePath     | packages/apps/src/server/AppManager.ts                    | 2 |
| isLivechatRoom      | packages/apps-engine/src/definition/livechat/ILivechatRoom.ts | 2 |
| executePreMessageSentExtend | packages/apps/src/server/managers/AppListenerManager.ts | 3 |
| ... 40 more at hop 3
```

The hop count comes free, so D8's depth number is available. Adding
`AND b.filePath STARTS WITH '<dir>'` stops the walk at the module edge, which
is exactly D6's rule.

Density check against our own probe. Our ts-morph probe measured 47 calls
with a body inside `apps/meteor/app/apps/server/bridges`. gitnexus:

```cypher
MATCH (a)-[:CodeRelation {type:'CALLS'}]->(b)
WHERE a.filePath STARTS WITH 'apps/meteor/app/apps/server/bridges'
  AND b.filePath STARTS WITH 'apps/meteor/app/apps/server/bridges'
RETURN count(*)    --> 49
```

49 against our 47. The intra-module call graph agrees with the typed pass.
Calls that leave the module: gitnexus records 566, our probe counted 1069
call sites in total. gitnexus drops the calls it cannot name.

`trace` is a shortest-path tool over `CALLS` plus `HAS_METHOD`:

```
trace(from: handleEvent, to: executeListener)
-> handleEvent  listeners.ts:188
-> userEvent    listeners.ts:523
-> executeListener  packages/apps/src/server/managers/AppListenerManager.ts:343
   edges: CALLS 0.85, CALLS 0.85
```

Caution: 426 `CALLS` edges are self-loops (`a.id = b.id`), which are index
artifacts. A walk must exclude them or it will not terminate cleanly.

### Fact 2 counts — the CFG

`pdg_query` on a default index returns:

```json
{"mode":"controls","results":[],"total":0,
 "note":"no PDG layer — run gitnexus analyze --pdg to record CDG edges for this repo"}
```

No indexed Rocket.Chat repo has the PDG layer. I built one on a 1559-file
slice. The CFG is real and it carries a branch reason:

```cypher
MATCH (a:BasicBlock)-[r:CodeRelation {type:'CFG'}]->(b:BasicBlock)
WHERE a.filePath ENDS WITH 'managers/AppListenerManager.ts'
  AND a.startLine >= 327 AND a.endLine <= 335        -- getListeners()
RETURN a.startLine, b.startLine, r.reason, a.text
```

```
| 327 | 328 | seq        |                                              |
| 328 | 330 | seq        | const results: Array<ProxiedApp> = [];        |
| 330 | 331 | cond-true  | for(appId … this.listeners.get(int))          |
| 330 | 332 | cond-false | for(appId … this.listeners.get(int))          |
| 331 | 330 | loop-back  | results.push(this.manager.getOneById(appId)); |
| 332 | 334 | seq        |                                              |
| 334 | 335 | return     | return results;                              |
```

`getListeners` has one `for`, so D6 gives 2. One `cond-true` plus 1 gives 2.
The counts match.

A second check on a large method. `executeListener` (lines 343 to 471) holds
49 `case` labels and 1 `if`, counted by grep. The CFG:

```
| switch-case | 50 |   (49 cases + default)
| return      | 49 |
| seq         | 11 |
| cond-true   |  1 |
| throw       |  1 |
| fallthrough |  1 |
```

1 + 49 + 1 = 51, which is the D6 number.

Repo-wide the reasons are `seq, return, cond-true, throw, cond-false,
loop-back, switch-case, break, continue, fallthrough`.

**The limit: the CFG is statement-level.** I added this probe file and
re-indexed:

```ts
export function probeCx(a: number, b: number, c: number): number {
	const x = a > 1 && b > 2 ? 10 : 20;
	const y = a ?? b ?? c;
	const z = (a > 0 || b > 0) ? 1 : 2;
	return x + y + z;
}
```

```
| 1 | 2 | seq    |                                                       |
| 2 | 5 | seq    | const x = … && … ? … : …; const y = a ?? b ?? c; const z = … |
| 5 | 6 | return | return x + y + z;                                     |
```

Three ternaries, one `&&`, one `||` and two `??` collapse into one basic
block. D6 scores this function 8. gitnexus's CFG scores it 1.

How much this costs depends on the code style:

| directory | statement branches | expression branches |
|---|---|---|
| `packages/apps/src/server/managers` | 317 | 31 |
| `apps/meteor/client/views/omnichannel` | 380 | 1188 |

In server code the CFG captures about 91% of D6's decisions. In the React
client it captures about 24%. `apps/meteor/client` holds 3116 files, so the
undercount would dominate our largest module area.

### Fact 1 — the boundary

Declared surface: `isExported` is on `Function`, `Method`, `Class`,
`Interface` and `Const`, so an exported-symbol list per directory is one
query. Limits: no `TypeAlias` or `Enum` rows, and `isExported` does not tell
us whether the symbol reaches a consumer through a barrel re-export.

Used surface: `IMPORTS` cannot answer it, because every `IMPORTS` edge is
`File -> File`:

```cypher
MATCH (a)-[r:CodeRelation {type:'IMPORTS'}]->(b)
RETURN label(a), label(b), r.reason, count(*)
```

```
| File | File | typescript-scope: import | 24302 |
| File | File | javascript-scope: import |   120 |
| File | File | markdown-link            |    42 |
```

There is no imported-symbol list. "Who imports symbol X" is not answerable
from `IMPORTS`. `CALLS` gives a usable approximation of the used surface:

```cypher
MATCH (a)-[:CodeRelation {type:'CALLS'}]->(b)
WHERE b.filePath STARTS WITH 'packages/apps/src/server/managers'
  AND NOT a.filePath STARTS WITH 'packages/apps/src/server/managers'
RETURN b.name, b.isExported, count(DISTINCT a.id) AS externalCallers
```

```
| hasPermission        | true | 35 |
| notifyAboutError     | true | 34 |
| executeListener      | true |  6 |
| stopRuntime          | true |  4 |
| updateAppSetting     | true |  4 |
| addProvider          | true |  4 |
| AppApiManager        | true |  4 |
| ...
```

Every hit is `isExported = true`, which is a good sign. A symbol that is
imported but never called — a type, a constant passed as a value, a class
used only as a type annotation — never appears.

D3's `apiRouteProbe` is not served. `route_map` returned 159 routes, but it
does not know Rocket.Chat's `API.v1.addRoute`, which has 133 call sites.
Instead it labels client fetch calls as handlers:

```json
{"route":"/v1/video-conference.start","method":"POST",
 "handler":"apps/meteor/client/lib/VideoConfManager.ts","consumers":[]}
```

`VideoConfManager.ts:150` is `sdk.rest.post('/v1/video-conference.start', …)`
— a caller, not a handler. `api_impact` on that route reports 0 consumers and
`riskLevel: LOW`, which is meaningless.

### Fact 3 and fact 4 — dependencies. The correctness failure.

Relative imports resolve well. `apps/meteor` holds 13317 relative import
statements and gitnexus records 15082 intra-`apps/meteor` `IMPORTS` edges.

Cross-package imports do not. `apps/meteor` holds 8653 `@rocket.chat/*`
import statements. gitnexus records 748 `apps/meteor -> packages/` edges,
which is 8.6% coverage. The edges it does record are mostly wrong:

```cypher
MATCH (a:File)-[:CodeRelation {type:'IMPORTS'}]->(b:File)
WHERE a.filePath STARTS WITH 'apps/meteor/' AND b.filePath STARTS WITH 'packages/'
RETURN b.filePath, count(*) ORDER BY count(*) DESC LIMIT 6
```

```
| packages/i18n/src/scripts/check.mts            | 140 |
| packages/core-typings/src/Apps.ts              |  91 |
| packages/media-signaling/src/definition/logger.ts | 88 |
| packages/livechat/src/lib/random.ts            |  79 |
| packages/livechat/src/i18next.ts               |  36 |
| packages/fuselage-ui-kit/src/stories/payloads/actions.ts | 36 |
```

Two verified cases:

- `apps/meteor/server/ufs/ufs.ts:1` reads
  `import { Random } from '@rocket.chat/random';`. A `packages/random`
  directory exists. gitnexus resolved it to `packages/livechat/src/lib/random.ts`.
- `apps/meteor/server/ufs/ufs-store.ts:8` reads
  `import { check } from 'meteor/check';`. That is an external Meteor core
  package. gitnexus resolved it to `packages/i18n/src/scripts/check.mts`.

The resolver matches the last path segment of the specifier against file
basenames anywhere in the repo. The four clearest false targets alone hold
343 of the 748 edges. With `core-typings/src/Apps.ts` (from
`@rocket.chat/apps`) the count reaches 434, which is 58%.

Fact 3 needs a correct direct-dependency set. Fact 4 multiplies that error
over hops. Both are unusable on this edge.

D10's direct-dependent search has the same defect in the reverse direction.

### Fact 6 — coverage

gitnexus stores no coverage data and ingests no lcov. No node table and no
edge type carries a hit count. This fact is entirely ours.

## Freshness, cost and the D4 blocker

I measured a cold index on copies placed in a scratch directory, so nothing
in the Rocket.Chat worktrees changed.

| slice | files | wall | peak RSS | nodes | edges |
|---|---|---|---|---|---|
| `packages/apps` + `packages/apps-engine` | 1559 | 11.8s | 1.50 GB | 5367 | 15244 |
| + 4 packages + `apps/meteor/{server,app}` | 3448 | 22.2s | 1.84 GB | 19961 | 51046 |
| same 1559 files with `--pdg` | 1559 | 12.8s | 1.55 GB | 17113 | 33858 |

The rate is about 6.5 ms per file and it is close to linear. Rocket.Chat's
9282 files therefore cost roughly 60 to 70 seconds. The `--pdg` layer adds
about 8%. Each Rocket.Chat index occupies 805 MB on disk
(`worktrees/devcontainers/.gitnexus`).

**Re-index is all-or-nothing.** `meta.json` holds a `fileHashes` map, but it
only decides whether to re-index, not what to re-index:

```
=== re-index, no changes ===
  Already up to date
WALL=0.58 s
=== append one line to one file, re-index ===
  Repository indexed successfully (17.2s)
  5,367 nodes | 15,244 edges | 219 clusters | 300 flows
WALL=17.80 s
```

One changed file cost a full rebuild, and it ran slower than the cold build
because it also pruned the parse cache. The project's own README lists
"Incremental Indexing — only re-index changed files" as still in progress.

Two facts help us:

- `analyze` needs no `node_modules` and no `tsconfig.json`. My scratch slices
  had neither and indexed fine. A fresh base worktree therefore works without
  an install step.
- No daemon runs. The MCP server is a stdio child process
  (`node .../gitnexus/bin/gitnexus mcp`).

**The D4 answer.** Every query tool reads a registered `.gitnexus` index of a
checked-out working tree. Nothing accepts a git ref and reads that tree. To
get the base side of our delta we must:

1. create the base worktree;
2. run `gitnexus analyze` on it, 60 to 70 seconds, 800 MB;
3. register it under a distinct `--name`, because the path basenames collide;
4. run the same queries against both names;
5. remove the base index afterwards.

That is about 2 to 2.5 minutes of indexing per run, against 5 seconds for our
own tier 1 over two trees. gitnexus does not break D4 outright, but it makes
the base side 25 times more expensive than our own scan, for a weaker import
graph.

`detect_changes` does understand two refs. `scope: "compare"` with
`base_ref: "HEAD~20"` returned 33 changed symbols across 32 files, each with
an id, a name, a file path and `change_type: "touched"`:

```json
{"summary":{"changed_count":33,"affected_count":0,"changed_files":32,"risk_level":"low"},
 "changed_symbols":[
  {"id":"Method:apps/meteor/server/services/video-conference/service.ts:VideoConfService.expireCall#1",
   "name":"expireCall","change_type":"touched"},
  {"id":"Class:packages/models/src/models/VideoConference.ts:VideoConferenceRaw",
   "name":"VideoConferenceRaw","change_type":"touched"}, … ]}
```

This maps diff hunks onto symbols of the **existing index**, not onto the base
tree. It cannot see a symbol that the base tree has and the index does not, so
it gives us the touched set, never the delta. `change_type` is always
`touched`; there is no added, removed or modified distinction.
`affected_processes` came back empty.

## The four pain points

| pain point | does gitnexus solve it? |
|---|---|
| internal packages resolve to `dist/*.d.ts` | **yes, by construction** |
| callbacks, abstract methods, interface methods, dynamic dispatch | **partly** |
| `.js` under `checkJs: false` | **yes** |
| barrel files, 17.5% of imports | **yes, for CALLS** |

1. **`dist` (D15).** `MATCH (f:File) WHERE f.filePath CONTAINS 'node_modules'
   OR f.filePath CONTAINS '/dist/' RETURN count(*)` returns **0**. gitnexus
   walks the git-tracked source tree, so it never reaches a symlinked built
   declaration. The `handleEvent` walk above lands on
   `packages/apps/src/server/managers/AppListenerManager.ts`, the source. Our
   ts-morph probe lands on `.../dist/server/ProxiedApp.d.ts`. This is the one
   place where the tree-sitter approach beats the typed approach outright.
   The cost is that gitnexus also cannot tell a real cross-package edge from a
   basename collision — the same blindness that breaks facts 3 and 4.

2. **Unfollowable calls.** gitnexus records 189 `interface-dispatch` edges and
   1730 `METHOD_IMPLEMENTS` plus 1058 `METHOD_OVERRIDES` edges, so an abstract
   or interface method can route to its implementations. That covers causes 2
   and 3 of our probe. Causes 1 and 4 — an inline `FunctionType` callback and
   a string-keyed registry — stay unfollowable, and gitnexus does not mark
   them. It records no "I stopped here" signal at all, so D14's confidence
   value cannot be derived from its output.

3. **`.js`.** tree-sitter parses JavaScript with its own grammar, so
   `checkJs` is irrelevant. The index holds 391 `.js` files, and
   `apps/meteor/server/startup/rateLimiter.js` — the file that produced most
   of our unresolved calls — yields clean local edges:

   ```
   | reconfigureLimit        | callback         | local-call |
   | configConnectionByMethod| reconfigureLimit | local-call |
   | configUserByMethod      | reconfigureLimit | local-call |
   | configConnection        | reconfigureLimit | local-call |
   | configUser              | reconfigureLimit | local-call |
   | configIP                | reconfigureLimit | local-call |
   ```

4. **Barrels.** Only 306 of 21359 `import-resolved` CALLS edges land on an
   `index.ts`, which is 1.4%. Name-based resolution walks past a barrel
   instead of stopping at it. Note that this is a side effect, not a re-export
   follower: gitnexus never modelled the barrel in the first place.

## How we would integrate it

**Not as tier 1.** Tier 1 needs a correct import graph, and gitnexus's is
58% wrong across package boundaries and 8.6% complete. Our own scan costs
2.6s against gitnexus's 60 to 70s, and it already handles the workspace map
that gitnexus lacks. Keep our tier 1.

**Not as tier 2 either, but it is a useful cross-check.** gitnexus's
intra-module call graph matched our probe almost exactly (49 against 47) and
it resolves into package `src`, which ts-morph does not. Open question 1's
caveat A says we keep two resolution strategies and prefer whichever finds a
body. gitnexus is a credible third strategy for the cross-package case that
D15 was written to patch. We should not make it the authority: it emits 426
self-loops, a flat 0.85 confidence, and no signal for a walk that stopped.

**It does not fit behind `LanguageAdapter`.** The interface wants
`branchCounts` and `effectHits` per symbol from one `analyze(modules)` call.
gitnexus supplies neither. Its CFG gives statement-level decisions only, which
undercounts React code by about 76%, and it has no effect catalog. An adapter
over gitnexus would have to re-read `Function.content` and count branches
itself — which is our own tier 2, without the type information.

**Where it could earn a place.** Two narrow uses:

- D10, blast radius. `impact(direction: "upstream")` returns a depth-bucketed
  dependent set with counts in one call. On `AppListenerBridge`:
  `{"impactedCount":21,"risk":"LOW","byDepthCounts":{"1":1,"2":10,"3":10}}`.
  It is cheap and it is advisory, which matches D10's "the dependent row
  carries blast radius, not new numbers".
- A reviewer-facing narrative. `Community` (1614 nodes, with `cohesion` and
  `heuristicLabel`) and `Process` (300 nodes, ordered `STEP_IN_PROCESS`
  chains) give named execution flows. That is prose for a report, not a metric.

**Recommendation.** Do not depend on gitnexus for the prototype. The
PolyForm-Noncommercial license alone rules out a shipped dependency. Instead
borrow two ideas: index the git-tracked source tree and never follow a
symlink into `node_modules` (it solves D15 for free), and record a per-edge
`reason` so a downstream walk can weigh a name-match against a type-match
(it feeds D14 directly).

## What I could not test, and why

1. **Our reference checkout.** `worktrees/accessor-consolidation` is not
   indexed, and a full index costs 60 to 70 seconds plus 800 MB written into
   a repo I was told not to modify. Every repo-scale number here comes from
   `worktrees/devcontainers`, 82 commits behind our reference.
2. **A real fixture PR.** PRs 41981, 42125 and 41201 need both trees indexed.
   I tested `detect_changes` against `HEAD~20` of an already-indexed worktree
   instead.
3. **A full PDG on Rocket.Chat.** The 1559-file and 3448-file slices are
   server-side TypeScript. I did not build a PDG over `apps/meteor/client`, so
   the 24% statement-branch figure for React comes from a grep of branch
   tokens, not from a built CFG.
4. **Cyclomatic complexity end to end.** I verified `E`-style counts on two
   methods by hand (`getListeners` = 2, `executeListener` = 51). I did not
   build a general McCabe extractor over the CFG, so I cannot state an error
   rate across a module.
5. **`explain`, `shape_check`, `check`, `group_*`, `rename`, `tool_map`.**
   `explain` needs the taint layer, which no indexed repo has. The others do
   not map to our six facts. `check` only finds import cycles.
6. **`analyze --watch`.** The README mentions it; `analyze --help` in 1.6.9
   does not list it. I could not confirm whether it re-indexes a subset.
7. **Query latency at scale.** Every Cypher query above returned in a few
   seconds, but I did not benchmark the recursive walk over the full 9797-file
   index with a wide starting set.
8. **Whether the `--pdg` CFG survives a re-index cleanly.** Switching PDG mode
   forced a full rebuild with a warning. I did not test a PDG index that goes
   stale.
