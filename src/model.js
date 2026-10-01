// The harness-neutral session model.
//
// This file is the contract between the layers:
//
//   source (find files)  →  format (parse one file)  →  Session  →  view (steps)  →  render (HTML)
//
// A format module turns the log of one harness into a Session. The view knows
// only this model, never a log format. To support a new harness, write a new
// format module that returns a Session; the view and the renderer do not change.
//
// This file has types only. It exports nothing at runtime.

/**
 * @typedef {object} Session
 * @property {SessionMeta} meta
 * @property {SessionEvent[]} events  In transcript order. The first event is
 *   always `session_start` and the last is always `session_end`.
 */

/**
 * @typedef {object} SessionMeta
 * @property {string} harness       Format id, for example "claude-code".
 * @property {string} harnessName   Display name, for example "Claude Code".
 * @property {string} file          Base name of the log file.
 * @property {string} sessionId
 * @property {string} cwd           Empty string when unknown.
 * @property {string} gitBranch     The last branch the log records. Empty when unknown.
 * @property {string} version       Harness version. Empty when unknown.
 * @property {string} entrypoint    For example "cli" or "remote". Empty when unknown.
 * @property {string[]} models      Distinct model ids of the requests, in order of first use.
 * @property {string} firstPrompt   Full text of the first user prompt. Empty when none.
 * @property {string} startedAt     ISO timestamp of the first record. Empty when unknown.
 * @property {string} endedAt       ISO timestamp of the last record. Empty when unknown.
 * @property {number|null} contextWindow  Tokens. Null lets the view choose.
 */

/**
 * One hook run. `detail` is the raw text (not clipped).
 * @typedef {object} Hook
 * @property {string} event    For example "PreToolUse", "Stop", "SessionStart".
 * @property {string} name     For example "PreToolUse:Bash". Equal to `event` when the log has no name.
 * @property {string} outcome  "ok" | "run" | "block" | "error" | "cancelled" | "stop" | "context added" | a harness word.
 * @property {string} detail   Output or reason. Empty string when none.
 * @property {string} command  Shell command of the hook. Empty string when unknown.
 */

/**
 * Token counts of one request. Missing counts are 0.
 * @typedef {object} Usage
 * @property {number} input       Uncached input tokens.
 * @property {number} cacheRead
 * @property {number} cacheWrite
 * @property {number} output
 * @property {number|null} thinking  Thinking tokens inside `output`, when the log has them.
 */

/**
 * @typedef {'ok'|'error'|'rejected'|'interrupted'|'no result'} ToolStatus
 */

/**
 * @typedef {object} ToolCall
 * @property {string} id
 * @property {string} name
 * @property {any} input
 * @property {Hook[]} pre    Hooks that run before the tool (PreToolUse, PermissionRequest).
 * @property {Hook[]} post   Hooks that run after the tool.
 * @property {{text: string, isError: boolean}|null} result  `text` is the full result text;
 *   an image adds the line "[image]".
 * @property {ToolStatus} status
 * @property {{toolCalls: number, tokens: number, durationMs: number|null}|null} subagent
 *   Totals when the tool ran a subagent.
 */

/**
 * @typedef {{type: 'thinking', text: string}
 *   | {type: 'redacted_thinking'}
 *   | {type: 'text', text: string}
 *   | {type: 'tool_use', toolId: string}
 *   | {type: 'server_tool_use', name: string, input: any}} Block
 * A `tool_use` block points to the ToolCall with the same id in `request.tools`.
 */

/**
 * @typedef {{type: 'session_start', ts: string, hooks: Hook[]}
 *   | {type: 'context', ts: string, items: string[]}
 *   | {type: 'prompt', ts: string, text: string, hooks: Hook[]}
 *   | {type: 'command', ts: string, name: string, args: string, output: string, hooks: Hook[]}
 *   | {type: 'request', ts: string, model: string, usage: Usage|null, stopReason: string,
 *       blocks: Block[], tools: ToolCall[], hooks: Hook[]}
 *   | {type: 'api_error', ts: string, count: number, message: string}
 *   | {type: 'compaction', ts: string, trigger: 'auto'|'manual', preTokens: number|null,
 *       summary: string, hooks: Hook[]}
 *   | {type: 'stop_hooks', ts: string, hooks: Hook[], commands: string[], errors: string[],
 *       prevented: boolean, reason: string}
 *   | {type: 'interrupt', ts: string}
 *   | {type: 'notice', ts: string, text: string}
 *   | {type: 'session_end', ts: string, hooks: Hook[]}} SessionEvent
 *
 * Notes:
 * - `context`: one line per item the harness loads before the first request
 *   (system prompt size, tools, skills, MCP servers, memory files). At most one
 *   `context` event, directly after `session_start`.
 * - `command`: a local command of the user. `name` is "/cost" for a slash
 *   command and "!" for a shell command. `output` is "" when none.
 * - `request`: one model API request. `stopReason` is "" when unknown.
 * - `api_error`: consecutive errors merge into one event with a `count`.
 * - `stop_hooks`: the hooks that run when the agent loop exits. `commands` lists
 *   the hook commands when the log has no per-hook records.
 * - `notice`: a message the harness writes itself, with no API request.
 */

export {};
