// End-to-end tests: run the compiled dist/bin/yast.js as a child process.
// Each test uses a temporary profile (CLAUDE_CONFIG_DIR) and a temporary cwd.
// Nothing touches ~/.claude or the repo tree.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, copyFile, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BIN, FIXTURE, packageVersion } from '../support/paths.js';

const ID = 'cccc3333-0000-0000-0000-000000000003';

let tmp: string;
let profile: string;
let home: string;
let cwd: string;
let sessionPath: string;

before(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'yast-e2e-'));
  profile = join(tmp, 'profile');
  home = join(tmp, 'home');
  await mkdir(home);
  sessionPath = join(profile, 'projects', '-work-app', `${ID}.jsonl`);
  await mkdir(join(sessionPath, '..'), { recursive: true });
  await copyFile(FIXTURE, sessionPath);
});

after(() => rm(tmp, { recursive: true, force: true }));

beforeEach(async () => {
  cwd = await mkdtemp(join(tmp, 'cwd-'));
});

/** Run the CLI with no TTY (stdin is closed, stdout and stderr are pipes). */
function cli(args: string[]) {
  const r = spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: 'utf8',
    input: '',
    env: { ...process.env, CLAUDE_CONFIG_DIR: profile, HOME: home, USERPROFILE: home },
  });
  assert.equal(r.error, undefined);
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

const exists = (p: string) => access(p).then(() => true, () => false);

test('--help exits 0 and shows the usage', () => {
  const r = cli(['--help']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /^usage: yast/);
});

test('--version prints the package version', () => {
  const r = cli(['--version']);
  assert.equal(r.code, 0);
  assert.equal(r.stdout.trim(), packageVersion());
});

test('--list lists the sessions of the profile', () => {
  const r = cli(['--list']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /\/work\/app.*write tests/, r.stdout);
});

test('a session path writes <id>.trace.html in the cwd', async () => {
  const r = cli([sessionPath]);
  assert.equal(r.code, 0, r.stderr);
  const out = join(cwd, `${ID}.trace.html`);
  assert.ok(await exists(out));
  assert.match(await readFile(out, 'utf8'), /^<!doctype html>/i);
});

test('a session ID resolves in the profile', async () => {
  const r = cli([ID]);
  assert.equal(r.code, 0, r.stderr);
  assert.ok(await exists(join(cwd, `${ID}.trace.html`)));
});

test('-o writes to the given file when its directory exists', async () => {
  await mkdir(join(cwd, 'out'));
  const r = cli([sessionPath, '-o', 'out/x.html']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(await readFile(join(cwd, 'out', 'x.html'), 'utf8'), /^<!doctype html>/i);
  assert.equal(await exists(join(cwd, `${ID}.trace.html`)), false);
});

test('--stdout prints the page and writes no file', async () => {
  const r = cli([sessionPath, '--stdout']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /^<!doctype html>/i);
  assert.equal(await exists(join(cwd, `${ID}.trace.html`)), false);
});

test('no argument and no TTY lists the sessions and exits 2', () => {
  const r = cli([]);
  assert.equal(r.code, 2);
  assert.match(r.stdout, /\/work\/app.*write tests/, r.stdout);
  assert.match(r.stderr, /pass a session path or ID/);
});

test('a bad option exits 2', () => {
  const r = cli(['--bogus']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /unknown option "--bogus"/);
});

test('--list with a session, -o, or --stdout exits 2', () => {
  for (const extra of [[sessionPath], ['-o', 'x.html'], ['--stdout']]) {
    assert.equal(cli(['--list', ...extra]).code, 2, extra.join(' '));
  }
});

test('-o with --stdout exits 2', () => {
  assert.equal(cli([sessionPath, '-o', 'x.html', '--stdout']).code, 2);
});

test('an unknown session exits 1', () => {
  assert.equal(cli(['no-such-session']).code, 1);
});
