// Type-level tests for the invariants of the model (docs/tasks/T6-typescript.md, 1-10).
//
// A line that must not compile has `// @ts-expect-error` above it. If the
// compiler accepts that line, `npm run typecheck` fails with "Unused
// '@ts-expect-error' directive". So this file proves that the compiler rejects
// the bad value. The `test()` bodies only keep the values alive at run time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type {
  ApiErrorEvent,
  Block,
  BodyEvent,
  CompactionEvent,
  CompactionTrigger,
  ContextEvent,
  Hook,
  HookOutcome,
  IsoTimestamp,
  KnownOutcome,
  NonEmptyReadonly,
  PositiveCount,
  PromptEvent,
  RequestEvent,
  Session,
  SessionEndEvent,
  SessionEvent,
  SessionEvents,
  SessionId,
  SessionStartEvent,
  Timestamp,
  ToolCall,
  ToolUseId,
} from '../../src/model.js';
import { parseToolUseId, toPositiveCount, toSessionId } from '../../src/model.js';
import type { Step, Kind } from '../../src/view/steps.js';
import type { Args, HelpArgs, ListArgs, OutputTarget, TraceArgs, VersionArgs } from '../../src/cli/args.js';
import type { ExitCode, run } from '../../src/cli/run.js';
import type { Format } from '../../src/formats/index.js';
import { formats } from '../../src/formats/index.js';
import { claudeCode } from '../../src/formats/claude-code.js';
import type { SessionSource } from '../../src/sources/index.js';
import { sources } from '../../src/sources/index.js';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

/** Keeps a value used, so that `noUnusedLocals` does not complain about a test value. */
const use = (..._values: unknown[]): void => {};

const start: SessionStartEvent = { type: 'session_start', ts: '', hooks: [] };
const end: SessionEndEvent = { type: 'session_end', ts: '', hooks: [] };
const context: ContextEvent = { type: 'context', ts: '', items: [] };
const prompt: PromptEvent = { type: 'prompt', ts: '', text: 'hi', hooks: [] };

// ---------------------------------------------------------------- 1. the shape of Session.events

test('invariant 1: first session_start, last session_end, one context directly after the start', () => {
  const minimal: SessionEvents = [start, end];
  const withContext: SessionEvents = [start, context, end];
  const withBody: SessionEvents = [start, context, prompt, prompt, end];
  const withoutContext: SessionEvents = [start, prompt, end];
  use(minimal, withContext, withBody, withoutContext);

  // @ts-expect-error an empty list
  const empty: SessionEvents = [];
  // @ts-expect-error no session_end
  const noEnd: SessionEvents = [start];
  // @ts-expect-error no session_end at the end
  const endsWithPrompt: SessionEvents = [start, prompt];
  // @ts-expect-error does not start with session_start
  const noStart: SessionEvents = [prompt, end];
  // @ts-expect-error session_end first
  const reversed: SessionEvents = [end, start];
  // @ts-expect-error a second session_start in the middle
  const twoStarts: SessionEvents = [start, start, end];
  // @ts-expect-error a session_start after a prompt
  const lateStart: SessionEvents = [start, prompt, start, end];
  // @ts-expect-error a session_end in the middle
  const earlyEnd: SessionEvents = [start, prompt, end, end];
  // @ts-expect-error a context event after a prompt
  const lateContext: SessionEvents = [start, prompt, context, end];
  // @ts-expect-error two context events
  const twoContexts: SessionEvents = [start, context, context, end];
  // @ts-expect-error a context event at the end
  const contextLast: SessionEvents = [start, context];
  use(empty, noEnd, endsWithPrompt, noStart, reversed, twoStarts, lateStart, earlyEnd, lateContext, twoContexts, contextLast);

  // The middle holds body events only.
  assert.equal(withBody.length, 5);
});

// ---------------------------------------------------------------- 2. a discriminated union

function kindOf(e: SessionEvent): string {
  switch (e.type) {
    case 'session_start':
    case 'session_end':
      return `${e.type} with ${e.hooks.length} hooks`;
    case 'context':
      return `${e.items.length} items`;
    case 'prompt':
      return e.text;
    case 'command':
      return e.name + e.args + e.output;
    case 'request':
      return e.model + e.tools.length;
    case 'api_error':
      return `${e.count}x ${e.message}`;
    case 'compaction':
      return e.trigger + String(e.preTokens);
    case 'stop_hooks':
      return e.commands.join() + e.reason;
    case 'interrupt':
      return 'interrupt';
    case 'notice':
      return e.text;
    default: {
      // Compiles only while the switch above covers every kind.
      const never: never = e;
      return never;
    }
  }
}

test('invariant 2: SessionEvent is a union on `type`; each kind has its own type', () => {
  // @ts-expect-error a kind that does not exist
  const unknownKind: SessionEvent = { type: 'bogus', ts: '' };
  // @ts-expect-error a field of another kind (api_error has a count, notice has not)
  const wrongField: SessionEvent = { type: 'notice', ts: '', text: '', count: 1 };
  // @ts-expect-error a missing field of the kind
  const missingField: SessionEvent = { type: 'prompt', ts: '', hooks: [] };
  use(unknownKind, wrongField, missingField);

  const readCount = (e: PromptEvent) =>
    // @ts-expect-error a prompt has no count: the kinds are separate types
    e.count;
  use(readCount);

  assert.equal(kindOf(prompt), 'hi');
  assert.equal(kindOf(start), 'session_start with 0 hooks');
});

// ---------------------------------------------------------------- 3. ToolCall: result is null exactly when status is "no result"

test('invariant 3: result is null exactly when status is "no result"', () => {
  const id = parseToolUseId('toolu_1');
  assert.ok(id);
  const base = { id, name: 'Read', input: null, pre: [], post: [], subagent: null };
  const pending: ToolCall = { ...base, status: 'no result', result: null };
  const done: ToolCall = { ...base, status: 'ok', result: { text: 'x', isError: false } };
  const failed: ToolCall = { ...base, status: 'error', result: { text: 'x', isError: true } };
  use(pending, done, failed);

  // @ts-expect-error "no result" with a result
  const pendingWithResult: ToolCall = { ...base, status: 'no result', result: { text: 'x', isError: false } };
  // @ts-expect-error a status with a result of null
  const doneWithoutResult: ToolCall = { ...base, status: 'ok', result: null };
  // @ts-expect-error every other status needs a result
  const rejectedWithoutResult: ToolCall = { ...base, status: 'rejected', result: null };
  use(pendingWithResult, doneWithoutResult, rejectedWithoutResult);

  // Narrowing on the status narrows the result.
  const text = (t: ToolCall): string => (t.status === 'no result' ? 'none' : t.result.text);
  assert.equal(text(pending), 'none');
  assert.equal(text(done), 'x');
});

// ---------------------------------------------------------------- 4. brands and timestamps

test('invariant 4: ToolUseId, SessionId and ISO timestamps are not plain strings', () => {
  // @ts-expect-error a plain string is not a ToolUseId
  const plainToolId: ToolUseId = 'toolu_1';
  // @ts-expect-error a plain string is not a SessionId
  const plainSessionId: SessionId = 'abc';
  const sessionId = toSessionId('abc');
  // @ts-expect-error a SessionId is not a ToolUseId
  const mixedUp: ToolUseId = sessionId;
  // @ts-expect-error a tool_use block refers to a call by ToolUseId, not by a string
  const blockWithString: Block = { type: 'tool_use', toolId: 'toolu_1' };
  use(plainToolId, plainSessionId, mixedUp, blockWithString);

  const toolId = parseToolUseId('toolu_1');
  assert.ok(toolId);
  const block: Block = { type: 'tool_use', toolId };
  const sameId: ToolUseId = toolId;
  use(block, sameId);

  // An unknown time is the explicit member `''`; other strings are rejected.
  const iso: IsoTimestamp = '2026-01-01T10:00:03.000Z';
  const known: Timestamp = '2026-01-01T10:00:03.000Z';
  const unknown: Timestamp = '';
  // @ts-expect-error not an ISO timestamp
  const yesterday: Timestamp = 'yesterday';
  // @ts-expect-error `''` is an unknown time, not an ISO timestamp
  const emptyIso: IsoTimestamp = '';
  // @ts-expect-error an event needs a Timestamp, not a number
  const numberTs: PromptEvent = { ...prompt, ts: 1767261603000 };
  use(iso, known, unknown, yesterday, emptyIso, numberTs);

});

// ---------------------------------------------------------------- 5. api_error.count and compaction.trigger

test('invariant 5: api_error.count is a PositiveCount; compaction.trigger is auto or manual', () => {
  const ok: ApiErrorEvent = { type: 'api_error', ts: '', count: toPositiveCount(2), message: 'overloaded' };
  // @ts-expect-error a plain number is not a PositiveCount (the range is checked by toPositiveCount at run time)
  const plain: ApiErrorEvent = { type: 'api_error', ts: '', count: 0, message: '' };
  // @ts-expect-error a plain number is not a PositiveCount
  const count: PositiveCount = 1;
  use(ok, plain, count);

  const auto: CompactionEvent = { type: 'compaction', ts: '', trigger: 'auto', preTokens: null, summary: '', hooks: [] };
  const manual: CompactionEvent = { ...auto, trigger: 'manual' };
  // @ts-expect-error only auto or manual
  const other: CompactionEvent = { ...auto, trigger: 'sometimes' };
  // @ts-expect-error only auto or manual
  const trigger: CompactionTrigger = 'scheduled';
  use(auto, manual, other, trigger);

});

// ---------------------------------------------------------------- 6. Hook.outcome

test('invariant 6: Hook.outcome is a known outcome or an open string', () => {
  const known: HookOutcome = 'block';
  const open: HookOutcome = 'my-harness-outcome';
  // @ts-expect-error an outcome is a string
  const number: HookOutcome = 42;
  // @ts-expect-error an outcome is a string
  const hook: Hook = { event: 'Stop', name: 'Stop', outcome: null, detail: '', command: '' };
  use(known, open, number, hook);

  // The known words stay in the type (a plain `string` would absorb them, and the editor would stop offering them).
});

// ---------------------------------------------------------------- 7. Step.k

test('invariant 7: Step.k has at least one tag', () => {
  const one: Step['k'] = ['ui'];
  const two: Step['k'] = ['http', 'tool'];
  // @ts-expect-error an empty tag list
  const none: Step['k'] = [];
  // @ts-expect-error not a Kind
  const unknownKind: Step['k'] = ['nope'];
  const kinds: readonly Kind[] = ['loop'];
  // @ts-expect-error a list of unknown length may be empty
  const fromList: Step['k'] = kinds;
  use(one, two, none, unknownKind, fromList);

});

// ---------------------------------------------------------------- 8. CLI arguments

test('invariant 8: CLI arguments are one of four modes', () => {
  const help: Args = { mode: 'help' };
  const version: Args = { mode: 'version' };
  const list: Args = { mode: 'list', limit: 20 };
  const trace: Args = { mode: 'trace', output: { kind: 'default' }, limit: 20 };
  const traceFile: Args = { mode: 'trace', session: 'abcd', output: { kind: 'file', path: 'x.html' }, limit: 20 };
  const traceStdout: Args = { mode: 'trace', session: 'abcd', output: { kind: 'stdout' }, limit: 20 };
  use(help, version, list, trace, traceFile, traceStdout);

  // @ts-expect-error list cannot carry a session
  const listSession: ListArgs = { mode: 'list', limit: 20, session: 'abcd' };
  // @ts-expect-error list cannot carry an output target
  const listOutput: ListArgs = { mode: 'list', limit: 20, output: { kind: 'stdout' } };
  // @ts-expect-error -o together with --stdout has no representation
  const both: TraceArgs = { mode: 'trace', output: { kind: 'stdout', path: 'x.html' }, limit: 20 };
  // @ts-expect-error a file target needs a path
  const noPath: OutputTarget = { kind: 'file' };
  // @ts-expect-error a stdout target has no path
  const stdoutPath: OutputTarget = { kind: 'stdout', path: 'x.html' };
  // @ts-expect-error a trace has an output target
  const noOutput: TraceArgs = { mode: 'trace', limit: 20 };
  // @ts-expect-error help carries nothing
  const helpLimit: HelpArgs = { mode: 'help', limit: 20 };
  // @ts-expect-error version carries nothing
  const versionSession: VersionArgs = { mode: 'version', session: 'abcd' };
  // @ts-expect-error not a mode
  const otherMode: Args = { mode: 'watch' };
  use(listSession, listOutput, both, noPath, stdoutPath, noOutput, helpLimit, versionSession, otherMode);

  const sessionOf = (a: Args): string | undefined => {
    if (a.mode === 'trace') return a.session;
    // @ts-expect-error after the narrowing, a list has no session
    if (a.mode === 'list') return a.session;
    return undefined;
  };
  assert.equal(sessionOf(traceFile), 'abcd');
  assert.equal(sessionOf(list), undefined);
});

// ---------------------------------------------------------------- 9. exit codes

test('invariant 9: exit codes are 0, 1, 2 or 130', () => {
  const codes: ExitCode[] = [0, 1, 2, 130];
  // @ts-expect-error not an exit code of this tool
  const three: ExitCode = 3;
  // @ts-expect-error not an exit code of this tool
  const failure: ExitCode = 127;
  use(codes, three, failure);

  assert.equal(codes.length, 4);
});

// ---------------------------------------------------------------- 10. the registries

test('invariant 10: the registries are non-empty readonly tuples', () => {
  // @ts-expect-error a registry has at least one format
  const noFormats: typeof formats = [];
  // @ts-expect-error a registry has at least one source
  const noSources: typeof sources = [];
  // @ts-expect-error a readonly tuple has no push
  formats.push(claudeCode);
  // @ts-expect-error a readonly tuple cannot be assigned to
  formats[0] = claudeCode;
  // @ts-expect-error a readonly tuple has no push
  sources.push(sources[0]);
  use(noFormats, noSources);

  // A non-empty tuple makes the first element certain: no `| undefined`.
  const first: Format = formats[0];
  assert.equal(first.id, 'claude-code');
});

// ---------------------------------------------------------------- the model is readonly

test('the model data is readonly', () => {
  const session = (s: Session, h: Hook, r: RequestEvent) => {
    // @ts-expect-error meta is readonly
    s.meta.cwd = '/x';
    // @ts-expect-error events are readonly
    s.events.push(end);
    // @ts-expect-error a hook is readonly
    h.detail = '';
    // @ts-expect-error the list of tools is readonly
    r.tools.push();
    // @ts-expect-error the list of blocks is readonly
    r.blocks.length = 0;
    // @ts-expect-error the list of models is readonly
    s.meta.models.push('m');
  };
  use(session);
});

// ---------------------------------------------------------------- type equalities
// `Expect<Equal<A, B>>` is a compile error when A and B differ.

export type _Body = Expect<Equal<BodyEvent['type'], Exclude<SessionEvent['type'], 'session_start' | 'session_end' | 'context'>>>;
export type _Events = Expect<Equal<Session['events'], SessionEvents>>;
export type _Named = Expect<Equal<Extract<SessionEvent, { type: 'request' }>, RequestEvent>>;
export type _Named2 = Expect<Equal<Extract<SessionEvent, { type: 'api_error' }>, ApiErrorEvent>>;
export type _Ts = Expect<Equal<Timestamp, IsoTimestamp | ''>>;
export type _Trigger = Expect<Equal<CompactionTrigger, 'auto' | 'manual'>>;
export type _KeepsLiteral = Expect<Equal<Extract<HookOutcome, 'ok'>, 'ok'>>;
export type _OnlyKnown = Expect<Equal<Extract<HookOutcome, 'nope'>, never>>;
export type _Known = Expect<Equal<KnownOutcome, 'ok' | 'run' | 'block' | 'error' | 'cancelled' | 'stop' | 'context added'>>;
export type _K = Expect<Equal<Step['k'], readonly [Kind, ...Kind[]]>>;
export type _Union = Expect<Equal<ExitCode, 0 | 1 | 2 | 130>>;
export type _Run = Expect<Equal<Awaited<ReturnType<typeof run>>, ExitCode>>;
export type _Formats = Expect<Equal<typeof formats, NonEmptyReadonly<Format>>>;
export type _Sources = Expect<Equal<typeof sources, readonly [SessionSource, ...SessionSource[]]>>;
