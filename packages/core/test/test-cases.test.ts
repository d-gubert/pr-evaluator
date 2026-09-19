import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { analyzeTestSource, caseCoveringLine, flattenCases, testCaseAt, titlePattern } from '../src/tests/cases.js';
import { isTestFile, sourceFileCandidates, stemOf, testFileCandidates } from '../src/tests/naming.js';
import { tsApi } from './helpers.js';

const source = `
describe('math', () => {
	it('adds two numbers', () => {
		expect(add(1, 2)).toBe(3);
	});

	describe.each([1, 2])('case %s', (value) => {
		it.only('holds', () => {
			expect(value).toBeTruthy();
		});
	});
});
`;

describe('test case discovery', () => {
	const analysis = analyzeTestSource(tsApi, '/repo/test/math.test.ts', source);

	it('reads the suites and the cases', () => {
		const titles = flattenCases(analysis).map((entry) => entry.fullTitle);
		assert.deepEqual(titles, ['math', 'math adds two numbers', 'math case %s', 'math case %s holds']);
	});

	it('keeps the modifiers', () => {
		const only = flattenCases(analysis).find((entry) => entry.title === 'holds');
		assert.deepEqual(only?.modifiers, ['only']);
		const each = flattenCases(analysis).find((entry) => entry.title === 'case %s');
		assert.deepEqual(each?.modifiers, ['each']);
		assert.equal(each?.dynamic, true);
	});

	it('finds the case under the cursor', () => {
		const entry = testCaseAt(analysis, { line: 3, character: 10 });
		assert.equal(entry?.title, 'adds two numbers');
		assert.equal(entry?.kind, 'case');
	});

	it('finds the case that holds a line', () => {
		const entry = caseCoveringLine(analysis, 8);
		assert.equal(entry?.title, 'holds');
	});

	it('builds a name pattern that fits any runner', () => {
		const entry = flattenCases(analysis).find((entry) => entry.title === 'adds two numbers');
		assert.ok(entry);
		assert.equal(titlePattern(entry, 'full'), 'math.*adds two numbers');
		assert.equal(titlePattern(entry, 'leaf'), 'adds two numbers');
	});

	it('escapes a regular expression character in a title', () => {
		const analysis = analyzeTestSource(tsApi, '/repo/a.test.ts', `it('returns a.b (once)', () => {});`);
		const entry = flattenCases(analysis)[0];
		assert.ok(entry);
		assert.equal(titlePattern(entry), 'returns a\\.b \\(once\\)');
	});

	it('ignores a call that only looks like a test', () => {
		const analysis = analyzeTestSource(tsApi, '/repo/a.ts', `pattern.test('abc'); describe.custom('x', () => {});`);
		assert.equal(analysis.hasTests, false);
	});

	it('reads a template title down to its static head', () => {
		const analysis = analyzeTestSource(tsApi, '/repo/a.test.ts', 'it(`adds ${value}`, () => {});');
		const entry = flattenCases(analysis)[0];
		assert.equal(entry?.title, 'adds ');
		assert.equal(entry?.dynamic, true);
	});
});

describe('name convention', () => {
	it('knows a test file', () => {
		assert.equal(isTestFile('/repo/src/a.test.ts'), true);
		assert.equal(isTestFile('/repo/src/__tests__/a.ts'), true);
		assert.equal(isTestFile('/repo/src/a.ts'), false);
	});

	it('ignores a test directory above the workspace root', () => {
		assert.equal(isTestFile('/ci/test/repo/src/a.ts', '/ci/test/repo'), false);
		assert.equal(isTestFile('/ci/test/repo/test/a.ts', '/ci/test/repo'), true);
		assert.equal(isTestFile('/ci/test/repo/src/a.test.ts', '/ci/test/repo'), true);
	});

	it('pairs with the nearest test directory', () => {
		const candidates = sourceFileCandidates('/repo/test/pkg/test/parser.test.ts');
		assert.ok(candidates.includes('/repo/test/pkg/src/parser.ts'));
	});

	it('strips the marker from the name', () => {
		assert.equal(stemOf('/repo/src/a.spec.tsx'), 'a');
		assert.equal(stemOf('/repo/src/a.ts'), 'a');
	});

	it('offers the sibling test file first', () => {
		const candidates = testFileCandidates('/repo/src/parser.ts');
		assert.equal(candidates[0], '/repo/src/parser.test.ts');
		assert.ok(candidates.includes('/repo/src/__tests__/parser.spec.ts'));
		assert.ok(candidates.includes('/repo/test/parser.test.ts'));
	});

	it('walks back from a test file to its source file', () => {
		const candidates = sourceFileCandidates('/repo/test/parser.test.ts');
		assert.equal(candidates[0], '/repo/test/parser.ts');
		assert.ok(candidates.includes('/repo/src/parser.ts'));
	});
});
