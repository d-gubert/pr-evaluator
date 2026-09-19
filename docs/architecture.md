# Architecture

The extension is two packages. The line between them is the reason this
document exists: another editor must be able to reuse everything above it.

```
 VS Code                      packages/vscode                packages/core
 ───────                      ───────────────                ─────────────
 hover request        ──▶  ComplexityHoverProvider  ──▶  analyzeSource()
 ctrl+alt+t           ──▶  goToCoveringTest()       ──▶  createTestLookup()
 ctrl+alt+m           ──▶  runMutationTesting()     ──▶  buildMutationPlan()
 TypeScript of VS Code ─┐
 workspace.fs           ├─▶  the four ports        ◀──   ports.ts
 executeReferenceProvider│
 tasks.executeTask     ─┘
```

## The rule of the core

`packages/core` imports **no** `vscode` and **no** Node built-in module. Not
`node:fs`, not `node:path`, not `node:child_process`. The package therefore
runs in a Node extension host, in the VS Code web host, and in a browser.

The consequence you see in the source: `src/paths.ts` is 90 lines of path
handling that `node:path` would give for free. That is the price, and it buys
a core with no host in it.

## The four ports

An adapter for another editor implements these, and nothing else.

| Port | What it does | VS Code adapter |
| --- | --- | --- |
| `TypeScriptApi` | The TypeScript compiler API. The core imports only its *types*. | The copy inside VS Code, loaded at run time. |
| `FileSystem` | `readFile`, `exists`, `findFiles`. | `vscode.workspace.fs`, with the open editors first. |
| `ReferenceFinder` | The callers of a symbol. Optional: a host without one returns `[]`. | `vscode.executeReferenceProvider`. |
| `CommandRunner` | Run a command line, return an exit code. | A `vscode.Task` with a `ShellExecution`. |

`Logger` is a fifth, and `SILENT_LOGGER` is the default.

## Why TypeScript is a port

The obvious design bundles the TypeScript compiler with the extension. This one
does not, for three reasons:

1. **One version.** The hover reads the same syntax that the editor reads. A
   workspace that pins a TypeScript through `typescript.tsdk` pins this
   extension too, in the same step.
2. **Size.** The bundle is around 80 KB. A bundled compiler is around 8 MB.
3. **Honesty of the port.** A compiler that arrives through a port cannot be
   reached from the core by accident.

`packages/vscode/src/typescript-loader.ts` looks for it in the order that the
built-in TypeScript extension uses: the `typescript.tsdk` setting, the copy
inside VS Code, and `node_modules/typescript` of an open folder.

No type checker and no program is built. Every feature needs the syntax alone,
so one `createSourceFile` call answers a hover in a few milliseconds and never
waits for a project to load.

## The three features, as data

### Complexity

`analyzeSource(ts, file, text, { thresholds })` returns every function of the
file with `own`, `inline`, `total`, a grade, a range and a *counting unit*. The
unit matters: an anonymous callback folds into the function that holds it, so
the hover reports that function and never counts a branch twice. See
`src/complexity/counter.ts` for the pinned definition of the count.

### The test lookup

`createTestLookup(deps).find(query)` returns a ranked list, each entry with a
confidence and a reason. The strategies are in `src/link/test-lookup.ts`:

1. the mutation report, which is the only input that names a test per line;
2. the reference search of the host;
3. the name convention.

Line coverage is not a strategy. It names no test. It turns an empty answer
into a sentence: "the lcov report says no test runs this line".

### The mutation run

Stryker has no flag that selects one test, so `buildMutationPlan` nests two
commands: Stryker runs a command per mutant, and that command runs one test
case through the name filter of the runner of the workspace. The nesting is why
`src/shell.ts` exists, and why the quoting is tested on both shells.

The run writes `reports/mutation/mutation.json`, which is strategy 1 of the
test lookup. Each run therefore makes the next lookup exact.

## To port to another editor

1. Implement the four ports over the API of the editor.
2. Load a TypeScript, or accept one from the host.
3. Map `Position` and `Range`, which are zero based, as in the Language Server
   Protocol.
4. Call `analyzeSource`, `createTestLookup` and `buildMutationPlan`.
5. Take the user-facing text from `src/presentation.ts`, so the wording stays
   the same everywhere.

`packages/core/test/portability.test.ts` is the worked example: it implements
the ports over `node:fs` and it drives all three features with no editor at
all.
