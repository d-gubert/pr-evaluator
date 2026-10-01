// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatSessionList } from '../../src/cli/list.js';

/** @returns {import('../../src/sources/index.js').SessionInfo} */
const info = (/** @type {Partial<import('../../src/sources/index.js').SessionInfo>} */ over) => ({
  id: 'x', path: '/p/x.jsonl', source: 'claude-code', project: '/work/app',
  modifiedAt: new Date(2026, 0, 2, 3, 4), size: 1, firstPrompt: 'hello', ...over,
});

test('an empty list gives an empty string', () => {
  assert.equal(formatSessionList([], {}), '');
});

test('a line holds the index, the local date and time, the project and the prompt', () => {
  const out = formatSessionList([info({})], { columns: 80 });
  assert.equal(out, '1  2026-01-02 03:04  /work/app  hello\n');
});

test('the index is padded to the widest index', () => {
  const sessions = Array.from({ length: 10 }, () => info({}));
  const lines = formatSessionList(sessions, { columns: 80 }).trimEnd().split('\n');
  assert.equal(lines.length, 10);
  assert.match(lines[0], /^ 1  2026/);
  assert.match(lines[9], /^10  2026/);
});

test('the prompt is one line', () => {
  const out = formatSessionList([info({ firstPrompt: 'fix\n\n  the   bug\tnow' })], { columns: 80 });
  assert.equal(out.trimEnd().split('\n').length, 1);
  assert.match(out, /fix the bug now\n$/);
});

test('a session with no prompt shows (no prompt)', () => {
  assert.match(formatSessionList([info({ firstPrompt: '' })], {}), /\(no prompt\)\n$/);
  assert.match(formatSessionList([info({ firstPrompt: ' \n ' })], {}), /\(no prompt\)\n$/);
});

test('every line fits the columns, and a clipped prompt ends with an ellipsis', () => {
  const long = 'word '.repeat(100);
  for (const columns of [40, 60, 100]) {
    const out = formatSessionList([info({ firstPrompt: long }), info({ project: '/very/long/project/path/'.repeat(5), firstPrompt: long })], { columns });
    for (const line of out.trimEnd().split('\n')) {
      assert.ok(Array.from(line).length <= columns, `${columns}: ${line}`);
      assert.match(line, /…$/);
    }
  }
});

test('the default width is 100', () => {
  const out = formatSessionList([info({ firstPrompt: 'x'.repeat(300) })], {});
  assert.equal(Array.from(out.trimEnd()).length, 100);
});

test('the prompt column lines up when the projects differ', () => {
  const out = formatSessionList([info({ project: '/a', firstPrompt: 'one' }), info({ project: '/much/longer', firstPrompt: 'two' })], { columns: 80 });
  const [a, b] = out.trimEnd().split('\n');
  assert.equal(a.indexOf('one'), b.indexOf('two'));
});
