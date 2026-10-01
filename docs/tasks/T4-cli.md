# T4: CLI — args, picker, run

Read `docs/plan.md` first. T1, T2, and T3 are done: use `src/formats/index.js`,
`src/view/steps.js`, `src/render/html.js`, and `src/sources/index.js`. Read their exports
before you start. Do not change those modules; if one has a bug, stop and report it.

## Scope

Files you create (and no others):

- `src/cli/args.js`   `parseArgs(argv)` and `UsageError`
- `src/cli/list.js`   `formatSessionList(sessions, {columns, now})` → string
- `src/cli/pick.js`   `pickSession(sessions, io)` → `Promise<SessionInfo|null>`
- `src/cli/run.js`    `run(argv, io)` → `Promise<number>` (exit code)
- `bin/session-trace.js`  `#!/usr/bin/env node`; builds the real `io`; sets `process.exitCode`
- `test/cli/args.test.js`, `test/cli/list.test.js`, `test/cli/run.test.js`

## Command line

```
session-trace [options] [session]

  session            path to a session log, or a session ID (or a unique ID prefix)
  -o, --output FILE  write the page to FILE
      --stdout       write the page to stdout
  -f, --format ID    log format; default: detect (ids from src/formats)
  -l, --list         list the sessions and exit
  -n, --limit N      number of sessions in the list (default 20)
  -h, --help         show this help
  -v, --version      show the version (from package.json)
```

`-o` with `--stdout` is a usage error. An unknown option is a usage error. A usage error
prints the message and `Try "session-trace --help".` to stderr and returns 2.

## Behavior of `run`

`io` = `{ env, home, cwd, stdin, stdout, stderr, interactive, columns }`. `run` reads files
with `node:fs` but takes every path relative to `io.cwd`. It never reads `process.*`.

1. Session given:
   - It is an existing file → use it.
   - Else resolve it as an ID with each source (`source.resolve(source.root(env, home), arg)`).
   - Else print `session-trace: no session file or ID "<arg>"` and return 1.
   - `AmbiguousSessionError` → print the candidate paths and return 1.
2. No session, `--list` → print `formatSessionList` of the sessions to stdout, return 0.
3. No session, `io.interactive` → print the list to stderr, then `pickSession`. Input:
   a number picks; an empty line picks 1; `q` or end of input returns null → return 130 with no output.
   A wrong answer asks again (at most 3 times, then return 2).
4. No session, not interactive → print the list to stdout, print
   `session-trace: pass a session path or ID` to stderr, return 2.
5. No sessions found → print `session-trace: no sessions in <root>/projects` to stderr, return 1.
6. Trace: read the file, `parseSession(text, {file: basename, format})`, `toView`, `renderHtml`.
   Output rules (same as the old script):
   - `--stdout` → write the HTML to stdout.
   - `-o FILE` → write to `resolve(io.cwd, FILE)`.
   - Else write `<file name without .jsonl>.trace.html` in `io.cwd`.
   Then print to stderr: `<input path>\n→ <output path>  (<n> steps, <m> loop turns)`.
   `UnknownFormatError` → print its message and return 1.

`formatSessionList`: one line per session: index, `YYYY-MM-DD HH:MM` (local time),
project, and the first prompt on one line, clipped so the line fits `columns` (default 100).
A session with no prompt shows `(no prompt)`.

## Definition of done

1. `args.test.js` covers every option, the session argument, `-o`+`--stdout`, an unknown
   option, `-n` with a bad number.
2. `run.test.js` uses a temporary profile (`CLAUDE_CONFIG_DIR` in `io.env`) with a copy of
   `test/fixture.jsonl`, fake streams, and covers rules 1–6: path, ID, ID prefix, unknown
   ID, `--list`, interactive pick by number, empty line, `q`, a wrong answer then a number,
   non-interactive no-arg (exit 2), empty profile, `-o`, `--stdout`, default output name,
   `--format claude-code`, `--format nope` (exit 2).
3. The page from `run` for the fixture holds the same steps as
   `test/golden/fixture.steps.json` (parse the JSON of the data block in the HTML).
4. `node bin/session-trace.js --list` runs against the real profile and exits 0.
5. `node --test 'test/cli/*.test.js'` passes, and `node --test` (no arguments) passes.
6. `src/cli/run.js` is the only module that imports more than one layer.
