import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { createTestLookup } from '../src/link/test-lookup.js';
import type { FileRange } from '../src/model.js';
import type { ReferenceFinder } from '../src/ports.js';
import { memoryFileSystem, tsApi } from './helpers.js';

const sourceText = `
export function parse(text: string): number {
	if (text === '') return 0;
	return Number(text);
}
`;

const testText = `
describe('parser', () => {
	it('parses a number', () => {
		expect(parse('1')).toBe(1);
	});
});
`;

const mutationReport = JSON.stringify({
	schemaVersion: '1.0',
	files: {
		'src/parser.ts': {
			mutants: [
				{ id: 'm1', mutatorName: 'EqualityOperator', location: { start: { line: 3, column: 6 }, end: { line: 3, column: 20 } }, status: 'Killed', coveredBy: ['t1'], killedBy: ['t1'] },
				{ id: 'm2', mutatorName: 'BlockStatement', location: { start: { line: 4, column: 2 }, end: { line: 4, column: 22 } }, status: 'Survived', coveredBy: ['t1'] },
			],
		},
	},
	testFiles: {
		'test/parser.test.ts': { tests: [{ id: 't1', name: 'parser parses a number', location: { start: { line: 3, column: 2 } } }] },
	},
});

describe('test lookup', () => {
	it('reads the mutation report first, and it is exact', async () => {
		const lookup = createTestLookup({
			ts: tsApi,
			workspaceRoot: '/repo',
			fs: memoryFileSystem({
				'/repo/reports/mutation/mutation.json': mutationReport,
				'/repo/test/parser.test.ts': testText,
			}),
		});
		const result = await lookup.find({ file: '/repo/src/parser.ts', position: { line: 2, character: 4 }, sourceText });
		assert.equal(result.tests.length, 1);
		assert.equal(result.tests[0]?.confidence, 'exact');
		assert.equal(result.tests[0]?.file, '/repo/test/parser.test.ts');
		assert.equal(result.tests[0]?.title, 'parser parses a number');
		assert.equal(result.tests[0]?.range.start.line, 2);
		assert.equal(result.target?.name, 'parse');
	});

	it('asks the editor for the callers when no report exists', async () => {
		const referenceFinder: ReferenceFinder = {
			async findReferences(): Promise<FileRange[]> {
				return [{ file: '/repo/test/parser.test.ts', range: { start: { line: 3, character: 10 }, end: { line: 3, character: 15 } } }];
			},
		};
		const lookup = createTestLookup({
			ts: tsApi,
			workspaceRoot: '/repo',
			referenceFinder,
			fs: memoryFileSystem({ '/repo/test/parser.test.ts': testText }),
		});
		const result = await lookup.find({ file: '/repo/src/parser.ts', position: { line: 2, character: 4 }, sourceText });
		assert.equal(result.tests[0]?.confidence, 'likely');
		assert.equal(result.tests[0]?.title, 'parser parses a number');
		assert.match(result.tests[0]?.reason ?? '', /calls parse/);
	});

	it('falls back to the name convention', async () => {
		const lookup = createTestLookup({
			ts: tsApi,
			workspaceRoot: '/repo',
			fs: memoryFileSystem({ '/repo/src/parser.test.ts': testText }),
		});
		const result = await lookup.find({ file: '/repo/src/parser.ts', position: { line: 2, character: 4 }, sourceText });
		assert.equal(result.tests[0]?.file, '/repo/src/parser.test.ts');
		assert.equal(result.tests[0]?.confidence, 'likely');
	});

	it('reports the line coverage when no strategy names a test', async () => {
		const lcov = ['SF:src/parser.ts', 'DA:2,4', 'DA:3,0', 'end_of_record'].join('\n');
		const lookup = createTestLookup({
			ts: tsApi,
			workspaceRoot: '/repo',
			fs: memoryFileSystem({ '/repo/coverage/lcov.info': lcov }),
		});
		const result = await lookup.find({ file: '/repo/src/parser.ts', position: { line: 2, character: 4 }, sourceText });
		assert.equal(result.tests.length, 0);
		assert.ok(result.notes.some((note) => note.includes('no test runs this line')));
	});

	it('answers with the test itself when the cursor sits in a test file', async () => {
		const lookup = createTestLookup({ ts: tsApi, workspaceRoot: '/repo', fs: memoryFileSystem({}) });
		const result = await lookup.find({ file: '/repo/test/parser.test.ts', position: { line: 3, character: 6 }, sourceText: testText });
		assert.equal(result.tests[0]?.title, 'parser parses a number');
		assert.equal(result.tests[0]?.confidence, 'exact');
	});
});
