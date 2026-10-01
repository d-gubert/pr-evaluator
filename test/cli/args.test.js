// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, UsageError, helpText } from '../../src/cli/args.js';

const usage = (/** @type {RegExp} */ re) => (/** @type {unknown} */ e) => e instanceof UsageError && re.test(e.message);

test('no arguments give the defaults', () => {
  assert.deepEqual(parseArgs([]), {
    session: undefined, output: undefined, stdout: false, format: undefined,
    list: false, limit: 20, help: false, version: false,
  });
});

test('the session argument is a path or an ID', () => {
  assert.equal(parseArgs(['a/b.jsonl']).session, 'a/b.jsonl');
  assert.equal(parseArgs(['abcd1234']).session, 'abcd1234');
  assert.equal(parseArgs(['-n', '3', 'abcd']).session, 'abcd');
  assert.equal(parseArgs(['--', '-odd.jsonl']).session, '-odd.jsonl');
});

test('a second session argument is a usage error', () => {
  assert.throws(() => parseArgs(['a', 'b']), usage(/unexpected argument "b"/));
});

test('-o and --output', () => {
  assert.equal(parseArgs(['-o', 'x.html']).output, 'x.html');
  assert.equal(parseArgs(['--output', 'x.html']).output, 'x.html');
  assert.equal(parseArgs(['--output=x.html', 's']).output, 'x.html');
  assert.throws(() => parseArgs(['-o']), usage(/-o needs a value/));
  assert.throws(() => parseArgs(['-o', '--stdout']), usage(/-o needs a value/));
});

test('--stdout', () => {
  assert.equal(parseArgs(['--stdout']).stdout, true);
  assert.throws(() => parseArgs(['--stdout=1']), usage(/takes no value/));
});

test('-o with --stdout is a usage error, in either order', () => {
  assert.throws(() => parseArgs(['-o', 'x.html', '--stdout']), usage(/cannot be used together/));
  assert.throws(() => parseArgs(['--stdout', '--output', 'x.html']), usage(/cannot be used together/));
});

test('-f and --format', () => {
  assert.equal(parseArgs(['-f', 'claude-code']).format, 'claude-code');
  assert.equal(parseArgs(['--format', 'claude-code']).format, 'claude-code');
  assert.equal(parseArgs(['--format=claude-code']).format, 'claude-code');
  assert.throws(() => parseArgs(['-f']), usage(/-f needs a value/));
});

test('-l and --list', () => {
  assert.equal(parseArgs(['-l']).list, true);
  assert.equal(parseArgs(['--list']).list, true);
});

test('-n and --limit', () => {
  assert.equal(parseArgs(['-n', '5']).limit, 5);
  assert.equal(parseArgs(['--limit', '7']).limit, 7);
  assert.equal(parseArgs(['--limit=9']).limit, 9);
});

test('-n with a bad number is a usage error', () => {
  for (const bad of ['x', '0', '1.5', '', '5x']) {
    assert.throws(() => parseArgs(['-n', bad]), usage(/invalid number/), `"${bad}"`);
  }
  assert.throws(() => parseArgs(['--limit=-3']), usage(/invalid number/));
  assert.throws(() => parseArgs(['-n', '-3']), usage(/-n needs a value/));
  assert.throws(() => parseArgs(['-n']), usage(/-n needs a value/));
});

test('-h, --help, -v, --version', () => {
  assert.equal(parseArgs(['-h']).help, true);
  assert.equal(parseArgs(['--help']).help, true);
  assert.equal(parseArgs(['-v']).version, true);
  assert.equal(parseArgs(['--version']).version, true);
});

test('an unknown option is a usage error', () => {
  assert.throws(() => parseArgs(['--nope']), usage(/unknown option "--nope"/));
  assert.throws(() => parseArgs(['-x']), usage(/unknown option "-x"/));
  assert.throws(() => parseArgs(['--nope=1']), usage(/unknown option "--nope"/));
});

test('the help text lists the format ids', () => {
  const text = helpText(['claude-code', 'other']);
  assert.match(text, /claude-code, other/);
  for (const opt of ['--output', '--stdout', '--format', '--list', '--limit', '--help', '--version']) assert.ok(text.includes(opt), opt);
});

test('--list with a session, -o, or --stdout is a usage error', () => {
  assert.throws(() => parseArgs(['--list', 'abc']), UsageError);
  assert.throws(() => parseArgs(['-l', '-o', 'x.html']), UsageError);
  assert.throws(() => parseArgs(['--stdout', '--list']), UsageError);
  assert.equal(parseArgs(['--list', '-n', '5']).limit, 5);
});
