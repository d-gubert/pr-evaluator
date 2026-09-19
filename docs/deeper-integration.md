# Four questions about deeper integration

`cursor-information.md` catalogs what the editor tells us today. This document
answers four questions about going further: into the TypeScript server, into
the project index, onto a canvas, and into the editor's own model.

Each answer opens with a verdict, then the mechanics, then the cost, then what
I would do in this codebase.

**Provenance.** The TypeScript plugin interfaces are quoted from the
`typescript@5.9.3` type definitions in this workspace. The VS Code API shapes
are quoted from the pinned `@types/vscode@1.85.0`. The loading rules and the
command ids are quoted from the source of the built-in
`typescript-language-features` and `references-view` extensions. Checked on
2026-09-19.

## 1. Can we write a tsserver plugin? What would it offer?

**Verdict: yes.** It is the only way to reach the type checker that the editor
has already built. Everything else either guesses from the syntax or builds a
second copy of the program.

### How it attaches

A VS Code extension contributes the plugin in its manifest. The path resolves
against the extension's own `extensionUri`, so the plugin ships inside our
`.vsix`:

```json
"contributes": {
  "typescriptServerPlugins": [
    {
      "name": "complexity-lens-tsserver-plugin",
      "enableForWorkspaceTypeScriptVersions": true,
      "languages": ["typescript", "typescriptreact"],
      "configNamespace": "complexityLens"
    }
  ]
}
```

The plugin itself is a factory that decorates the language service:

```ts
// PluginModuleFactory = (mod: { typescript: typeof ts }) => PluginModule
// PluginModule.create(info: PluginCreateInfo): LanguageService
```

`PluginCreateInfo` hands over `project`, `languageService`,
`languageServiceHost`, `serverHost`, an optional `session` and the `config`
from the manifest's `configNamespace`. `create` returns a proxy: keep every
method of the original service, and override the few you want to change.

### The two channels back to the extension

| Direction | Mechanism | Note |
| --- | --- | --- |
| Extension → plugin | `getAPI(0).configurePlugin(pluginId, config)` on the exports of `vscode.typescript-language-features` | The plugin receives it in `onConfigurationChanged`. One way only. |
| Extension → plugin → answer | `info.session.addProtocolHandler('_complexityLens', handler)`, then `vscode.commands.executeCommand('typescript.tsserverRequest', '_complexityLens', { file })` | `Session.addProtocolHandler` is a real method on the session. VS Code's request allowlist admits **any** request name that starts with `_`, which is what makes the round trip possible. |

Neither channel is a documented public API. `addProtocolHandler` is part of
the `ts.server` namespace, and `typescript.tsserverRequest` is a VS Code
internal command. Both can change in a release.

### What it would buy us

| Capability | Why it matters here |
| --- | --- |
| The real `Program` and `TypeChecker`, already loaded and already invalidated incrementally by the server | No second copy in memory, and no project load of our own |
| Decorate `getQuickInfoAtPosition` | The count appears in the **editor's own** hover, so we need no hover provider |
| Decorate `getSemanticDiagnostics` | "Complexity above the threshold" becomes a real diagnostic, with squiggles, the Problems panel and `# problems` in the status bar |
| Decorate `getApplicableRefactors` / `getCodeFixesAtPosition` | "Extract this branch" offered at the place where the count is too high |
| Type-aware resolution | A test helper that wraps `it`, a callback passed by reference, `this`, a re-export, an interface method's implementations — every case our syntax reader cannot see |
| A whole-project walk with no IPC per edge | This is the answer to the cost problem in question 2 |
| `getExternalFiles` | Makes the server watch files that are not in the program |

### The cost

- **Blast radius of a bug.** The plugin runs inside the process that serves
  every language feature. A throw degrades or kills completion, hover and
  diagnostics for the whole project, not just our panel.
- **A different world.** No `vscode` API, no DOM, plain JavaScript resolvable
  as a node module, and debugging through the TS Server log or `TSS_DEBUG`.
- **The version rule is enforced.** The server receives a contributed plugin
  only when it runs the bundled TypeScript, *unless*
  `enableForWorkspaceTypeScriptVersions` is true. Our loader already prefers
  the workspace copy, so the flag is not optional for us.
- **Skew.** The plugin gets `mod.typescript` from the server, which may be
  older or newer than the version we compiled against.
- **Per project.** A monorepo with several `tsconfig.json` files loads the
  plugin once per project.

### What I would do

Leave it for now, and keep the door open — which it already is. A plugin is
one more implementation of a port, not a rewrite: the core's analysis needs a
`TypeScriptApi` and plain data, and a plugin can supply both. Build it when we
want the count inside the editor's own hover and diagnostics, or when the
type-aware cases start producing wrong answers in real code.

## 2. Can we use the editor's index for the blast radius of a changed symbol?

**Verdict: partly.** The index is there and it is authoritative, but it is
reachable only through point queries. There is no "give me the graph" call, so
a blast radius is a traversal we drive ourselves, at one request per node.

### What the index answers

| Query | Granularity | Note |
| --- | --- | --- |
| `prepareCallHierarchy` → `provideIncomingCalls` | function | The real edge set. Each caller carries `fromRanges`, the call sites themselves. |
| `executeReferenceProvider` | mention | Wider than calls: the declaration, the imports and the type positions come too. |
| `executeImplementationProvider`, `prepareTypeHierarchy` → `provideSubtypes` | type | The dispatch edges a call graph misses. The callers of an interface method are not the callers of its implementations. |
| `executeWorkspaceSymbolProvider(query)` | name | A name search. No edges. |
| `typescript.findAllFileReferences` | file | A coarse first cut, but it is a UI command: it fills the references view and returns nothing to us. |

### The shape of the command

1. **Find what changed.** The git API gives `diffWithHEAD(path)`. Map the
   changed line ranges through our own parse to the counting units that
   contain them. We already have every piece of this.
2. **Walk outward.** Breadth-first over incoming calls, deduped by file and
   range, with a depth cap and a breadth cap, inside
   `window.withProgress` and with a cancellation token.
3. **Stop at the tests.** A test file is a leaf. A test that reaches the
   changed symbol *is* the blast radius; who calls the test does not matter.
4. **Report.** Each reached unit with its complexity, whether a test covers
   it, and the path that reached it. The first two we already compute.

### The honest limits

- **One round trip per node.** A widely used utility fans out to hundreds of
  callers. Depth two or three with a cap is the usable envelope, and no batch
  API exists to widen it.
- **A call graph is a lower bound.** It does not see a call through a value
  (`const f = obj.method; f()`), a dynamic dispatch, a DI container, a
  decorator, or a string-keyed event bus. Label the output as a lower bound,
  or it will be trusted as a proof.
- **Freshness.** The answer is as good as the server's project state, and a
  cold start pays the project load before the first edge.

### The alternative, and its price

Build our own `ts.createProgram` in the extension host. One pass gives the
whole graph with no IPC per edge — and it costs a second program in memory
plus a project load, which is exactly what this project rejected for the
hover. For a user-invoked command behind a progress bar, that trade is
defensible. For anything that runs while the user types, it is not.

The `main` branch of this repository is the worked example of the
program-building approach: it builds a program, walks the call graph and
scores a symbol. Read it before choosing.

### What I would do

Ship a user-invoked command built on the call hierarchy, capped and
cancellable, whose output says "lower bound" on its face. Revisit the plugin
from question 1 if the caps start to hurt: inside the server, the same walk
costs no IPC at all.

## 3. Does VS Code offer a free movement canvas for a graph view?

**Verdict: yes, one — a webview.** VS Code has no native node-graph widget and
no other canvas surface. A webview is an iframe that runs our own HTML, CSS
and JavaScript.

### The three webview surfaces

| Surface | Call | Where it lands |
| --- | --- | --- |
| Panel | `window.createWebviewPanel(viewType, title, showOptions, options)` | A tab in the editor area, beside the code |
| View | `window.registerWebviewViewProvider(viewId, provider)` | Docked in the sidebar or the bottom panel |
| Custom editor | `window.registerCustomEditorProvider(viewType, provider)` | Bound to a file, if the graph should be a document |

The mechanics that matter:

- `enableScripts: true`, and `localResourceRoots` to allow our bundle.
- `webview.asWebviewUri(uri)` for every local file, and `webview.cspSource`
  in a `Content-Security-Policy` meta tag. A CDN will not load, so the layout
  library ships in the bundle.
- `webview.postMessage` and `onDidReceiveMessage` in both directions. The
  webview has no `vscode` API — messages are the whole interface.
- `retainContextWhenHidden` keeps the graph alive on a hidden tab, at a
  documented high memory cost. The cheaper path is
  `acquireVsCodeApi().setState()` inside the webview plus
  `window.registerWebviewPanelSerializer` to restore after a reload.
- Theme with the CSS variables the editor injects, such as
  `--vscode-editor-background` and the chart colours, so the graph follows the
  user's theme instead of fighting it.

The real work is layout, not plumbing: a layered layout for a call graph, a
force layout for clusters.

### The cheaper native surfaces, in order of effort

1. **A Mermaid graph in a Markdown preview.** No interaction, minutes of work,
   and often enough to read a call graph.
2. **`window.createTreeView(viewId, { treeDataProvider })`.** A tree, not a
   canvas, but selection, keyboard navigation, context menus and theming come
   free.
3. **`languages.registerCallHierarchyProvider`.** Our own edges rendered in
   the editor's own Call Hierarchy view. The built-in references view drives
   it with `references-view.showCallHierarchy`,
   `references-view.showIncomingCalls` and `references-view.showOutgoingCalls`;
   `references-view.showTypeHierarchy` and `references-view.findReferences` are
   the siblings.

### What I would do

Start with the call hierarchy provider or a tree view, because both inherit
the editor's behaviour for free. Reach for a webview when the graph really
needs free movement — drag, zoom, pin, cluster — and keep the core out of it:
the panel should receive plain nodes and edges, so the same graph data can
feed another editor's canvas.

## 4. Can we enrich the editor's index or AST, or must we keep a shadow?

**Verdict: no, and yes.** The index lives in another process, and its AST is
not addressable from the extension host. There is no API to attach a field to
a node the server owns. Three things are possible instead, and we already do
the third.

### 4a. Enrich the answers, from inside

A tsserver plugin returns a decorated `LanguageService`, so it can add our
information to quick info, diagnostics, code fixes, refactors and
completions. That is enrichment of the *answers*, not of the AST.

Inside the plugin you can hold a `WeakMap<ts.Node, T>`, but node identity
survives only one program version: the server reparses on edit and reuses
nodes only sometimes. A map that must outlive an edit has to be keyed by file,
version and span — which is a shadow index with extra steps, running in a
riskier process.

### 4b. Enrich what the editor shows

Registering a provider is the supported way to put our own facts into the
editor's own surfaces. All of these exist at the engine we target:

| Provider | Surface it feeds |
| --- | --- |
| `registerCodeLensProvider` | A line above each function. **In use** for the count. Lenses from several providers simply appear together. |
| `registerDocumentSymbolProvider` | The outline and the breadcrumbs — but **not beside another provider**. `OutlineModel` builds one group per provider and flattens the tree only when exactly one group is non-empty, so a second provider shows the outline twice, once per provider. Closed to us while the TypeScript extension answers. |
| `registerInlayHintsProvider` | Inline, inside the line. |
| `createDiagnosticCollection` | The Problems panel. **In use** for surviving mutants. |
| `createTextEditorDecorationType` + `setDecorations` | Gutter icons, colour, overview-ruler marks. |
| `registerCallHierarchyProvider`, `registerTypeHierarchyProvider`, `registerReferenceProvider`, `registerSelectionRangeProvider` | The native navigation views. |
| `registerFileDecorationProvider` | A badge on the file in the explorer. |
| `setContext` | Our facts inside `when` clauses. **In use** for `complexityLens.supportedFile` and `complexityLens.testFile`. |

### 4c. Keep a shadow — what we do

`ComplexityHoverProvider` holds a map from the document URI to
`{ key, result }`, where the key is `document.version` plus the thresholds.
That is the entire invalidation contract, and it is sound because a
`TextDocument` version increments on every edit. Any new cache needs the same
key.

To persist a shadow across sessions: `ExtensionContext.workspaceState` and
`globalState` are `Memento` stores for JSON, with `setKeysForSync` for
settings sync, and `storageUri` and `globalStorageUri` are directories for
files. A parsed mutation report keyed by its modification time belongs there.
An AST does not.

### What I would do

Treat the shadow as the design, not as a workaround. Every feature here reads
syntax, so the shadow costs one parse, and it is always in step with the
buffer — including while the file is dirty and while it does not compile. In
both of those states the editor's own index is stale or empty, and those are
exactly the moments when a developer is writing the code that the hover is
supposed to describe.

Then add 4b where it pays. The first of those is done: the count now rides a
code lens. The outline was the original candidate and it turned out to be
closed — see the row above, and D9 in `decisions.md`.
