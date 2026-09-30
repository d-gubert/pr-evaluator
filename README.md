# Claude Code session trace

`session-trace.mjs` reads a Claude Code session transcript (`.jsonl`). It writes one HTML page that shows the session step by step. The page uses the layout of the "Claude Code session trace" artifact, with real data instead of a simulation.

The script has no dependencies. It needs Node.js 18 or later.

## Usage

```sh
# The newest session of the current directory
node session-trace.mjs

# A session file or a session ID
node session-trace.mjs ~/.claude/projects/-home-me-app/5690d737-….jsonl
node session-trace.mjs 5690d737-0b97-5806-b338-6ce2108dabab

# Choose the output file, or write to stdout
node session-trace.mjs <session> -o trace.html
node session-trace.mjs <session> --stdout > trace.html
```

The script looks for session files in `~/.claude/projects`. If `CLAUDE_CONFIG_DIR` is set, it looks in `$CLAUDE_CONFIG_DIR/projects`. The default output file is `<session-id>.trace.html` in the current directory.

> **Warning:** The page contains the prompts, the tool inputs, and the tool results of the session. Read the page before you share it.

## The view

The page has the same parts as the artifact:

- A legend with five colors: agent loop, HTTP API request, tool call, hook, and user / UI.
- A timeline track with one cell for each step.
- A list of steps, the Previous, Next, and Play controls, and the arrow keys.
- A "Loop turn" meter and a "Context in messages[]" meter.
- A card for each step with tags, a title, a description, and a code block.

## How the script maps the transcript to steps

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

## Limits

- The page shows only the hooks that Claude Code writes to the transcript. Some versions of Claude Code do not write all hook events.
- The page does not show the turns of subagents. The Agent tool step shows the totals of the subagent: tool calls, tokens, and time.
- The transcript format is not a public API. A new version of Claude Code can change it. The script ignores record types that it does not know.

## Test

```sh
npm test
```

The test uses `test/fixture.jsonl`. The fixture has hooks, a rejected tool call, a PreToolUse block, API errors, a subagent, a compaction, a blocking Stop hook, a slash command, and an interruption.
