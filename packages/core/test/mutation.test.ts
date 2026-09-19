import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { detectFramework, detectWorkspaceFramework, testCommandFor } from '../src/mutation/framework.js';
import { buildMutationPlan } from '../src/mutation/plan.js';
import { resolveMutationScope } from '../src/mutation/scope.js';
import { summarizeMutationReport } from '../src/mutation/summary.js';
import { parseMutationReport } from '../src/coverage/mutation-report.js';
import { analyzeTestSource, flattenCases } from '../src/tests/cases.js';
import { quote } from '../src/shell.js';
import { memoryFileSystem, tsApi } from './helpers.js';

const testText = `
import { parse } from './parser';

describe('parser', () => {
	it("parses a 'quoted' number", () => {
		expect(parse('1')).toBe(1);
	});
});
`;

function firstCase(text = testText) {
	const analysis = analyzeTestSource(tsApi, '/repo/test/parser.test.ts', text);
	const entry = flattenCases(analysis).find((candidate) => candidate.kind === 'case');
	assert.ok(entry);
	return entry;
}

describe('framework detection', () => {
	it('reads the dependencies', () => {
		assert.equal(detectFramework('{"devDependencies":{"vitest":"^3.0.0"}}'), 'vitest');
		assert.equal(detectFramework('{"devDependencies":{"ts-jest":"^29"}}'), 'jest');
		assert.equal(detectFramework('{"devDependencies":{"mocha":"^10"}}'), 'mocha');
	});

	it('falls back to the test script', () => {
		assert.equal(detectFramework('{"scripts":{"test":"node --test"}}'), 'node');
		assert.equal(detectFramework('not json'), 'unknown');
		assert.equal(detectFramework(undefined), 'unknown');
	});

	it('walks up to the package that holds the test', async () => {
		const fs = memoryFileSystem({
			'/repo/package.json': '{"devDependencies":{"mocha":"^10"}}',
			'/repo/packages/app/package.json': '{"devDependencies":{"vitest":"^3"}}',
		});
		const found = await detectWorkspaceFramework(fs, '/repo', '/repo/packages/app/test/a.test.ts');
		assert.equal(found.framework, 'vitest');
		assert.equal(found.packageJsonFile, '/repo/packages/app/package.json');
		const root = await detectWorkspaceFramework(fs, '/repo', '/repo/test/a.test.ts');
		assert.equal(root.framework, 'mocha');
	});

	it('runs one case per runner', () => {
		const input = { testFile: 'test/a.test.ts', testNamePattern: 'a.*b', platform: 'posix' as const };
		assert.equal(testCommandFor('vitest', input), `npx vitest run 'test/a.test.ts' --testNamePattern 'a.*b'`);
		assert.equal(testCommandFor('jest', input), `npx jest --runTestsByPath 'test/a.test.ts' --testNamePattern 'a.*b'`);
		assert.equal(testCommandFor('mocha', input), `npx mocha 'test/a.test.ts' --grep 'a.*b'`);
		assert.equal(testCommandFor('node', input), `node --test --test-name-pattern 'a.*b' 'test/a.test.ts'`);
	});
});

describe('mutation plan', () => {
	it('nests the one case command inside the Stryker command', () => {
		const plan = buildMutationPlan({
			workspaceRoot: '/repo',
			testFile: '/repo/test/parser.test.ts',
			testCase: firstCase(),
			mutate: ['/repo/src/parser.ts'],
			framework: 'vitest',
			platform: 'posix',
		});
		assert.equal(plan.testNamePattern, `parser.*parses a 'quoted' number`);
		assert.equal(plan.innerCommand, `npx vitest run 'test/parser.test.ts' --testNamePattern 'parser.*parses a '\\''quoted'\\'' number'`);
		assert.ok(plan.command.commandLine.startsWith('npx stryker run --testRunner command --commandRunner.command '));
		assert.ok(plan.command.commandLine.includes(quote(plan.innerCommand, 'posix')));
		assert.ok(plan.command.commandLine.includes(`--mutate 'src/parser.ts'`));
		assert.equal(plan.command.cwd, '/repo');
		assert.equal(plan.reportFile, '/repo/reports/mutation/mutation.json');
		assert.deepEqual(plan.warnings, []);
	});

	it('doubles a quote on Windows', () => {
		const plan = buildMutationPlan({
			workspaceRoot: 'C:/repo',
			testFile: 'C:/repo/test/parser.test.ts',
			testCase: firstCase(),
			mutate: ['C:/repo/src/parser.ts'],
			framework: 'jest',
			platform: 'win32',
		});
		assert.ok(plan.innerCommand.includes('"test/parser.test.ts"'));
		assert.ok(plan.command.commandLine.includes('""test/parser.test.ts""'));
	});

	it('warns when nothing can be mutated and when the runner is unknown', () => {
		const plan = buildMutationPlan({
			workspaceRoot: '/repo',
			testFile: '/repo/test/parser.test.ts',
			testCase: firstCase(),
			mutate: [],
			framework: 'unknown',
			platform: 'posix',
		});
		assert.equal(plan.warnings.length, 2);
	});

	it('takes a command template from the settings', () => {
		const plan = buildMutationPlan({
			workspaceRoot: '/repo',
			testFile: '/repo/test/parser.test.ts',
			testCase: firstCase(),
			mutate: ['/repo/src/parser.ts'],
			framework: 'vitest',
			platform: 'posix',
			commandTemplate: 'pnpm stryker run --mutate ${mutate} --commandRunner.command ${testCommand}',
			concurrency: 2,
		});
		assert.ok(plan.command.commandLine.startsWith('pnpm stryker run --mutate '));
		assert.ok(plan.command.commandLine.endsWith('--concurrency 2'));
	});
});

describe('mutation scope', () => {
	it('takes the paired source file and the local imports', async () => {
		const fs = memoryFileSystem({ '/repo/src/parser.ts': 'export const parse = (t: string) => Number(t);', '/repo/test/parser.test.ts': testText });
		const scope = await resolveMutationScope({ ts: tsApi, fs }, '/repo/test/parser.test.ts', testText);
		assert.deepEqual(scope.files, ['/repo/src/parser.ts']);
	});

	it('resolves a `.js` specifier to the `.ts` file beside it', async () => {
		const text = `import { parse } from './parser.js';\nit('works', () => parse('1'));`;
		const fs = memoryFileSystem({ '/repo/src/parser.ts': 'export const parse = (t: string) => Number(t);', '/repo/src/parser.test.ts': text });
		const scope = await resolveMutationScope({ ts: tsApi, fs }, '/repo/src/parser.test.ts', text);
		assert.deepEqual(scope.files, ['/repo/src/parser.ts']);
	});

	it('says so when it finds nothing', async () => {
		const fs = memoryFileSystem({});
		const scope = await resolveMutationScope({ ts: tsApi, fs }, '/repo/test/parser.test.ts', 'it("x", () => {});');
		assert.deepEqual(scope.files, []);
		assert.match(scope.reason, /no source file/);
	});
});

describe('mutation summary', () => {
	const report = parseMutationReport(
		JSON.stringify({
			files: {
				'src/parser.ts': {
					mutants: [
						{ id: '1', mutatorName: 'EqualityOperator', location: { start: { line: 3, column: 6 }, end: { line: 3, column: 20 } }, status: 'Killed' },
						{ id: '2', mutatorName: 'BlockStatement', replacement: '{}', location: { start: { line: 4, column: 2 }, end: { line: 4, column: 22 } }, status: 'Survived' },
						{ id: '3', mutatorName: 'StringLiteral', location: { start: { line: 5, column: 1 } }, status: 'NoCoverage' },
						{ id: '4', mutatorName: 'ArithmeticOperator', location: { start: { line: 6, column: 1 } }, status: 'CompileError' },
					],
				},
				'src/other.ts': { mutants: [{ id: '5', mutatorName: 'BooleanLiteral', location: { start: { line: 1, column: 1 } }, status: 'Survived' }] },
			},
		}),
	);

	it('counts every status and scores the run', () => {
		assert.ok(report);
		const summary = summarizeMutationReport(report, ['/repo/src/parser.ts']);
		assert.equal(summary.total, 4);
		assert.equal(summary.killed, 1);
		assert.equal(summary.survived, 1);
		assert.equal(summary.noCoverage, 1);
		assert.equal(summary.errors, 1);
		assert.equal(summary.score?.toFixed(1), '33.3');
	});

	it('carries the survivors with a zero based range', () => {
		assert.ok(report);
		const summary = summarizeMutationReport(report, ['/repo/src/parser.ts']);
		assert.equal(summary.survivors.length, 1);
		assert.equal(summary.survivors[0]?.range.start.line, 3);
		assert.equal(summary.survivors[0]?.range.start.character, 1);
		assert.equal(summary.survivors[0]?.replacement, '{}');
	});
});
