import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FIXTURE, GOLDEN_SESSION } from '../support/paths.js';
import { formats, getFormat, detectFormat, parseSession, UnknownFormatError } from '../../src/formats/index.js';
import { claudeCode } from '../../src/formats/claude-code.js';

const fixtureText = readFileSync(FIXTURE, 'utf8');
const golden: unknown = JSON.parse(readFileSync(GOLDEN_SESSION, 'utf8'));

test('formats lists Claude Code first', () => {
  assert.equal(formats[0], claudeCode);
  for (const f of formats) {
    assert.equal(typeof f.id, 'string');
    assert.equal(typeof f.name, 'string');
    assert.equal(typeof f.detect, 'function');
    assert.equal(typeof f.parse, 'function');
  }
});

test('getFormat finds a format by id', () => {
  assert.equal(getFormat('claude-code'), claudeCode);
  assert.equal(getFormat('claude-code')?.name, 'Claude Code');
  assert.equal(getFormat('nope'), undefined);
});

test('detectFormat returns the first match', () => {
  assert.equal(detectFormat({ path: 'fixture.jsonl', head: fixtureText }), claudeCode);
  assert.equal(detectFormat({ path: 'a.jsonl', head: '{"a":1}' }), undefined);
  assert.equal(detectFormat({ path: 'a.txt', head: 'plain text' }), undefined);
});

test('parseSession detects the format when opts.format is absent', () => {
  const s = parseSession(fixtureText, { file: 'fixture.jsonl' });
  assert.deepEqual(JSON.parse(JSON.stringify(s)), golden);
});

test('parseSession uses opts.format when given', () => {
  const s = parseSession(fixtureText, { file: 'fixture.jsonl', format: 'claude-code' });
  assert.deepEqual(JSON.parse(JSON.stringify(s)), golden);
  // An explicit format skips detection.
  const forced = parseSession('not json at all', { file: 'x.log', format: 'claude-code' });
  assert.deepEqual(forced.events.map(e => e.type), ['session_start', 'session_end']);
});

test('parseSession throws UnknownFormatError for text no format matches', () => {
  assert.throws(() => parseSession('just some text', { file: 'x.txt' }), UnknownFormatError);
  assert.throws(() => parseSession('{"a":1}\n', { file: 'x.jsonl' }), UnknownFormatError);
});

test('parseSession throws UnknownFormatError for an unknown format id', () => {
  assert.throws(() => parseSession(fixtureText, { file: 'fixture.jsonl', format: 'nope' }), UnknownFormatError);
});

test('UnknownFormatError is an Error', () => {
  const e = new UnknownFormatError('x');
  assert.ok(e instanceof Error);
  assert.equal(e.name, 'UnknownFormatError');
});
