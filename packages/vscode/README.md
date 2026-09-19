# Complexity Lens

A VS Code extension for TypeScript with three features:

1. **Cyclomatic complexity on hover.** Point at a function and read its count.
2. **Go to the covering test.** One key takes you from a line of source to the
   test that runs it.
3. **Mutation testing of one test case.** One key mutates the code that the
   test case under the cursor covers, and it marks every mutant that survived.

The extension reads the TypeScript that VS Code already runs. It bundles no
compiler, and it starts no second language server.

## The two packages

| Package | What it holds |
| --- | --- |
| `packages/core` | Every rule: the counter, the test lookup, the mutation plan. No `vscode` import, no Node built-in import. |
| `packages/vscode` | The VS Code adapter: the hover provider, the two commands, and the four ports. |

The split is there so another editor can reuse the core. Read `docs/architecture.md` in the repository for the ports and for what an
adapter has to write, and `docs/cursor-information.md` for every signal that a
cursor position can reach.

## The features

### Complexity on hover

The count follows a pinned definition. A function starts at 1. Add 1 for each
`if`, `for`, `for..in`, `for..of`, `while`, `do`, `case`, `catch`, ternary,
`&&`, `||` and `??`. Optional chaining does not count. A default parameter does
not count. A logical assignment does not count.

The hover reports the *counting unit*. A nested named function is a unit of its
own. An anonymous callback is not: its branches belong to the function that
holds it, so the hover reports them as `inline` under that function. The count
of a callback is therefore never lost and never counted twice.

### Go to the covering test

Keybinding `ctrl+alt+t`, `cmd+alt+t` on macOS. Also in the editor context menu.

Three strategies run in order of confidence, and the first one that answers
wins:

| Order | Input | Confidence |
| --- | --- | --- |
| 1 | `reports/mutation/mutation.json`. A mutant carries the ids of the tests that ran it. | exact |
| 2 | The reference search of the TypeScript server, kept to the callers in test files. | likely |
| 3 | The name convention, such as `parser.ts` and `parser.test.ts`. | guess |

When no strategy answers, the message says why. A line coverage report, such as
`coverage/lcov.info`, cannot name a test, but it can say that no test runs the
line at all, which is the answer you want in that case.

Strategy 1 costs nothing to set up: the mutation command below writes exactly
that report.

### Mutation testing of one test case

Keybinding `ctrl+alt+m`, `cmd+alt+m` on macOS, inside a test file. Also in the
editor context menu.

Put the cursor in a test case and press the key. The extension:

1. reads the title of the case and the titles of its suites;
2. resolves what to mutate, from the imports of the test file and from the name
   convention;
3. detects the test runner from the nearest `package.json`;
4. runs Stryker over that scope, with the command test runner, so that each
   mutant runs that one test case;
5. marks every surviving mutant in the editor and reports the score.

The command line is visible before the run starts, and it is a setting. The
built-in one is:

```
npx stryker run --testRunner command \
  --commandRunner.command "npx vitest run 'test/pricing.test.ts' --testNamePattern 'pricing.*applies the tax rate'" \
  --mutate 'src/pricing.ts' --reporters json,clear-text --logLevel info
```

Stryker is not a dependency of this extension. The workspace supplies it, as it
supplies the test runner.

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| `complexityLens.hover.enabled` | `true` | Show the complexity hover. |
| `complexityLens.complexity.moderateThreshold` | `6` | Where `simple` ends. |
| `complexityLens.complexity.complexThreshold` | `11` | Where `complex` starts. |
| `complexityLens.complexity.criticalThreshold` | `21` | Where `critical` starts. |
| `complexityLens.testLookup.mutationReportPaths` | `["reports/mutation/mutation.json"]` | The exact input of the test lookup. |
| `complexityLens.testLookup.coveragePaths` | `["coverage/coverage-final.json", "coverage/lcov.info"]` | The line coverage input. |
| `complexityLens.testLookup.useReferences` | `true` | Ask the TypeScript server for the callers. |
| `complexityLens.mutation.testRunner` | `auto` | `auto`, `vitest`, `jest`, `mocha` or `node`. |
| `complexityLens.mutation.reportDirectory` | `reports/mutation` | Where Stryker writes. |
| `complexityLens.mutation.commandTemplate` | `""` | Replace the whole mutation command. |
| `complexityLens.mutation.concurrency` | `0` | Stryker workers. 0 leaves the choice to Stryker. |
| `complexityLens.mutation.namePatternScope` | `full` | Put the suite titles in the name filter. |
| `complexityLens.mutation.confirmBeforeRun` | `true` | Show the command and ask first. |
| `complexityLens.mutation.markSurvivors` | `true` | Mark the survivors in the editor. |

## Develop

The workspace needs pnpm and Node 20 or later.

```bash
pnpm install
pnpm -r build      # the core with tsc, the extension with esbuild
pnpm test          # the core suite, on the Node test runner
pnpm typecheck
```

Press `F5` in VS Code to start an extension host with the extension loaded.

`pnpm package` writes a `.vsix`.

## Language support

TypeScript, TSX, JavaScript and JSX today. The counter and the test reader
work on the syntax alone, so another language needs a parser for that language
behind the same two functions. Nothing above the parser changes.
