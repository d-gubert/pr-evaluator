// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { toView } from '../../src/view/steps.js';
import { renderHtml } from '../../src/render/html.js';

const session = JSON.parse(readFileSync(new URL('../golden/fixture.session.json', import.meta.url), 'utf8'));

/** @param {string} html */
function dataOf(html) {
  const m = html.match(/<script type="application\/json" id="data">([\s\S]*?)<\/script>/);
  assert.ok(m, 'data block exists');
  return JSON.parse(m[1]);
}

test('the data block holds the step titles', () => {
  const view = toView(session);
  const html = renderHtml(view);
  const data = dataOf(html);
  assert.deepEqual(data, view);
  for (const s of view.steps) assert.ok(html.includes(JSON.stringify(s.t).slice(1, -1)), s.t);
  assert.ok(html.startsWith('<!doctype html>'));
});

test('a harness name shows in the title, the h1, and the data', () => {
  const s = structuredClone(session);
  s.meta.harnessName = 'Other Agent';
  const html = renderHtml(toView(s));
  assert.match(html, /<title>Other Agent Session Trace<\/title>/);
  assert.match(html, /<h1>Other Agent session trace<\/h1>/);
  assert.equal(dataOf(html).meta.harnessName, 'Other Agent');
  assert.doesNotMatch(html.replace(/"[^"]*Claude Code[^"]*"/g, ''), /<h1>Claude Code/);
});

test('the harness name is HTML-escaped', () => {
  const s = structuredClone(session);
  s.meta.harnessName = '<b>"x"</b>';
  const html = renderHtml(toView(s));
  assert.match(html, /<h1>&lt;b&gt;&quot;x&quot;&lt;\/b&gt; session trace<\/h1>/);
});

test('a script end tag in a step title does not end the data script', () => {
  const view = toView(session);
  view.steps[0].t = '</script><script>alert(1)</script>';
  const html = renderHtml(view);
  assert.equal(html.split('</script>').length - 1, 2);
  assert.equal(dataOf(html).steps[0].t, '</script><script>alert(1)</script>');
});

test('U+2028 and U+2029 are escaped in the data', () => {
  const view = toView(session);
  view.steps[0].d = 'a b c';
  const html = renderHtml(view);
  assert.ok(!html.includes(' '));
  assert.ok(!html.includes(' '));
  assert.ok(html.includes('a\\u2028b\\u2029c'));
  assert.equal(dataOf(html).steps[0].d, 'a b c');
});

test('replacement text with $ patterns is kept as is', () => {
  const view = toView(session);
  view.steps[0].d = "cost $& $' $1";
  assert.equal(dataOf(renderHtml(view)).steps[0].d, "cost $& $' $1");
});
