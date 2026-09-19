# Decisions

Short records of the choices that a reader would otherwise have to guess at.

## D1. The count is ours, not ESLint's

No two tools agree on cyclomatic complexity. ESLint's `complexity` rule reports
a higher number than the definition in `counter.ts`, and it reports no range,
so it cannot answer "which function is under the cursor". The count lives in
this repository, and `counter.ts` states the definition in full.

## D2. An anonymous callback is not a unit

`items.map((item) => ...)` is not a function that a reader reasons about
separately. Its branches belong to the function that holds it. So the callback
folds into its caller through `inline`, and a named nested function does not.
Both numbers are visible in the hover, so neither is hidden.

## D3. No type checker

Every feature reads the syntax. A type checker would pull in a program load,
a file watcher and a memory cost, and it would answer the same questions. A
hover must be fast more than it must be clever.

## D4. Per test coverage comes from the mutation report

Istanbul and lcov aggregate over the whole run: they say a line is covered, not
by what. Stryker's report holds `coveredBy` per mutant and a `testFiles` map,
so it names the tests exactly. This is the reason the mutation feature and the
test lookup feature sit in one extension: one produces the input of the other.

## D5. Stryker runs through the command runner

Stryker's own runners for Jest and Vitest have no single-test filter on the
command line. The command test runner takes any command and reads its exit
code, so the plan builds `npx vitest run <file> -t <pattern>` and hands it over.
The cost is one process per mutant. The benefit is that the same code path
works for Vitest, Jest, Mocha and `node --test`.

## D6. The name filter joins titles with `.*`

Jest joins a full test name with a space. Vitest joins it with ` > `. A pattern
of `suite.*case` matches both, so one pattern fits every runner.

## D7. The mutation command is a setting

A workspace may run Stryker through pnpm, through a config file, or not at all.
The built-in command is a default, not a rule: `complexityLens.mutation.commandTemplate`
replaces the whole command line, with `${testCommand}`, `${mutate}` and the
other placeholders filled in.

## D8. A `test` directory above the workspace root means nothing

`isTestFile` reads the path relative to the workspace root when it has one. A
checkout that lives under `/ci/test/repo` would otherwise turn every source
file in it into a test file.

## D9. The count rides a code lens, not the outline

The outline looked like the cheapest surface for the count, and it is closed.
`OutlineModel.create` builds one `OutlineGroup` per registered document symbol
provider and only promotes a group's symbols to the root when exactly one
group is non-empty. A second provider beside the one in the TypeScript
extension therefore does not annotate the outline — it adds a second,
duplicate tree under a provider heading.

A code lens has no such rule: lenses from every provider appear together on
the line. So the count sits above the first line of each function.

The lens carries an empty command id. VS Code renders a lens with a command as
a link, a lens with an empty command id as plain text with a tooltip, and a
lens with no command at all as the placeholder "no commands". A count is a
fact, not an action, and the hover already holds the actions.

Only a counting unit gets a lens, for the reason in D2: the branches of an
anonymous callback are already inside the count of the function that holds it,
so a lens on the callback would report them twice.
