// @ts-check
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sources, getSource, AmbiguousSessionError } from '../../src/sources/index.js';
import { claudeCodeSource as src } from '../../src/sources/claude-code.js';

const jl = (/** @type {object[]} */ recs) => recs.map((r) => JSON.stringify(r)).join('\n') + '\n';
const user = (/** @type {any} */ content, extra = {}) => ({ type: 'user', message: { role: 'user', content }, ...extra });

/** @type {string} */ let tmp;
/** @type {string} */ let root;
/** @type {Record<string, string>} */ let paths;

async function put(/** @type {string} */ file, /** @type {string} */ body, /** @type {number} */ mtimeSec) {
  await mkdir(join(file, '..'), { recursive: true });
  await writeFile(file, body);
  await utimes(file, mtimeSec, mtimeSec);
}

before(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'pr-evaluator-sources-'));
  root = join(tmp, 'profile');
  const a = join(root, 'projects', '-work-app');
  const b = join(root, 'projects', '-work-lib');
  paths = {
    old: join(a, 'aaaa1111-0000-0000-0000-000000000001.jsonl'),
    mid: join(b, 'bbbb2222-0000-0000-0000-000000000002.jsonl'),
    new: join(a, 'aaaa3333-0000-0000-0000-000000000003.jsonl'),
  };
  await put(
    paths.old,
    jl([
      { type: 'attachment', cwd: '/work/app' },
      user('<command-name>/clear</command-name>', { cwd: '/work/app' }),
      user('meta text', { isMeta: true }),
      user([{ type: 'tool_result', tool_use_id: 't', content: 'x' }]),
      user('side', { isSidechain: true }),
      user([{ type: 'text', text: 'real prompt' }]),
    ]),
    1000,
  );
  // no cwd anywhere, invalid JSON line, no prompt: falls back to dir name
  await put(paths.mid, 'not json\n' + jl([{ type: 'assistant' }]), 2000);
  await put(paths.new, jl([user('latest prompt', { cwd: '/work/app2' })]), 3000);
  // ignored: subagent file in nested dir, non-jsonl file
  await put(join(a, 'aaaa3333-0000-0000-0000-000000000003', 'subagents', 'agent-1.jsonl'), jl([user('sub')]), 4000);
  await put(join(a, 'notes.txt'), 'hi', 5000);
});

after(() => rm(tmp, { recursive: true, force: true }));

test('registry: Claude Code first, getSource', () => {
  assert.equal(sources[0], src);
  assert.equal(getSource('claude-code'), src);
  assert.equal(getSource('nope'), undefined);
});

test('root: CLAUDE_CONFIG_DIR, else <home>/.claude', () => {
  assert.equal(src.root({ CLAUDE_CONFIG_DIR: '/cfg' }, '/home/u'), '/cfg');
  assert.equal(src.root({}, '/home/u'), join('/home/u', '.claude'));
  assert.equal(src.root({ CLAUDE_CONFIG_DIR: '' }, '/home/u'), join('/home/u', '.claude'));
});

test('list: newest first, ignores nested and non-jsonl files', async () => {
  const list = await src.list(root);
  assert.deepEqual(list.map((s) => s.path), [paths.new, paths.mid, paths.old]);
  assert.equal(list[0].id, 'aaaa3333-0000-0000-0000-000000000003');
  assert.equal(list[0].source, 'claude-code');
  assert.equal(list[0].modifiedAt.getTime(), 3000 * 1000);
  assert.ok(list[0].size > 0);
});

test('list: limit applies after the sort', async () => {
  const list = await src.list(root, { limit: 2 });
  assert.deepEqual(list.map((s) => s.path), [paths.new, paths.mid]);
});

test('list: project from cwd, else directory name', async () => {
  const list = await src.list(root);
  assert.equal(list[0].project, '/work/app2');
  assert.equal(list[1].project, '-work-lib');
  assert.equal(list[2].project, '/work/app');
});

test('list: firstPrompt skips meta, command, tool result, sidechain; bad JSON skipped', async () => {
  const list = await src.list(root);
  assert.equal(list[0].firstPrompt, 'latest prompt');
  assert.equal(list[1].firstPrompt, '');
  assert.equal(list[2].firstPrompt, 'real prompt');
});

test('list: missing root gives []', async () => {
  assert.deepEqual(await src.list(join(tmp, 'missing')), []);
  assert.deepEqual(await src.list(tmp), []); // exists, but has no projects dir
});

test('list: reads at most 64 KiB per file', async () => {
  const file = join(root, 'projects', '-work-big', 'cccc4444.jsonl');
  const filler = JSON.stringify({ type: 'system', pad: 'x'.repeat(1024 * 1024) }) + '\n';
  const body = filler + jl([user('too late')]);
  assert.ok(body.length > 1024 * 1024);
  await put(file, body, 500);
  const big = (await src.list(root)).find((s) => s.id === 'cccc4444');
  assert.ok(big);
  assert.equal(big.firstPrompt, '');
  assert.equal(big.size, Buffer.byteLength(body));
  // control: the same prompt inside the first 64 KiB is found
  const near = join(root, 'projects', '-work-big', 'cccc5555.jsonl');
  await put(near, jl([user('early')]) + filler, 400);
  assert.equal((await src.list(root)).find((s) => s.id === 'cccc5555')?.firstPrompt, 'early');
});

test('resolve: exact id and unique prefix', async () => {
  assert.equal(await src.resolve(root, 'aaaa1111-0000-0000-0000-000000000001'), paths.old);
  assert.equal(await src.resolve(root, 'bbbb'), paths.mid);
  assert.equal(await src.resolve(root, 'aaaa3'), paths.new);
  assert.equal(await src.resolve(root, 'zzzz'), null);
  assert.equal(await src.resolve(join(tmp, 'missing'), 'aaaa1111'), null);
});

test('resolve: prefix shorter than 4 characters gives null', async () => {
  assert.equal(await src.resolve(root, 'bbb'), null);
  assert.equal(await src.resolve(root, ''), null);
});

test('resolve: ambiguous prefix throws with 2 candidates', async () => {
  await assert.rejects(
    () => src.resolve(root, 'aaaa'),
    (/** @type {any} */ err) => {
      assert.ok(err instanceof AmbiguousSessionError);
      assert.equal(err.candidates.length, 2);
      assert.deepEqual([...err.candidates].sort(), [paths.old, paths.new].sort());
      return true;
    },
  );
});
