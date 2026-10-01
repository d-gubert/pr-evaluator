# session-trace

`session-trace` reads a Claude Code session log (`.jsonl`). It writes one HTML page that shows the session step by step. The page uses the layout of the "Claude Code session trace" artifact, with real data instead of a simulation.

The tool has no dependencies. It needs Node.js 18 or later.

> **Warning:** The page contains the prompts, the tool inputs, and the tool results of the session. These can include secrets, file contents, and private paths. Read the page before you share it.

## Install

Run the tool from the repository:

```sh
node bin/session-trace.js --help
```

Or link it, to get the `session-trace` command:

```sh
npm link
session-trace --help
```

## Usage

```sh
# List the sessions and pick one
session-trace

# Use a session file, a session ID, or the start of an ID
session-trace ~/.claude/projects/-home-me-app/5690d737-0b97-5806-b338-6ce2108dabab.jsonl
session-trace 5690d737-0b97-5806-b338-6ce2108dabab
session-trace 5690d737

# Choose the output file, or write to stdout
session-trace <session> -o out/trace.html
session-trace <session> --stdout > trace.html

# Only list the sessions
session-trace --list
session-trace --list -n 50
```

An ID prefix must have at least 4 characters. If more than one session matches, the tool prints the paths and exits with code 1.

### No session argument

If you give no session, the tool lists the sessions of the profile directory, newest first.

- In a terminal, the tool asks you to pick one. Type a number and press Enter. Press Enter alone to pick 1. Type `q` to quit (exit code 130). After 3 wrong answers, the tool exits with code 2.
- Without a terminal, the tool prints the list and exits with code 2. Pass a session path or ID to avoid this.

## Options

```
usage: session-trace [options] [session]

  session            path to a session log, or a session ID (or a unique ID prefix)
  -o, --output FILE  write the page to FILE
      --stdout       write the page to stdout
  -f, --format ID    log format; default: detect (claude-code)
  -l, --list         list the sessions and exit
  -n, --limit N      number of sessions in the list (default 20)
  -h, --help         show this help
  -v, --version      show the version
```

Rules:

- `-o` and `--stdout` cannot be used together.
- `--list` cannot be used with a session, `-o`, or `--stdout`.
- `-f` selects a format by its ID. Without `-f`, the tool detects the format from the file.
- `-o` does not create directories. The directory of `FILE` must exist.

### Exit codes

| Code | Meaning |
| --- | --- |
| 0 | The tool did its job. |
| 1 | Error: no such session, no sessions found, unknown log format, or a file error. |
| 2 | Usage error, or no session argument without a terminal. |
| 130 | You quit the picker. |

## The profile directory

The tool looks for sessions in the profile directory of Claude Code:

- If `CLAUDE_CONFIG_DIR` is set, the profile directory is `$CLAUDE_CONFIG_DIR`.
- Otherwise, it is `~/.claude`.

The session files are `<profile>/projects/*/*.jsonl`. Set `CLAUDE_CONFIG_DIR` to read the sessions of another profile:

```sh
CLAUDE_CONFIG_DIR=~/.claude-work session-trace --list
```

## Output rules

1. With `--stdout`, the tool writes the page to stdout. It writes no file.
2. With `-o FILE`, the tool writes the page to `FILE`. A relative path starts at the current directory.
3. Otherwise, the tool writes `<session-id>.trace.html` in the current directory. The session ID is the file name without `.jsonl`.

When the tool writes a file, it prints the input path, the output path, and the number of steps and loop turns to stderr.

## The view

The page has these parts:

- A legend with five colors: agent loop, HTTP API request, tool call, hook, and user / UI.
- A timeline track with one cell for each step.
- A list of steps, the Previous, Next, and Play controls, and the arrow keys.
- A "Loop turn" meter and a "Context in messages[]" meter.
- A card for each step with tags, a title, a description, and a code block.

## How the transcript maps to steps

The table shows the Claude Code format. A format module turns these records into the session model. The view then makes the steps.

| Transcript records | Step |
| --- | --- |
| The first record, `SessionStart` hook records | Session starts |
| Attachments before the first request (system prompt, tools, skills, MCP servers, CLAUDE.md) | Build the context |
| A `user` record with prompt text | User sends the prompt |
| All `assistant` records with the same `message.id`, their `tool_result` records, and the `PreToolUse` and `PostToolUse` hooks | Turn N |
| `system` / `api_error` | API error |
| `system` / `compact_boundary`, the compact summary, `PreCompact` hooks | Auto-compact or Compact (manual) |
| `system` / `stop_hook_summary`, `Stop` hooks | Stop hook |
| `<command-name>` and `<bash-input>` prompts | Slash command, shell command |
| `[Request interrupted by user]` | You interrupt the turn |
| An assistant message with the model `<synthetic>` | Claude Code adds a message |
| The last record, `SessionEnd` hooks | Session ends |

The context meter shows `input_tokens + cache_read_input_tokens + cache_creation_input_tokens` of each request. The window is 200k tokens. If the model name contains `[1m]` or a request uses more than 200k tokens, the window is 1M tokens.

## Module layout

```
bin/session-trace.js   entry: builds the real I/O and calls run()
src/cli/               args, run, session picker, session list table
src/sources/           find session files on disk
src/formats/           parse one log file into a Session
src/model.js           the Session model (the contract; types only)
src/view/              Session -> View (the steps)
src/render/            View -> HTML
test/                  node:test tests, golden files, and the fixture
docs/                  the plan, the task files, and the format guide
```

Data flow: `source -> path -> format.parse -> Session -> toView -> renderHtml -> file`.

Only `src/cli/` joins the other modules. A format knows only the model. The view knows only the model. The renderer gets a View.

To support the logs of another harness, add a format module. See [docs/adding-a-format.md](docs/adding-a-format.md).

## Limits

- The page shows only the hooks that Claude Code writes to the transcript. Some versions of Claude Code do not write all hook events.
- The page does not show the turns of subagents. The Agent tool step shows the totals of the subagent: tool calls, tokens, and time.
- The transcript format is not a public API. A new version of Claude Code can change it. The parser ignores record types that it does not know.
- The tool reads sessions from the Claude Code profile directory only. For a log in another place, pass its path.

## Test

```sh
npm test
```

`npm test` runs `node --test`. Node 22 does not accept a directory as an argument. To run some tests, use a glob:

```sh
node --test 'test/e2e/*.test.js'
```

The tests use `test/fixture.jsonl`. The fixture has hooks, a rejected tool call, a PreToolUse block, API errors, a subagent, a compaction, a blocking Stop hook, a slash command, and an interruption. The end-to-end tests run the CLI as a child process. They use a temporary profile and a temporary directory.
