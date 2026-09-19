# What the editor knows at a cursor position

A catalog of every signal that a cursor position can reach, what each one
costs, and which of our three features it serves.

The catalog exists because all three features start from the same input: a
file and a position. The question "what does the editor already know about
this position?" decides whether a feature needs a parse, a language server
round trip, a file on disk, or nothing at all.

**Provenance.** The command signatures come from the VS Code built-in command
reference. The API shapes come from the `@types/vscode` that this workspace
installs, and from the source of the built-in `typescript-language-features`
and `git` extensions. Anything unverified is marked as such. Checked on
2026-09-19.

**Two conventions, and the bug between them.** Every position in VS Code and
in the core is zero based. Every position in a coverage report, in a Stryker
mutation report and in the mutation-testing schema is one based. `model.ts`
holds `toReportLine` and `fromReportLine` for exactly this, and nothing else
in the codebase should do the arithmetic.

## 0. The cursor itself

| Signal | Call | Note |
| --- | --- | --- |
| The caret | `editor.selection.active` | The end that moves. Our commands read this. |
| The other end | `editor.selection.anchor` | Where the selection started. |
| Direction | `selection.isReversed` | True when the caret sits before the anchor. |
| Every caret | `editor.selections` | Multi-cursor. Our commands use the first one only. |
| What is on screen | `editor.visibleRanges` | For a future gutter or CodeLens pass, analyse these lines alone. |
| Why the cursor moved | `window.onDidChangeTextEditorSelection` → `event.kind` | `Keyboard`, `Mouse` or `Command`. Useful to skip work while the user types. |
| The document | `editor.document` | `uri`, `languageId`, `version`, `isDirty`, `isUntitled`, `eol`. |
| Live text | `document.getText()` | The unsaved buffer. Never read the position's file from disk: the two disagree while the user types. |
| The identifier | `document.getWordRangeAtPosition(position)` | A word range with no parse and no server. |
| The line | `document.lineAt(position)` | `text`, `firstNonWhitespaceCharacterIndex`, `isEmptyOrWhitespace`. |
| Offsets | `document.offsetAt(position)`, `document.positionAt(offset)` | The bridge to the offsets that the TypeScript AST uses. |

## 1. The document alone: one parse, no server

`analyzeSource` and `analyzeTestSource` call `ts.createSourceFile` once, with
parent pointers on. No program, no type checker, no project load. The parse of
a 2000 line file costs a few milliseconds, it works while the file is dirty,
and it works while the file does not compile. This is the layer that answers a
hover.

| Fact at the position | Where | Feature |
| --- | --- | --- |
| The innermost function | `functionAt(analysis, position)` | hover |
| The counting unit that reports it | `countingUnitAt(analysis, position)` | hover |
| The count, split into body and inline callbacks | `FunctionComplexity.own`, `.inline` | hover |
| The name, and the class that holds it | `complexity/names.ts` | hover, lookup message |
| The full function range and the name range | `.range`, `.selectionRange` | the jump target, the reference query |
| The enclosing test case and its suite path | `testCaseAt(analysis, position)` | mutation run |
| The name filter for one case | `titlePattern(entry, scope)` | mutation run |
| The imports of the file | `mutation/scope.ts` | mutation scope |
| Any node, kind, ancestors, JSDoc, modifiers | the `ts` AST | open |

What this layer cannot do: resolve a symbol across files, know a type, or
follow a re-export. That needs layer 2.

## 2. The language server, through built-in commands

`vscode.commands.executeCommand(id, uri, position, ...)`. Every one of these
runs the same provider that the editor UI runs, so the answer follows imports,
re-exports and aliases. The cost is a round trip to the TypeScript server, and
the first call after a cold start waits for the project to load. None of them
is free; none of them belongs in a hover.

### Position in, symbols out

| Command | Arguments | Returns | Use |
| --- | --- | --- | --- |
| `vscode.executeReferenceProvider` | uri, position | `Location[]` | **In use.** Strategy 2 of the test lookup. Returns the declaration itself and every mention, not only the calls. |
| `vscode.prepareCallHierarchy` | uri, position | `CallHierarchyItem[]` | **The strongest upgrade available.** See below. |
| `vscode.provideIncomingCalls` | item | `CallHierarchyIncomingCall[]` | The callers, each with `fromRanges`. A type mention and an import are not callers, so this is strictly narrower than the reference search. |
| `vscode.provideOutgoingCalls` | item | `CallHierarchyOutgoingCall[]` | From a test case, what it calls. A second, deeper way to resolve the mutation scope than the import list. |
| `vscode.executeDefinitionProvider` | uri, position | `Location[]` or `LocationLink[]` | From a mention inside a test to the unit under test. |
| `vscode.executeTypeDefinitionProvider` | uri, position | `Location[]` or `LocationLink[]` | The type, not the value. |
| `vscode.executeDeclarationProvider` | uri, position | `Location[]` or `LocationLink[]` | The declaration, which may be a `.d.ts`. |
| `vscode.executeImplementationProvider` | uri, position | `Location[]` or `LocationLink[]` | The implementations of an interface member. A test may cover one of them. |
| `vscode.prepareTypeHierarchy` | uri, position | `TypeHierarchyItem[]` | Then `vscode.provideSupertypes` and `vscode.provideSubtypes`. For a method, the overrides — the covering test may exercise a subclass. |
| `vscode.prepareRename` | uri, position | range and placeholder | The exact identifier range that the server would rename: a server-checked "the symbol under the cursor". |
| `vscode.executeDocumentRenameProvider` | uri, position, newName | `WorkspaceEdit` | Not a read. |

### Position in, text out

| Command | Arguments | Returns | Use |
| --- | --- | --- | --- |
| `vscode.executeHoverProvider` | uri, position | `Hover[]` | The signature and the JSDoc that the server computes. We build our own label from the syntax, so we do not need it; it would add a *typed* signature to the complexity hover. |
| `vscode.executeSignatureHelpProvider` | uri, position, triggerCharacter? | `SignatureHelp` | Which argument the cursor sits in. |
| `vscode.executeCompletionItemProvider` | uri, position, triggerCharacter?, itemResolveCount? | `CompletionList` | No use here. |
| `vscode.executeDocumentHighlights` | uri, position | `DocumentHighlight[]` | The read and write occurrences in this file only. |
| `vscode.executeSelectionRangeProvider` | uri, position | ranges | The syntactic ranges around the cursor, smallest first. An enclosing-node chain computed by the editor instead of by our parse. |

### Range or file in

| Command | Arguments | Returns | Use |
| --- | --- | --- | --- |
| `vscode.executeDocumentSymbolProvider` | uri | `SymbolInformation[]` or `DocumentSymbol[]` | A hierarchical symbol tree, cheaper than our parse. It carries no branch count and no test titles, so it cannot replace the parse — but it is the fastest way to get an enclosing-symbol chain. |
| `vscode.executeCodeActionProvider` | uri, rangeOrSelection, kind?, itemResolveCount? | the available actions | The refactors at the position, such as "extract function" — the natural next step after a critical count. |
| `vscode.executeInlayHintProvider` | uri, range | `InlayHint[]` | Inferred types and parameter names. |
| `vscode.provideDocumentRangeSemanticTokens` | uri, range | `SemanticTokens` | The token kind the server assigns. It can tell a real `it(...)` call from a local variable named `it`, which our syntax reader cannot. |
| `vscode.provideDocumentRangeSemanticTokensLegend` | uri, range? | `SemanticTokensLegend` | Needed to read the tokens above. |
| `vscode.executeFoldingRangeProvider` | uri | `FoldingRange[]` | Block ranges. |
| `vscode.executeCodeLensProvider` | uri, itemResolveCount? | `CodeLens[]` | What other extensions already offer on these lines. |
| `vscode.executeLinkProvider` | uri, linkResolveCount? | `DocumentLink[]` | No use here. |
| `vscode.executeFormatDocumentProvider`, `…FormatRangeProvider`, `…FormatOnTypeProvider`, `…DocumentColorProvider`, `…ColorPresentationProvider`, `…InlineValueProvider` | — | — | No use here. |

### Why call hierarchy beats the reference search

Strategy 2 of the test lookup asks "who calls this function, and does the
caller sit in a test file?". `executeReferenceProvider` answers a wider
question: it returns the declaration, the imports, the type positions and the
calls together. Every non-call it returns becomes a test that we offer and
that does not run the line. `prepareCallHierarchy` plus
`provideIncomingCalls` returns callers only, and each caller carries
`fromRanges`, which is the call site itself — a better range to map to an
enclosing test case. The cost is two round trips instead of one.

## 3. The TypeScript server, directly

The built-in TypeScript extension exposes one command that forwards a raw
request to `tsserver`:

```
vscode.commands.executeCommand('typescript.tsserverRequest', <request>, { file: <uri> })
```

The allowlist is closed: `emit-output`, `semanticDiagnosticsSync`,
`syntacticDiagnosticsSync`, `suggestionDiagnosticsSync`, `quickinfo`,
`quickinfo-full`, `completionInfo`, and any request whose name starts with
`_`. This is a VS Code internal command, not a public API. It can change or
disappear in a release, so anything built on it needs a fallback.

`quickinfo-full` at a position is the interesting one: it returns the
server's own symbol kind, display parts and documentation, which is more than
the hover provider hands back.

The extension's UI commands act on the active editor and return nothing, so
they navigate but they do not report:

| Command | What it does |
| --- | --- |
| `typescript.goToSourceDefinition` | Jumps past a `.d.ts` to the real source. |
| `typescript.findAllFileReferences` | Finds the files that import this file. |
| `typescript.goToProjectConfig` | Opens the `tsconfig.json` that owns the file. |
| `typescript.selectTypeScriptVersion` | The version picker, which decides what our loader loads next. |
| `typescript.restartTsServer`, `typescript.reloadProjects`, `typescript.openTsServerLog` | Recovery and diagnosis. |
| `typescript.sortImports`, `typescript.removeUnusedImports` | Edits. |

The extension also exports an API for a tsserver *plugin*
(`getAPI(0).configurePlugin`). That is a channel for code that runs inside the
server, not a way to read from outside it.

## 4. The workspace around the position

| Signal | Call | Use |
| --- | --- | --- |
| The root that owns the file | `workspace.getWorkspaceFolder(uri)` | **In use.** Every report path and every mutation glob is relative to it. |
| A display path | `workspace.asRelativePath(uri)` | Messages. |
| Settings for this resource | `workspace.getConfiguration('complexityLens', uri)` | **In use.** A monorepo can set a different threshold per folder. |
| The pinned compiler | `workspace.getConfiguration('typescript', folder.uri).get('tsdk')` | **In use.** First candidate of the TypeScript loader. |
| Errors on this line | `languages.getDiagnostics(uri)`, filtered by range | Not used. It would stop a mutation run on a file that does not compile, which otherwise burns minutes before Stryker reports a compile error. |
| Files by glob | `workspace.findFiles(glob, exclude)` | **In use** in the file-system port. |
| Open buffers | `workspace.textDocuments` | **In use.** The port prefers an open buffer over the disk. |
| Whether a selector matches | `languages.match(selector, document)` | The supported-language check. |
| The repository | `git` extension → `getAPI(1).getRepository(uri)` | Not used. See below. |

### What git adds

The built-in git extension exports `getAPI(1)`, with `repositories`,
`getRepository(uri)` and `onDidOpenRepository`. A `Repository` offers
`blame(path): Promise<string>` — the whole file as raw blame text, not a line
query — plus `diffWithHEAD(path)`, `log(options)` and `getCommit(ref)`.

That is enough for a signal we do not yet use: *this line changed in the
working tree or in the last commit, and no test covers it*. It ranks the
uncovered lines that matter now above the ones that have been uncovered for
two years.

## 5. The closed doors

Three things the editor plainly knows and does not hand over. Each one is a
design constraint, not an oversight to route around.

**The test tree of another extension.** `vscode.tests` exports exactly one
function: `createTestController`. There is no read access to a `TestItem`
tree that the Vitest, Jest or Mocha extension owns, so we cannot ask the
editor "which test case is at this line?" even though the Test Explorer shows
it. This is why `tests/cases.ts` parses `describe` and `it` itself.

**Per-test coverage.** The coverage API is provider-side. `FileCoverage`
carries `includesTests`, and `TestRunProfile.loadDetailedCoverage` and
`loadDetailedCoverageForTest` are callbacks that a *test provider*
implements. The editor therefore holds the exact mapping that strategy 1 of
our lookup wants — line to test case — and exposes it to nobody. This is why
we read `mutation.json` off the disk instead. (Both members postdate the `1.85` engine that the
manifest declares and the types that are pinned to it, so using them means
raising both.)

**"Run the test at the cursor."** `testing.runAtCursor`,
`testing.debugAtCursor` and `testing.coverageAtCursor` do resolve the test at
the cursor, through whichever controller owns it, and they run it. They
return nothing. So they can act for us, and they cannot inform us. Same for
`testing.runCurrentFile` and `testing.coverageCurrentFile`.

## 6. Going further

`deeper-integration.md` answers the four questions that follow from this
catalog: whether to write a tsserver plugin, whether the project index can
give a blast radius, what canvas the editor offers for a graph view, and
whether our own information can live inside the editor's model.

## 7. What each feature uses today

| Feature | Layer 0 (parse) | Layer 2 (server) | Disk | On the shelf |
| --- | --- | --- | --- | --- |
| Complexity hover | the whole answer | — | — | a typed signature from `executeHoverProvider` |
| Go to covering test | the enclosing unit, the test cases of the candidate files | `executeReferenceProvider` | the mutation report, then the coverage report | incoming calls instead of references; git recency to rank |
| Mutation test one case | the test case, the suite path, the imports | — | `package.json`, then the report it writes | outgoing calls to widen the scope; diagnostics to refuse a broken file |

## 8. Hazards

- **The types must not outrun the engine.** `@types/vscode` is not pinned by
  semver to the API it describes: a `^1.85.0` range resolved to the newest
  1.x types, so `tsc` accepted an API that VS Code 1.85 does not have and the
  failure would only appear at run time in an older editor. The dependency is
  therefore `~1.85.0`, which matches `engines.vscode`. Raise both together,
  never one alone.
- **A stale hover is worse than a slow one.** Every cached analysis is keyed
  on `document.version` and on the thresholds. Any new cache needs the same
  key.
- **A position is not an offset.** The TypeScript AST works in offsets, VS
  Code works in line and character. `syntax.ts` converts through the source
  file's own line starts, so the two never drift.
