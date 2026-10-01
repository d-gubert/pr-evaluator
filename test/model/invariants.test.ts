// Run-time tests for the invariants that a type cannot express, and for the
// data that does not pass through the compiler (the golden file). The
// invariants that the compiler enforces are in test/types/invariants.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseTimestamp, parseToolUseId, toPositiveCount, toSessionId, type RequestEvent, type Session } from '../../src/model.js';
import { claudeCode } from '../../src/formats/claude-code.js';
import { formats } from '../../src/formats/index.js';
import { sources } from '../../src/sources/index.js';
import { toView } from '../../src/view/steps.js';
import { decodeSession, findViolations } from '../support/decode.js';
import { readGoldenSession, readGoldenSteps } from '../support/golden.js';
import { FIXTURE, GOLDEN_SESSION } from '../support/paths.js';

const fixtureText = readFileSync(FIXTURE, 'utf8');
const goldenJson = (): { events: Record<string, unknown>[]; [key: string]: unknown } => {
  const x: unknown = JSON.parse(readFileSync(GOLDEN_SESSION, 'utf8'));
  assert.ok(typeof x === 'object' && x !== null && 'events' in x && Array.isArray(x.events));
  const events: Record<string, unknown>[] = x.events;
  return { ...x, events };
};

/** The golden JSON with its events changed. */
const withEvents = (change: (events: Record<string, unknown>[]) => Record<string, unknown>[]) => ({ ...goldenJson(), events: change(goldenJson().events) });

// ---------------------------------------------------------------- the golden data fits the model

test('the golden session decodes: it satisfies every invariant of the model', () => {
  const session = readGoldenSession();
  assert.deepEqual(findViolations(session), []);
  assert.equal(session.events[0].type, 'session_start');
  assert.equal(session.events.at(-1)?.type, 'session_end');
});

test('the golden steps all have at least one tag (invariant 7)', () => {
  const steps = readGoldenSteps();
  assert.ok(Array.isArray(steps));
  for (const step of steps) assert.ok(typeof step === 'object' && step !== null && 'k' in step && Array.isArray(step.k) && step.k.length >= 1);
});

test('the parse of the fixture and the view of it keep the invariants', () => {
  const session = claudeCode.parse(fixtureText, { file: 'fixture.jsonl' });
  assert.deepEqual(findViolations(session), []);
  assert.deepEqual(decodeSession(JSON.parse(JSON.stringify(session))), session);
  for (const step of toView(session).steps) assert.ok(step.k.length >= 1);
});

// ---------------------------------------------------------------- invariant 1: the shape of the events (data from JSON)

test('invariant 1: the decoder rejects an event list of the wrong shape', () => {
  const type = (e: Record<string, unknown>) => e.type;
  const stray = { type: 'session_start', ts: '', hooks: [] };
  const end = { type: 'session_end', ts: '', hooks: [] };
  const context = { type: 'context', ts: '', items: [] };
  assert.throws(() => decodeSession(withEvents((e) => e.slice(1))), /session_start/);
  assert.throws(() => decodeSession(withEvents((e) => e.slice(0, -1))), /session_end/);
  assert.throws(() => decodeSession(withEvents((e) => [...e.slice(0, 3), stray, ...e.slice(3)])), /not session_start/);
  assert.throws(() => decodeSession(withEvents((e) => [...e.slice(0, 3), end, ...e.slice(3)])), /not session_end/);
  assert.throws(() => decodeSession(withEvents((e) => [...e.slice(0, 3), context, ...e.slice(3)])), /not context/);
  assert.throws(() => decodeSession(withEvents((e) => [e[0] ?? stray, context, ...e.slice(1)])), /not context/);
  assert.throws(() => decodeSession(withEvents(() => [])), /session_start/);
  assert.equal(goldenJson().events.filter((e) => type(e) === 'context').length, 1);
});

// ---------------------------------------------------------------- invariant 3: result and status (data from JSON)

test('invariant 3: the decoder rejects a result that does not match the status', () => {
  const withTool = (patch: Record<string, unknown>) =>
    withEvents((events) =>
      events.map((e) => {
        if (e.type !== 'request' || !Array.isArray(e.tools) || e.tools.length === 0) return e;
        const [first, ...rest]: unknown[] = e.tools;
        assert.ok(typeof first === 'object' && first !== null);
        return { ...e, tools: [{ ...first, ...patch }, ...rest] };
      }),
    );
  assert.throws(() => decodeSession(withTool({ status: 'no result' })), /null, because the status is "no result"/);
  assert.throws(() => decodeSession(withTool({ result: null })), /an object, because the status/);
  assert.throws(() => decodeSession(withTool({ status: 'nope' })), /one of/);
  assert.throws(() => decodeSession(withTool({ id: '' })), /non-empty string/);
});

// ---------------------------------------------------------------- invariant 4: a tool_use block refers to a call

const noToolsRequest = (over: Partial<RequestEvent>): RequestEvent => ({
  type: 'request', ts: '', model: 'm', usage: null, stopReason: '', blocks: [], tools: [], hooks: [], ...over,
});
const sessionOf = (request: RequestEvent): Session => ({
  meta: { ...readGoldenSession().meta, sessionId: toSessionId('s') },
  events: [{ type: 'session_start', ts: '', hooks: [] }, request, { type: 'session_end', ts: '', hooks: [] }],
});

test('invariant 4: a tool_use block must name a call of the same request', () => {
  const id = parseToolUseId('toolu_1');
  assert.ok(id);
  const dangling = noToolsRequest({ blocks: [{ type: 'tool_use', toolId: id }] });
  assert.deepEqual(findViolations(sessionOf(dangling)), [`events[1]: tool_use "toolu_1" has no call in request.tools`]);

  const call = { id, name: 'Read', input: {}, pre: [], post: [], subagent: null, status: 'no result', result: null } as const;
  assert.deepEqual(findViolations(sessionOf(noToolsRequest({ blocks: [{ type: 'tool_use', toolId: id }], tools: [call] }))), []);
  assert.deepEqual(findViolations(sessionOf(noToolsRequest({ tools: [call, call] }))), ['events[1]: duplicate tool id']);
});

test('invariant 4: the parser gives each tool_use block a call, and ids are not empty', () => {
  const rec = (o: Record<string, unknown>) => JSON.stringify({ sessionId: 's', timestamp: '2026-01-01T00:00:00.000Z', ...o });
  const session = claudeCode.parse(
    [
      rec({ type: 'assistant', message: { id: 'a', model: 'm', content: [{ type: 'tool_use', id: 't1', name: 'Read', input: {} }, { type: 'tool_use', name: 'NoId', input: {} }, { type: 'tool_use', id: '', name: 'EmptyId' }] } }),
    ].join('\n'),
    { file: 'x.jsonl' },
  );
  assert.deepEqual(findViolations(session), []);
  const request = session.events.find((e) => e.type === 'request');
  assert.equal(request?.type === 'request' && request.tools.map((t) => t.name).join(), 'Read');
  assert.equal(parseToolUseId(''), null);
  assert.equal(parseToolUseId(7), null);
  assert.equal(parseToolUseId(undefined), null);
  assert.equal(parseToolUseId('toolu_1'), 'toolu_1');
});

// ---------------------------------------------------------------- invariant 4: timestamps

test('invariant 4: a timestamp is ISO 8601, or "" for an unknown time', () => {
  for (const ok of ['2026-01-01T10:00:03.000Z', '2026-01-01T10:00:03Z', '2026-01-01T10:00:03+02:00', '2026-01-01T10:00']) {
    assert.equal(parseTimestamp(ok), ok);
  }
  for (const bad of ['', 'yesterday', '2026-01-01', '2026-01-01 10:00:03', 1767261603000, null, undefined, {}]) {
    assert.equal(parseTimestamp(bad), '', String(bad));
  }
  assert.throws(() => decodeSession(withEvents((e) => e.map((x, i) => (i === 1 ? { ...x, ts: 'yesterday' } : x)))), /ISO timestamp/);
});

test('invariant 4: the parser uses "" for a record without a time', () => {
  const session = claudeCode.parse(JSON.stringify({ type: 'user', sessionId: 's', message: { content: 'hi' } }) + '\n', { file: 'x.jsonl' });
  assert.deepEqual(session.events.map((e) => e.ts), ['', '', '']);
  assert.equal(session.meta.startedAt, '');
});

// ---------------------------------------------------------------- invariant 5: count >= 1

test('invariant 5: api_error.count is an integer of 1 or more (a number range is not a type)', () => {
  assert.equal(toPositiveCount(1), 1);
  assert.equal(toPositiveCount(7), 7);
  for (const bad of [0, -1, 1.5, NaN, Infinity]) assert.throws(() => toPositiveCount(bad), RangeError, String(bad));
  const apiError = (e: Record<string, unknown>) => (e.type === 'api_error' ? { ...e, count: 0 } : e);
  assert.throws(() => decodeSession(withEvents((e) => e.map(apiError))), RangeError);
});

test('invariant 5: the parser merges consecutive api_error records and counts them from 1', () => {
  const rec = (o: Record<string, unknown>) => JSON.stringify({ sessionId: 's', timestamp: '2026-01-01T00:00:00.000Z', ...o });
  const err = rec({ type: 'system', subtype: 'api_error', error: { message: 'overloaded' } });
  const counts = (n: number) => {
    const s = claudeCode.parse(Array.from({ length: n }, () => err).join('\n'), { file: 'x.jsonl' });
    return s.events.flatMap((e) => (e.type === 'api_error' ? [e.count] : []));
  };
  assert.deepEqual(counts(1), [1]);
  assert.deepEqual(counts(3), [3]);
});

// ---------------------------------------------------------------- invariant 6: open outcomes

test('invariant 6: the parser keeps an outcome that the model does not know', () => {
  const rec = (o: Record<string, unknown>) => JSON.stringify({ sessionId: 's', timestamp: '2026-01-01T00:00:00.000Z', ...o });
  const s = claudeCode.parse(
    [
      rec({ type: 'attachment', attachment: { type: 'hook_success', hookEvent: 'SessionStart', hookName: 'SessionStart:startup' } }),
      rec({ type: 'attachment', attachment: { type: 'hook_permission_decision', hookEvent: 'SessionStart', hookName: 'SessionStart:other', decision: 'allow' } }),
      rec({ type: 'attachment', attachment: { type: 'hook_custom_thing', hookEvent: 'SessionStart', hookName: 'SessionStart:third' } }),
    ].join('\n'),
    { file: 'x.jsonl' },
  );
  assert.deepEqual(s.events[0].hooks.map((h) => h.outcome), ['ok', 'allow', 'custom_thing']);
});

// ---------------------------------------------------------------- invariant 10: the registries

test('invariant 10: the registries have unique ids (the types only check that they are not empty)', () => {
  assert.ok(formats.length >= 1);
  assert.ok(sources.length >= 1);
  assert.equal(new Set(formats.map((f) => f.id)).size, formats.length);
  assert.equal(new Set(sources.map((s) => s.id)).size, sources.length);
});
