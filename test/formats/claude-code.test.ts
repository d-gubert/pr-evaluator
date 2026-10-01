import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { claudeCode } from '../../src/formats/claude-code.js';
import { FIXTURE, GOLDEN_SESSION } from '../support/paths.js';

const fixtureText = readFileSync(FIXTURE, 'utf8');
const golden: unknown = JSON.parse(readFileSync(GOLDEN_SESSION, 'utf8'));

const base = { sessionId: 's-1', cwd: '/w', version: '1', entrypoint: 'cli', isSidechain: false };
const rec = (o: Record<string, unknown>, ts = '2026-01-01T00:00:00.000Z') => JSON.stringify({ ...base, timestamp: ts, ...o });
const parse = (lines: string[]) => claudeCode.parse(lines.join('\n') + '\n', { file: 'x.jsonl' });

test('the fixture parses to the golden Session', () => {
  const session = claudeCode.parse(fixtureText, { file: 'fixture.jsonl' });
  assert.deepEqual(JSON.parse(JSON.stringify(session)), golden);
});

test('the fixture ends in a partial line and the parser ignores it', () => {
  const last = fixtureText.trimEnd().split('\n').pop();
  assert.throws(() => JSON.parse(last ?? ''));
  const withPartial = claudeCode.parse(fixtureText, { file: 'fixture.jsonl' });
  const without = claudeCode.parse(fixtureText.trimEnd().split('\n').slice(0, -1).join('\n'), { file: 'fixture.jsonl' });
  assert.deepEqual(withPartial, without);
});

test('a partial last line is ignored', () => {
  const s = parse([rec({ type: 'user', message: { content: 'hello' } }), '{"type":"user","message":{"con']);
  assert.deepEqual(s.events.map(e => e.type), ['session_start', 'prompt', 'session_end']);
});

test('sidechain records are skipped', () => {
  const s = parse([
    rec({ type: 'user', message: { content: 'main prompt' } }),
    rec({ type: 'user', isSidechain: true, sessionId: 'other', message: { content: 'sidechain prompt' } }, '2030-01-01T00:00:00.000Z'),
    rec({ type: 'assistant', isSidechain: true, message: { id: 'sc', model: 'side-model', content: [{ type: 'text', text: 'hi' }] } }),
  ]);
  assert.deepEqual(s.events.map(e => e.type), ['session_start', 'prompt', 'session_end']);
  assert.equal(s.meta.firstPrompt, 'main prompt');
  assert.deepEqual(s.meta.models, []);
  assert.equal(s.meta.endedAt, '2026-01-01T00:00:00.000Z');
  assert.ok(!JSON.stringify(s).includes('sidechain prompt'));
});

test('private attachments leave no trace in the Session', () => {
  const secret = 'TOP-SECRET-9f3a';
  const s = parse([
    rec({ type: 'attachment', attachment: { type: 'session_context', content: secret, path: `/x/${secret}` } }),
    rec({ type: 'attachment', attachment: { type: 'credential_org', content: secret, orgId: secret } }),
    rec({ type: 'attachment', attachment: { type: 'remote_session_change', content: secret } }),
    rec({ type: 'attachment', attachment: { type: 'nested_memory', path: '/w/CLAUDE.md' } }),
    rec({ type: 'user', message: { content: 'hi' } }),
  ]);
  const json = JSON.stringify(s);
  assert.ok(!json.includes(secret));
  assert.ok(!json.includes('session_context'));
  assert.ok(!json.includes('credential_org'));
  assert.ok(!json.includes('remote_session_change'));
  const ctx = s.events.find(e => e.type === 'context');
  assert.deepEqual(ctx && ctx.type === 'context' && ctx.items, ['nested_memory: /w/CLAUDE.md']);
});

test('only private attachments give no context event', () => {
  const s = parse([rec({ type: 'attachment', attachment: { type: 'session_context', content: 'x' } })]);
  assert.deepEqual(s.events.map(e => e.type), ['session_start', 'session_end']);
});

test('an empty log gives a session_start and a session_end', () => {
  const s = claudeCode.parse('', { file: 'empty.jsonl' });
  assert.deepEqual(s.events.map(e => e.type), ['session_start', 'session_end']);
  assert.equal(s.meta.startedAt, '');
});

test('the parser keeps full texts and tolerates odd records', () => {
  const long = 'x '.repeat(500);
  const s = parse([
    'null',
    '[1,2]',
    '5',
    rec({ type: 'user', message: { content: long } }),
    rec({ type: 'assistant', message: { id: 'a', model: 'm', content: [null, { type: 'text', text: '  ' }, { type: 'tool_use', id: 't', name: 'Read', input: {} }] } }),
    rec({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't', content: [{ type: 'text', text: long }, { type: 'image' }], is_error: false }] } }),
    rec({ type: 'attachment', attachment: { type: 'hook_success', hookEvent: 'PostToolUse', hookName: 'PostToolUse:Read', toolUseID: 't', content: long } }),
  ]);
  const prompt = s.events[1];
  assert.equal(prompt?.type === 'prompt' && prompt.text, long.trim());
  const req = s.events[2];
  assert.equal(req?.type, 'request');
  if (req?.type !== 'request') return;
  assert.deepEqual(req.blocks, [{ type: 'tool_use', toolId: 't' }]);
  assert.equal(req.usage, null);
  assert.equal(req.tools[0]?.result?.text, long + '\n[image]');
  assert.equal(req.tools[0]?.post[0]?.detail, long);
});

test('tool status comes from the result', () => {
  const call = (id: string, content: string | undefined, is_error?: boolean) => [
    rec({ type: 'assistant', message: { id: 'm' + id, model: 'm', content: [{ type: 'tool_use', id, name: 'T', input: {} }] } }),
    ...(content === undefined ? [] : [rec({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content, is_error }] } })]),
  ];
  const s = parse([
    ...call('a', 'fine', false),
    ...call('b', 'boom', true),
    ...call('c', "The user doesn't want to proceed with this tool use.", true),
    ...call('d', '[Request interrupted by user for tool use]', true),
    ...call('e', undefined),
  ]);
  const status = s.events.flatMap(e => (e.type === 'request' ? e.tools.map(t => t.status) : []));
  assert.deepEqual(status, ['ok', 'error', 'rejected', 'interrupted', 'no result']);
});

test('detect is true for the fixture head', () => {
  assert.equal(claudeCode.detect({ path: 'fixture.jsonl', head: fixtureText.slice(0, 65536) }), true);
});

test('detect is false for other JSON and for plain text', () => {
  assert.equal(claudeCode.detect({ path: 'a.jsonl', head: '{"a":1}\n' }), false);
  assert.equal(claudeCode.detect({ path: 'a.txt', head: 'just some text\nmore text\n' }), false);
  assert.equal(claudeCode.detect({ path: 'a.jsonl', head: '' }), false);
  assert.equal(claudeCode.detect({ path: 'a.jsonl', head: '{"sessionId":1,"type":"user"}\n' }), false);
  assert.equal(claudeCode.detect({ path: 'a.jsonl', head: '{"sessionId":"s","type":"other"}\n' }), false);
});

test('detect accepts a head that is cut inside a line', () => {
  const head = fixtureText.slice(0, 700);
  assert.equal(claudeCode.detect({ path: 'f.jsonl', head }), true);
});

// Smoke test on the real logs of this machine.
const smokeRoot = join(homedir(), '.claude', 'projects');

test('smoke: every real log under ~/.claude/projects/*/ parses', { skip: !existsSync(smokeRoot) }, () => {
  const dirs = existsSync(smokeRoot) ? readdirSync(smokeRoot, { withFileTypes: true }).filter(d => d.isDirectory()) : [];
  for (const d of dirs) {
    for (const f of readdirSync(join(smokeRoot, d.name))) {
      if (!f.endsWith('.jsonl')) continue;
      const path = join(smokeRoot, d.name, f);
      const s = claudeCode.parse(readFileSync(path, 'utf8'), { file: f });
      assert.equal(s.events[0].type, 'session_start', path);
      assert.equal(s.events[s.events.length - 1]?.type, 'session_end', path);
    }
  }
});
