// A decoder for a Session that comes from JSON (the golden file): it checks the
// shape of the value and returns it typed. If the data breaks the model, it
// throws an error with the path of the first mismatch.
//
// It checks at run time what the types check at compile time, so the golden file
// is proof that the model fits real data. It does not use a type cast.
import {
  parseTimestamp,
  parseToolUseId,
  toPositiveCount,
  toSessionId,
  type Block,
  type BodyEvent,
  type ContextEvent,
  type Hook,
  type Session,
  type SessionEvent,
  type SessionEvents,
  type SessionMeta,
  type SubagentTotals,
  type Timestamp,
  type ToolCall,
  type ToolResult,
  type ToolStatus,
  type Usage,
} from '../../src/model.js';

type Rec = { readonly [key: string]: unknown };

function bad(path: string, expected: string): never {
  throw new Error(`${path}: expected ${expected}`);
}

const isRec = (x: unknown): x is Rec => typeof x === 'object' && x !== null && !Array.isArray(x);

/** The object `x`. It has no key outside `keys`. */
function rec(x: unknown, path: string, keys: readonly string[]): Rec {
  if (!isRec(x)) return bad(path, 'an object');
  for (const k of Object.keys(x)) if (!keys.includes(k)) bad(`${path}.${k}`, `no such key (known: ${keys.join(', ')})`);
  return x;
}
const string = (x: unknown, path: string): string => (typeof x === 'string' ? x : bad(path, 'a string'));
const boolean = (x: unknown, path: string): boolean => (typeof x === 'boolean' ? x : bad(path, 'a boolean'));
const number = (x: unknown, path: string): number => (typeof x === 'number' ? x : bad(path, 'a number'));
const nullable = <T>(x: unknown, path: string, f: (x: unknown, path: string) => T): T | null => (x === null ? null : f(x, path));
const array = <T>(x: unknown, path: string, f: (x: unknown, path: string) => T): T[] =>
  Array.isArray(x) ? x.map((v: unknown, i) => f(v, `${path}[${i}]`)) : bad(path, 'an array');

function timestamp(x: unknown, path: string): Timestamp {
  const s = string(x, path);
  const ts = parseTimestamp(s);
  return s === '' || ts !== '' ? ts : bad(path, 'an ISO timestamp or ""');
}

function oneOf<T extends string>(x: unknown, path: string, allowed: readonly T[]): T {
  const s = string(x, path);
  const hit = allowed.find((a) => a === s);
  return hit ?? bad(path, `one of ${allowed.join(', ')}`);
}

const hook = (x: unknown, path: string): Hook => {
  const r = rec(x, path, ['event', 'name', 'outcome', 'detail', 'command']);
  return {
    event: string(r.event, `${path}.event`),
    name: string(r.name, `${path}.name`),
    outcome: string(r.outcome, `${path}.outcome`),
    detail: string(r.detail, `${path}.detail`),
    command: string(r.command, `${path}.command`),
  };
};
const hooks = (x: unknown, path: string): Hook[] => array(x, path, hook);

const usage = (x: unknown, path: string): Usage => {
  const r = rec(x, path, ['input', 'cacheRead', 'cacheWrite', 'output', 'thinking']);
  return {
    input: number(r.input, `${path}.input`),
    cacheRead: number(r.cacheRead, `${path}.cacheRead`),
    cacheWrite: number(r.cacheWrite, `${path}.cacheWrite`),
    output: number(r.output, `${path}.output`),
    thinking: nullable(r.thinking, `${path}.thinking`, number),
  };
};

const TOOL_STATUS: readonly ToolStatus[] = ['ok', 'error', 'rejected', 'interrupted', 'no result'];

function toolCall(x: unknown, path: string): ToolCall {
  const r = rec(x, path, ['id', 'name', 'input', 'pre', 'post', 'result', 'status', 'subagent']);
  const id = parseToolUseId(r.id) ?? bad(`${path}.id`, 'a non-empty string');
  const base = {
    id,
    name: string(r.name, `${path}.name`),
    input: r.input,
    pre: hooks(r.pre, `${path}.pre`),
    post: hooks(r.post, `${path}.post`),
    subagent: nullable<SubagentTotals>(r.subagent, `${path}.subagent`, (s, p) => {
      const o = rec(s, p, ['toolCalls', 'tokens', 'durationMs']);
      return { toolCalls: number(o.toolCalls, `${p}.toolCalls`), tokens: number(o.tokens, `${p}.tokens`), durationMs: nullable(o.durationMs, `${p}.durationMs`, number) };
    }),
  };
  const status = oneOf(r.status, `${path}.status`, TOOL_STATUS);
  const result = nullable<ToolResult>(r.result, `${path}.result`, (v, p) => {
    const o = rec(v, p, ['text', 'isError']);
    return { text: string(o.text, `${p}.text`), isError: boolean(o.isError, `${p}.isError`) };
  });
  // Invariant 3: the result is null exactly when the status is "no result".
  if (status === 'no result') return result === null ? { ...base, status, result } : bad(`${path}.result`, 'null, because the status is "no result"');
  return result === null ? bad(`${path}.result`, `an object, because the status is "${status}"`) : { ...base, status, result };
}

function block(x: unknown, path: string): Block {
  const r = rec(x, path, ['type', 'text', 'toolId', 'name', 'input']);
  const type = oneOf(r.type, `${path}.type`, ['thinking', 'redacted_thinking', 'text', 'tool_use', 'server_tool_use']);
  const only = (...keys: string[]): void => {
    for (const k of Object.keys(r)) if (k !== 'type' && !keys.includes(k)) bad(`${path}.${k}`, `no such key in a ${type} block`);
  };
  switch (type) {
    case 'thinking':
    case 'text':
      only('text');
      return { type, text: string(r.text, `${path}.text`) };
    case 'redacted_thinking':
      only();
      return { type };
    case 'tool_use':
      only('toolId');
      return { type, toolId: parseToolUseId(r.toolId) ?? bad(`${path}.toolId`, 'a non-empty string') };
    case 'server_tool_use':
      only('name', 'input');
      return { type, name: string(r.name, `${path}.name`), input: r.input };
  }
}

const EVENT_TYPES = ['session_start', 'context', 'prompt', 'command', 'request', 'api_error', 'compaction', 'stop_hooks', 'interrupt', 'notice', 'session_end'] as const;

// A Record over the union: the compiler checks that every event kind has its keys.
const EVENT_KEYS: Readonly<Record<SessionEvent['type'], readonly string[]>> = {
  session_start: ['type', 'ts', 'hooks'],
  context: ['type', 'ts', 'items'],
  prompt: ['type', 'ts', 'text', 'hooks'],
  command: ['type', 'ts', 'name', 'args', 'output', 'hooks'],
  request: ['type', 'ts', 'model', 'usage', 'stopReason', 'blocks', 'tools', 'hooks'],
  api_error: ['type', 'ts', 'count', 'message'],
  compaction: ['type', 'ts', 'trigger', 'preTokens', 'summary', 'hooks'],
  stop_hooks: ['type', 'ts', 'hooks', 'commands', 'errors', 'prevented', 'reason'],
  interrupt: ['type', 'ts'],
  notice: ['type', 'ts', 'text'],
  session_end: ['type', 'ts', 'hooks'],
};

function event(x: unknown, path: string): SessionEvent {
  const type = oneOf(isRec(x) ? x.type : undefined, `${path}.type`, EVENT_TYPES);
  const r = rec(x, path, EVENT_KEYS[type]);
  const ts = timestamp(r.ts, `${path}.ts`);
  switch (type) {
    case 'session_start':
    case 'session_end':
      return { type, ts, hooks: hooks(r.hooks, `${path}.hooks`) };
    case 'context':
      return { type, ts, items: array(r.items, `${path}.items`, string) };
    case 'prompt':
      return { type, ts, text: string(r.text, `${path}.text`), hooks: hooks(r.hooks, `${path}.hooks`) };
    case 'command':
      return {
        type,
        ts,
        name: string(r.name, `${path}.name`),
        args: string(r.args, `${path}.args`),
        output: string(r.output, `${path}.output`),
        hooks: hooks(r.hooks, `${path}.hooks`),
      };
    case 'request':
      return {
        type,
        ts,
        model: string(r.model, `${path}.model`),
        usage: nullable(r.usage, `${path}.usage`, usage),
        stopReason: string(r.stopReason, `${path}.stopReason`),
        blocks: array(r.blocks, `${path}.blocks`, block),
        tools: array(r.tools, `${path}.tools`, toolCall),
        hooks: hooks(r.hooks, `${path}.hooks`),
      };
    case 'api_error':
      return { type, ts, count: toPositiveCount(number(r.count, `${path}.count`)), message: string(r.message, `${path}.message`) };
    case 'compaction':
      return {
        type,
        ts,
        trigger: oneOf(r.trigger, `${path}.trigger`, ['auto', 'manual']),
        preTokens: nullable(r.preTokens, `${path}.preTokens`, number),
        summary: string(r.summary, `${path}.summary`),
        hooks: hooks(r.hooks, `${path}.hooks`),
      };
    case 'stop_hooks':
      return {
        type,
        ts,
        hooks: hooks(r.hooks, `${path}.hooks`),
        commands: array(r.commands, `${path}.commands`, string),
        errors: array(r.errors, `${path}.errors`, string),
        prevented: boolean(r.prevented, `${path}.prevented`),
        reason: string(r.reason, `${path}.reason`),
      };
    case 'interrupt':
      return { type, ts };
    case 'notice':
      return { type, ts, text: string(r.text, `${path}.text`) };
  }
}

const isBody = (e: SessionEvent): e is BodyEvent => e.type !== 'session_start' && e.type !== 'session_end' && e.type !== 'context';

/** Invariant 1: the shape of the event list. */
function eventList(list: readonly SessionEvent[], path: string): SessionEvents {
  const first = list[0];
  const last = list[list.length - 1];
  if (list.length < 2 || first?.type !== 'session_start') return bad(`${path}[0]`, 'session_start');
  if (last?.type !== 'session_end') return bad(`${path}[${list.length - 1}]`, 'session_end');
  const second = list[1];
  const context: ContextEvent | undefined = second?.type === 'context' ? second : undefined;
  const bodyFrom = context ? 2 : 1;
  const body = list.slice(bodyFrom, -1).map((e, i) => (isBody(e) ? e : bad(`${path}[${i + bodyFrom}]`, `an event between the start and the end, not ${e.type}`)));
  return context ? [first, context, ...body, last] : [first, ...body, last];
}

function meta(x: unknown, path: string): SessionMeta {
  const r = rec(x, path, ['harness', 'harnessName', 'file', 'sessionId', 'cwd', 'gitBranch', 'version', 'entrypoint', 'models', 'firstPrompt', 'startedAt', 'endedAt', 'contextWindow']);
  return {
    harness: string(r.harness, `${path}.harness`),
    harnessName: string(r.harnessName, `${path}.harnessName`),
    file: string(r.file, `${path}.file`),
    sessionId: toSessionId(string(r.sessionId, `${path}.sessionId`)),
    cwd: string(r.cwd, `${path}.cwd`),
    gitBranch: string(r.gitBranch, `${path}.gitBranch`),
    version: string(r.version, `${path}.version`),
    entrypoint: string(r.entrypoint, `${path}.entrypoint`),
    models: array(r.models, `${path}.models`, string),
    firstPrompt: string(r.firstPrompt, `${path}.firstPrompt`),
    startedAt: timestamp(r.startedAt, `${path}.startedAt`),
    endedAt: timestamp(r.endedAt, `${path}.endedAt`),
    contextWindow: nullable(r.contextWindow, `${path}.contextWindow`, number),
  };
}

/** @throws {Error} with the path of the first part of `x` that is not a Session. */
export function decodeSession(x: unknown): Session {
  const r = rec(x, 'session', ['meta', 'events']);
  return { meta: meta(r.meta, 'session.meta'), events: eventList(array(r.events, 'session.events', event), 'session.events') };
}

/**
 * The invariants that no type can express, for a Session that is already typed.
 * Returns the problems; an empty list means that all hold.
 *
 * - Invariant 4: a `tool_use` block refers to a call in the same request, and
 *   the ids of the calls of a request are unique.
 */
export function findViolations(session: Session): string[] {
  const problems: string[] = [];
  const events: readonly SessionEvent[] = session.events;
  events.forEach((e, i) => {
    if (e.type !== 'request') return;
    const ids = e.tools.map((t) => t.id);
    if (new Set(ids).size !== ids.length) problems.push(`events[${i}]: duplicate tool id`);
    for (const b of e.blocks) {
      if (b.type === 'tool_use' && !ids.includes(b.toolId)) problems.push(`events[${i}]: tool_use "${b.toolId}" has no call in request.tools`);
    }
  });
  return problems;
}
