/**
 * The ports, on plain Node.
 *
 * This suite is the proof that the core needs no editor: it implements the
 * three ports with `node:fs` and it runs every feature over the fixture on
 * disk. An adapter for Neovim or for Emacs writes the same 30 lines.
 */
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs/promises';
import * as nodePath from 'node:path';
import { describe, it } from 'node:test';
import * as ts from 'typescript';
import { analyzeSource, countingUnitAt } from '../src/complexity/analyze.js';
import { complexityHover } from '../src/presentation.js';
import { createTestLookup } from '../src/link/test-lookup.js';
import { buildMutationPlan } from '../src/mutation/plan.js';
import { detectWorkspaceFramework } from '../src/mutation/framework.js';
import { resolveMutationScope } from '../src/mutation/scope.js';
import { analyzeTestSource, testCaseAt } from '../src/tests/cases.js';
import { toPosix } from '../src/paths.js';
import type { FileSystem } from '../src/ports.js';

const root = toPosix(nodePath.join(__dirname, 'fixtures'));
const sourceFile = `${root}/src/pricing.ts`;
const testFile = `${root}/test/pricing.test.ts`;

const nodeFileSystem: FileSystem = {
	async readFile(file) {
		try {
			return await fs.readFile(file, 'utf8');
		} catch {
			return undefined;
		}
	},
	async exists(file) {
		try {
			await fs.stat(file);
			return true;
		} catch {
			return false;
		}
	},
	async findFiles() {
		return [];
	},
};

describe('the core on plain Node', () => {
	it('counts the function under a position and writes the hover text', async () => {
		const text = await fs.readFile(sourceFile, 'utf8');
		const analysis = analyzeSource(ts, sourceFile, text);
		// Line 8 sits inside the `reduce` callback of `total`.
		const unit = countingUnitAt(analysis, { line: 8, character: 40 });
		assert.equal(unit?.name, 'total');
		assert.equal(unit?.own, 3);
		assert.equal(unit?.inline, 1);
		assert.equal(unit?.total, 4);
		const hover = complexityHover(unit!);
		assert.match(hover, /cyclomatic complexity \*\*4\*\*/);
		assert.match(hover, /1 in inline callbacks/);
	});

	it('names the covering test from the mutation report', async () => {
		const text = await fs.readFile(sourceFile, 'utf8');
		const lookup = createTestLookup({ ts, fs: nodeFileSystem, workspaceRoot: root });
		const result = await lookup.find({ file: sourceFile, position: { line: 8, character: 4 }, sourceText: text });
		assert.equal(result.tests.length, 1);
		assert.equal(result.tests[0]?.title, 'pricing applies the tax rate');
		assert.equal(result.tests[0]?.file, testFile);
		assert.equal(result.tests[0]?.confidence, 'exact');
	});

	it('plans the mutation run of the test case under the cursor', async () => {
		const text = await fs.readFile(testFile, 'utf8');
		const testCase = testCaseAt(analyzeTestSource(ts, testFile, text), { line: 8, character: 4 });
		assert.equal(testCase?.title, 'applies the tax rate');

		const scope = await resolveMutationScope({ ts, fs: nodeFileSystem, workspaceRoot: root }, testFile, text);
		assert.deepEqual(scope.files, [sourceFile]);

		const framework = await detectWorkspaceFramework(nodeFileSystem, root, testFile);
		assert.equal(framework.framework, 'vitest');

		const plan = buildMutationPlan({
			workspaceRoot: root,
			testFile,
			testCase: testCase!,
			mutate: scope.files,
			framework: framework.framework,
			platform: 'posix',
		});
		assert.deepEqual(plan.mutate, ['src/pricing.ts']);
		assert.equal(plan.innerCommand, `npx vitest run 'test/pricing.test.ts' --testNamePattern 'pricing.*applies the tax rate'`);
		assert.equal(plan.reportFile, `${root}/reports/mutation/mutation.json`);
	});
});
