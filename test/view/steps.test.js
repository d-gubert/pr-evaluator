// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { toView } from '../../src/view/steps.js';

/** @param {string} name */
const load = name => JSON.parse(readFileSync(new URL(`../golden/${name}`, import.meta.url), 'utf8'));

/** @returns {any} */
const golden = () => load('fixture.session.json');

/** Minimal session with the given request events. @param {any[]} requests @param {any} [meta] */
function sessionWith(requests, meta = {}) {
  const base = golden();
  return {
    meta: { ...base.meta, models: [], contextWindow: null, ...meta },
    events: [
      { type: 'session_start', ts: '', hooks: [] },
      ...requests,
      { type: 'session_end', ts: '', hooks: [] },
    ],
  };
}

/** @param {number} cacheRead @param {string} [model] */
const request = (cacheRead, model = 'claude-x') => ({
  type: 'request', ts: '', model, stopReason: 'end_turn',
  usage: { input: 0, cacheRead, cacheWrite: 0, output: 1, thinking: null },
  blocks: [], tools: [], hooks: [],
});

test('golden session gives the golden steps', () => {
  const view = toView(golden());
  assert.deepEqual(view.steps, load('fixture.steps.json'));
  assert.equal(view.meta.turns, 6);
  assert.equal(view.meta.window, 200000);
  assert.equal(view.meta.harnessName, 'Claude Code');
  assert.equal(view.meta.sessionId, golden().meta.sessionId);
});

test('window: more than 200,000 context tokens gives 1,000,000', () => {
  assert.equal(toView(sessionWith([request(250000)])).meta.window, 1000000);
});

test('window: a [1m] model gives 1,000,000', () => {
  assert.equal(toView(sessionWith([request(10)], { models: ['claude-x[1m]'] })).meta.window, 1000000);
  assert.equal(toView(sessionWith([request(10, 'claude-x[1m]')])).meta.window, 1000000);
});

test('window: meta.contextWindow wins', () => {
  assert.equal(toView(sessionWith([request(250000)], { contextWindow: 32000 })).meta.window, 32000);
});

test('window: default is 200,000', () => {
  assert.equal(toView(sessionWith([request(10)])).meta.window, 200000);
  assert.equal(toView(sessionWith([])).meta.window, 200000);
});

test('harnessName shows in the start step and the other harness texts', () => {
  const s = golden();
  s.meta.harnessName = 'Other Agent';
  const steps = toView(s).steps;
  assert.match(steps[0].d, /^Other Agent 2\.1\.200 starts in \/work\/app\./);
  const all = steps.map(x => x.t + ' ' + x.d).join('\n');
  assert.doesNotMatch(all, /Claude Code/);
  assert.ok(steps.some(x => x.t === 'Other Agent adds a message'));
});

test('one event gives one step; the turn number counts request events', () => {
  const s = golden();
  const view = toView(s);
  assert.equal(view.steps.length, s.events.length);
  assert.equal(view.steps.at(-1)?.turn, 6);
  assert.equal(view.steps[0].turn, 0);
});

test('a request without usage keeps the context of the earlier step', () => {
  const noUsage = { ...request(0), usage: null };
  const view = toView(sessionWith([request(1000), noUsage]));
  assert.equal(view.steps[1].ctx, 1000);
  assert.equal(view.steps[2].ctx, 1000);
  assert.equal(view.steps[2].turn, 2);
});

test('code block is cut at 60 lines', () => {
  const s = sessionWith([]);
  s.events.splice(1, 0, { type: 'context', ts: '', items: Array.from({ length: 70 }, (_, i) => `item ${i}`) });
  const c = toView(s).steps[1].c;
  assert.equal(c.split('\n').length, 61);
  assert.match(c, /… \(10 more lines\)$/);
});
