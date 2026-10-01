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
// This file holds the types of the model and the few functions that make a value
// of a branded type (the "mint" functions at the end). A format may import them.
// Nothing else in this file runs at run time.
//
// The model data is `readonly`: a format builds its own mutable drafts and
// returns the finished, read-only Session.
//
// Invariants. Where the compiler enforces an invariant, the comment says so.
// Where TypeScript cannot express it, the comment names the run-time check.

// ---------------------------------------------------------------- branded values

declare const brand: unique symbol;

/** A nominal type: `Brand<string, 'X'>` is a string that the compiler does not mix with other strings. */
type Brand<T, Name extends string> = T & { readonly [brand]: Name };

/** Id of a session. The empty string means that the log has none. Make one with `toSessionId`. */
export type SessionId = Brand<string, 'SessionId'>;

/** Id of one tool call (`tool_use`). Not empty. Make one with `parseToolUseId`. */
export type ToolUseId = Brand<string, 'ToolUseId'>;

/** An ISO 8601 timestamp, for example "2026-01-01T10:00:03.000Z". Make one with `parseTimestamp`. */
export type IsoTimestamp = `${number}-${number}-${number}T${string}`;

/** A time that can be unknown: an ISO timestamp, or `''` when the log has no time. */
export type Timestamp = IsoTimestamp | '';

/**
 * A count of 1 or more.
 * TypeScript cannot express a number range, so the compiler only enforces that a
 * plain `number` does not go here. `toPositiveCount` checks the range at run time.
 */
export type PositiveCount = Brand<number, 'PositiveCount'>;

// ---------------------------------------------------------------- session

/** Non-empty readonly array. */
export type NonEmptyReadonly<T> = readonly [T, ...T[]];

/** One session. The rules for `events` are in {@link SessionEvents}. */
export type Session = {
  readonly meta: SessionMeta;
  readonly events: SessionEvents;
};

export type SessionMeta = {
  /** Format id, for example "claude-code". */
  readonly harness: string;
  /** Display name, for example "Claude Code". */
  readonly harnessName: string;
  /** Base name of the log file. */
  readonly file: string;
  readonly sessionId: SessionId;
  /** Empty string when unknown. */
  readonly cwd: string;
  /** The last branch the log records. Empty when unknown. */
  readonly gitBranch: string;
  /** Harness version. Empty when unknown. */
  readonly version: string;
  /** For example "cli" or "remote". Empty when unknown. */
  readonly entrypoint: string;
  /** Distinct model ids of the requests, in order of first use. */
  readonly models: readonly string[];
  /** Full text of the first user prompt. Empty when none. */
  readonly firstPrompt: string;
  /** Time of the first record. `''` when unknown. */
  readonly startedAt: Timestamp;
  /** Time of the last record. `''` when unknown. */
  readonly endedAt: Timestamp;
  /** Tokens. Null lets the view choose. */
  readonly contextWindow: number | null;
};

/**
 * The events of a session, in transcript order. Invariant 1, enforced by the compiler:
 *
 * - the first event is `session_start`, and the last is `session_end`;
 * - neither occurs anywhere else (the middle holds `BodyEvent` only);
 * - at most one `context` event, and only directly after `session_start`.
 *
 * A session has at least two events.
 */
export type SessionEvents =
  | readonly [SessionStartEvent, ...BodyEvent[], SessionEndEvent]
  | readonly [SessionStartEvent, ContextEvent, ...BodyEvent[], SessionEndEvent];

// ---------------------------------------------------------------- hooks, usage, tools

/** The outcomes that the model knows. */
export type KnownOutcome = 'ok' | 'run' | 'block' | 'error' | 'cancelled' | 'stop' | 'context added';

/**
 * The outcome of a hook: a known word, or an open word of another harness
 * (invariant 6). `string & {}` keeps the known words in the type, so an editor
 * still offers them. A plain `string` would absorb them.
 */
export type HookOutcome = KnownOutcome | (string & {});

/** One hook run. `detail` is the raw text (not clipped). */
export type Hook = {
  /** For example "PreToolUse", "Stop", "SessionStart". */
  readonly event: string;
  /** For example "PreToolUse:Bash". Equal to `event` when the log has no name. */
  readonly name: string;
  readonly outcome: HookOutcome;
  /** Output or reason. Empty string when none. */
  readonly detail: string;
  /** Shell command of the hook. Empty string when unknown. */
  readonly command: string;
};

/** Token counts of one request. Missing counts are 0. */
export type Usage = {
  /** Uncached input tokens. */
  readonly input: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly output: number;
  /** Thinking tokens inside `output`, when the log has them. */
  readonly thinking: number | null;
};

export type ToolStatus = 'ok' | 'error' | 'rejected' | 'interrupted' | 'no result';

/** `text` is the full result text; an image adds the line "[image]". */
export type ToolResult = {
  readonly text: string;
  readonly isError: boolean;
};

/** Totals when the tool ran a subagent. */
export type SubagentTotals = {
  readonly toolCalls: number;
  readonly tokens: number;
  readonly durationMs: number | null;
};

type ToolCallBase = {
  readonly id: ToolUseId;
  readonly name: string;
  /** The raw input of the tool. The JSON boundary: narrow it before use. */
  readonly input: unknown;
  /** Hooks that run before the tool (PreToolUse, PermissionRequest). */
  readonly pre: readonly Hook[];
  /** Hooks that run after the tool. */
  readonly post: readonly Hook[];
  readonly subagent: SubagentTotals | null;
};

/** A tool call that has no result yet. */
export type PendingToolCall = ToolCallBase & {
  readonly status: 'no result';
  readonly result: null;
};

/** A tool call with a result. */
export type FinishedToolCall = ToolCallBase & {
  readonly status: Exclude<ToolStatus, 'no result'>;
  readonly result: ToolResult;
};

/**
 * Invariant 3, enforced by the compiler: `result` is `null` exactly when
 * `status` is `'no result'`.
 */
export type ToolCall = PendingToolCall | FinishedToolCall;

// ---------------------------------------------------------------- blocks

export type ThinkingBlock = { readonly type: 'thinking'; readonly text: string };
export type RedactedThinkingBlock = { readonly type: 'redacted_thinking' };
export type TextBlock = { readonly type: 'text'; readonly text: string };

/**
 * Points to the `ToolCall` with the same id in `request.tools` (invariant 4).
 * The compiler enforces that the id is a `ToolUseId`. It cannot check that a
 * call with this id exists in the same request: `test/model/invariants.test.ts`
 * checks that.
 */
export type ToolUseBlock = { readonly type: 'tool_use'; readonly toolId: ToolUseId };

export type ServerToolUseBlock = {
  readonly type: 'server_tool_use';
  readonly name: string;
  /** The raw input of the tool. The JSON boundary: narrow it before use. */
  readonly input: unknown;
};

export type Block = ThinkingBlock | RedactedThinkingBlock | TextBlock | ToolUseBlock | ServerToolUseBlock;

// ---------------------------------------------------------------- events

/** The harness starts. */
export type SessionStartEvent = {
  readonly type: 'session_start';
  readonly ts: Timestamp;
  readonly hooks: readonly Hook[];
};

/**
 * One line per item the harness loads before the first request (system prompt
 * size, tools, skills, MCP servers, memory files). At most one, directly after
 * `session_start` (see `SessionEvents`).
 */
export type ContextEvent = {
  readonly type: 'context';
  readonly ts: Timestamp;
  readonly items: readonly string[];
};

export type PromptEvent = {
  readonly type: 'prompt';
  readonly ts: Timestamp;
  readonly text: string;
  readonly hooks: readonly Hook[];
};

/** A local command of the user. `name` is "/cost" for a slash command and "!" for a shell command. */
export type CommandEvent = {
  readonly type: 'command';
  readonly ts: Timestamp;
  readonly name: string;
  readonly args: string;
  /** "" when none. */
  readonly output: string;
  readonly hooks: readonly Hook[];
};

/** One model API request. `stopReason` is "" when unknown. */
export type RequestEvent = {
  readonly type: 'request';
  readonly ts: Timestamp;
  readonly model: string;
  readonly usage: Usage | null;
  readonly stopReason: string;
  readonly blocks: readonly Block[];
  readonly tools: readonly ToolCall[];
  readonly hooks: readonly Hook[];
};

/** Consecutive errors merge into one event with a `count` (invariant 5). */
export type ApiErrorEvent = {
  readonly type: 'api_error';
  readonly ts: Timestamp;
  /** 1 or more. See `PositiveCount`. */
  readonly count: PositiveCount;
  readonly message: string;
};

export type CompactionTrigger = 'auto' | 'manual';

export type CompactionEvent = {
  readonly type: 'compaction';
  readonly ts: Timestamp;
  readonly trigger: CompactionTrigger;
  readonly preTokens: number | null;
  readonly summary: string;
  readonly hooks: readonly Hook[];
};

/**
 * The hooks that run when the agent loop exits. `commands` lists the hook
 * commands when the log has no per-hook records.
 */
export type StopHooksEvent = {
  readonly type: 'stop_hooks';
  readonly ts: Timestamp;
  readonly hooks: readonly Hook[];
  readonly commands: readonly string[];
  readonly errors: readonly string[];
  readonly prevented: boolean;
  readonly reason: string;
};

export type InterruptEvent = {
  readonly type: 'interrupt';
  readonly ts: Timestamp;
};

/** A message the harness writes itself, with no API request. */
export type NoticeEvent = {
  readonly type: 'notice';
  readonly ts: Timestamp;
  readonly text: string;
};

/** The transcript ends. */
export type SessionEndEvent = {
  readonly type: 'session_end';
  readonly ts: Timestamp;
  readonly hooks: readonly Hook[];
};

/** Invariant 2: a discriminated union on `type`. Each kind is a named type. */
export type SessionEvent =
  | SessionStartEvent
  | ContextEvent
  | PromptEvent
  | CommandEvent
  | RequestEvent
  | ApiErrorEvent
  | CompactionEvent
  | StopHooksEvent
  | InterruptEvent
  | NoticeEvent
  | SessionEndEvent;

/** The events that can stand between `session_start` (or `context`) and `session_end`. */
export type BodyEvent = Exclude<SessionEvent, SessionStartEvent | ContextEvent | SessionEndEvent>;

// ---------------------------------------------------------------- mint functions

// A brand has no run-time form, so the compiler cannot check it. Each brand has
// one type guard that checks the value at run time, and the mint function uses
// that guard. No brand is made with a cast. Make a branded value here, nowhere else.

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/;

const isSessionId = (value: unknown): value is SessionId => typeof value === 'string';
const isToolUseId = (value: unknown): value is ToolUseId => typeof value === 'string' && value !== '';
const isIsoTimestamp = (value: unknown): value is IsoTimestamp => typeof value === 'string' && ISO_TIMESTAMP.test(value);
const isPositiveCount = (value: unknown): value is PositiveCount => typeof value === 'number' && Number.isInteger(value) && value >= 1;

/** Every string is a session id; `''` means unknown. */
export function toSessionId(value: string): SessionId {
  if (!isSessionId(value)) throw new TypeError('a session id is a string');
  return value;
}

/** The tool id, or `null` when `value` is not a non-empty string. */
export function parseToolUseId(value: unknown): ToolUseId | null {
  return isToolUseId(value) ? value : null;
}

/** The timestamp, or `''` (unknown) when `value` is not an ISO 8601 date-time string. */
export function parseTimestamp(value: unknown): Timestamp {
  return isIsoTimestamp(value) ? value : '';
}

/** @throws {RangeError} when `value` is not an integer of 1 or more. */
export function toPositiveCount(value: number): PositiveCount {
  if (!isPositiveCount(value)) throw new RangeError(`count must be an integer of 1 or more, got ${value}`);
  return value;
}
