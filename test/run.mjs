import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildTrace, readRecords, renderHtml } from '../session-trace.mjs';

const fixture = new URL('./fixture.jsonl', import.meta.url);
const trace = buildTrace(readRecords(readFileSync(fixture, 'utf8')), { file: 'fixture.jsonl' });
const byTitle = t => trace.steps.find(s => s.t === t);

test('the steps follow the order of the transcript', () => {
  assert.deepEqual(trace.steps.map(s => s.t), [
    'Session starts', 'Build the context', 'User sends the prompt',
    'Turn 1: Glob', 'Turn 2: TodoWrite, Write', 'Turn 3: Bash', 'API error ×2', 'Turn 4: Agent',
    'Auto-compact', 'Turn 5: end_turn', 'Stop hook', 'Turn 6: end_turn', 'Stop hook',
    'Slash command /cost', 'You interrupt the turn', 'Claude Code adds a message', 'Session ends',
  ]);
  assert.equal(trace.meta.turns, 6);
});

test('the hooks attach to their tool call, prompt, and session step', () => {
  assert.deepEqual(byTitle('Session starts').k, ['hook', 'loop']);
  assert.deepEqual(byTitle('User sends the prompt').k, ['ui', 'hook']);
  const t1 = byTitle('Turn 1: Glob');
  // The progress record and the result record of one hook make one line.
  assert.equal(t1.c.match(/hook: PreToolUse:Glob/g).length, 1);
  assert.match(t1.c, /hook: PreToolUse:Glob → ok\n  \$ check\.sh\ntool: Glob ✓/);
  assert.match(byTitle('Turn 3: Bash').d, /A PreToolUse hook blocks 1 tool call/);
  assert.match(byTitle('Session ends').c, /hook: SessionEnd → ok/);
});

test('a rejected tool call adds the user tag', () => {
  const t2 = byTitle('Turn 2: TodoWrite, Write');
  assert.ok(t2.k.includes('ui'));
  assert.match(t2.c, /tool: Write ✗ rejected by you/);
  assert.match(t2.c, /\[~\] tests for date\.ts/);
});

test('the context meter follows the requests and the compaction', () => {
  assert.equal(byTitle('Turn 4: Agent').ctx, 30000);
  assert.equal(byTitle('Auto-compact').ctx, 42000);
  assert.match(byTitle('Turn 4: Agent').c, /subagent: 7 tool calls · 41,234 tokens · 38 s/);
});

test('a blocking Stop hook continues the loop', () => {
  const stops = trace.steps.filter(s => s.t === 'Stop hook');
  assert.match(stops[0].d, /The loop continues/);
  assert.match(stops[1].d, /lets the loop exit/);
});

test('the page escapes the session data', () => {
  const html = renderHtml({ meta: { sessionId: 'x', window: 200000 }, steps: [{ t: '</script><script>alert(1)</script>', k: ['ui'], d: '', c: '', turn: 0, ctx: 0 }] });
  assert.equal(html.match(/<\/script>/g).length, 2);
  assert.ok(html.includes('\\u003c/script>'));
});
