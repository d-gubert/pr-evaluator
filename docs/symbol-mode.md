# Symbol mode — 2026-09-15

The diff-driven CLI reports the six facts per module, over two trees. Symbol
mode reports the same six facts for **one symbol**, over one tree, with no diff
and no delta.

It answers a smaller question: what does the engine know about this symbol,
before we answer the open questions of `design.md`.

Nothing in the module pipeline changed. `src/cli.ts`, `src/pipeline.ts`,
`src/modules.ts` and `src/delta.ts` are untouched. `src/tier2.ts` gained three
`export` keywords and no new logic, so symbol mode and module mode resolve a
call the same way.

## Run it

```bash
pnpm symbol -- --repo <path> --symbol <file>#<Name>
pnpm symbol -- --repo <path> --symbol <file>#<Class>.<method>
pnpm symbol -- --repo <path> --symbol <Name>          # searches the tree
```

| option | meaning |
|---|---|
| `--symbol <ref>` | `<file>#<Name>`, `<file>#<Class>.<method>`, or a bare name. |
| `--edge file\|module\|package\|repo` | where the transitive walk stops. Default `module`, which is D6. |
| `--compare-edges` | walk at all four edges and print the four results side by side. |
| `--follow-dist` | enter a sibling package through its source, not its built `.d.ts`. |
| `--full-program` | load the whole tsconfig, as tier 2 does. Default is a lazy program. |
| `--coverage <file>` | istanbul `coverage-final.json` or `lcov.info`. |
| `--json <file>` | the full report. JSON is the contract; the table is a view. |
| `--html <file>` | the same report as one self-contained page. No network, no build step. |
| `--dot <file>` | the call graph as Graphviz. `dot -Tsvg out.dot -o graph.svg`. |
| `--callers-deep` | also scan every module file for call sites. It costs ~15ms per file. |
| `--no-refs` | skip type references. Facts 3 and 4 then count calls only. |
| `--no-closures` | keep every `function-type` stop. The closure pass of D17 is on by default. |
| `--brief` | drop the evidence lists and keep the numbers. |

## What it reports

The six facts, and the evidence behind each number:

| fact | at the symbol level |
|---|---|
| 1. boundary | on the declared surface or internal, bypassed, unused, every importer file and line, the barrels that carry the name, the providers that match. |
| 2. complexity | own, own plus inline callbacks, transitive, the reach, the depth, the hotspot list, the per-file split, the call tree. |
| 3. direct dependencies | the modules, packages and npm packages this symbol reaches, split into calls and type references. |
| 4. indirect dependencies | the module graph beyond those, with the hop count. |
| 5. side effects | the categories, and the file, line and function of each hit. |
| 6. coverage | the ratio over the reached function set, and the ratio per function. |

It also reports the confidence of D14, every stop with its source text, every
crossing of the edge with the raw path the checker resolved, and the call sites
of the symbol.

It reports the calls the closure pass of D17 resolved as well, with the number
of bodies it found and whether it dropped the stop. A call tree edge that the
pass added carries a `(closure)` tag, so no inference is silent.

## The HTML view

`--html out.html` writes one file that embeds the JSON and reads it back. It
has no CDN link and no build step, so it opens from disk and it survives a
copy to another machine.

Eleven panels: the call tree, the hotspots, the dependencies, the boundary,
the effects, the coverage, the stops, what the closure pass resolved, the
crossings, the callers, the edge comparison and the raw JSON. The panel name sits in the URL hash, so a link
points at one panel. Every table has a filter box. The page follows the
reader's light or dark setting.

The call tree in the page is the whole tree. It rebuilds from `nodes` and
`callEdges` and it marks a cycle. The text view stops at `--tree` lines.

## What it measured

### 1. A module report can read zero where a symbol reports 104

Commit `89cd73af36` changes `apps/meteor/client/sidebar/hooks/useRoomList.ts`
by 35 lines. This is open question 11, in a second module.

| report | result |
|---|---|
| module `apps/meteor/client/sidebar` | 61 files, boundary 6, complexity 36, **delta 0 on every fact** |
| symbol `useRoomList` | complexity **104** over 20 functions, 6 modules of direct dependencies, 54 indirect, 6 stops, confidence 0.90 |

The module number does not move, because the change never reaches a boundary
symbol. The symbol number is there whatever the module size.

### 2. D15 has a third trap, and it is silent

The design covers `node_modules/@rocket.chat/*` and `<pkg>/dist/**.d.ts`. pnpm
produces a third shape:

```
apps/meteor/node_modules/@rocket.chat/apps
  /node_modules/@rocket.chat/core-typings/dist/IRoom.d.ts
```

`remapDistToSrc` matches `node_modules/(.+)` without an anchor, so it takes the
**first** segment, resolves `@rocket.chat/apps`, and returns
`packages/apps/node_modules/@rocket.chat/core-typings/src/IRoom.ts`. That path
exists, because the inner link points at the real package. So the function
returns a wrong answer that passes an existence check.

The effect on fact 3 of `eraseRoom`, before and after the fix:

| before | after |
|---|---|
| `@rocket.chat/core-typings` external, 27 refs | `packages/core-typings/src` internal, 27 refs |
| `@rocket.chat/model-typings` external, 38 refs | `packages/model-typings/src` internal, 38 refs |
| `@rocket.chat/apps-engine` external, 4 refs | `packages/apps-engine/src` internal, 4 refs |

**The fix is local to `src/symbol.ts` (`toSourcePath`).** `src/workspace.ts` is
untouched, so no module number moved. Two rules make it work: the last
`node_modules` segment names the real package, and a remap that still holds
`node_modules` is not an answer. `resolveSpec` of tier 1 then applies the rule
that prototype-findings already pinned: the source tree wins.

Decide whether `remapDistToSrc` takes the same fix. It changes fact 3, fact 4
and fact 10 of the module report.

### 3. Widening the D6 edge buys little in this repository

`eraseRoom`, at the four edges, with `--follow-dist`:

| edge | reach | complexity | stops | crossings |
|---|---|---|---|---|
| file | 1 | 14 | 0 | 10 |
| module | 14 | 42 | 0 | 28 |
| package | 16 | 46 | 1 | 27 |
| repo | 19 | 50 | 18 | 13 |

The repo edge adds 5 functions and 8 complexity, and it adds **18 stops**. 15
of them are `interface`: `Rooms.findOneById`, `Team.getOneById`,
`Apps.triggerEvent`. Rocket.Chat reaches another package through an interface,
so a static walk cannot follow the call even when the source is loaded.

D6 stops at the module edge. This measurement supports that choice, and it
shows what a wider edge would cost: more stops, not more signal.

### 4. A lazy program cuts the cost by three quarters

| run | cost |
|---|---|
| module mode, two trees, one `apps/meteor` module | 43s |
| symbol mode, one tree, lazy program | 11s to 13s |
| symbol mode, one tree, `--full-program` on `packages/apps` | 7.5s |

The lazy program loads the file and the transitive closure of its imports: 70
files for `eraseRoom` against 5853 for the whole tsconfig. Tier 1 (2.7s) and
the program load (1.5s to 3.6s) dominate. The walk itself costs 45ms to 308ms.

This says that open questions 4 and 16 are cheaper at the symbol level. One
symbol needs one program, and a lazy program is enough.

## Which open questions it feeds

| question | what symbol mode gives |
|---|---|
| 1. call resolution | every stop with its source text, per symbol, not as a rate. |
| 4, 16. which tsconfig | a lazy program, measured against the full one. |
| 5. effect catalog | the hit list with file and line, so a miss is visible. |
| 11. module patterns | finding 1 above: the failure is a pattern fault, and the symbol unit routes around it. |
| 13. JavaScript files | the confidence drops with the `.js` fraction of the reached files. |
| 14. confidence | a per-symbol value, plus every reason with a location. |
| 15. coverage gaps | the per-function coverage list shows which part is unknown. |

## What it does not do

- **No delta.** One tree only. The two-tree symbol delta is not built;
  `diffSymbol` in `src/delta.ts` already fits it.
- **A member reference describes the holder in fact 1.** A boundary is a
  property of a name the module exports, and a method is not that name.
- **`--follow-dist` does not check that `dist` is current.** Open question 12
  stands.
- **The reference resolver is syntactic about overloads.** It returns every
  declaration with the name and walks them all.
- **The closure pass reads one shape only.** D17 covers a `const` array that
  the same scope fills with `push`. It does not resolve an abstract method,
  an interface method, or a callback that a parameter carries into the
  function. An `abstract` stop needs a program that spans the consumer
  package, which this mode does not build.
- **A `for..of` over an array of functions still drops its edge.** The walk
  records no stop there, so the hole is invisible. Open question 17.
