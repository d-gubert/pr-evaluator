/**
 * The test runner of the workspace, and the command that runs one test case
 * with it.
 *
 * The detection reads `package.json` only. A wrong guess is not fatal: the
 * command is a setting, and the plan carries a warning.
 */
import type { FileSystem, Platform } from '../ports.js';
import { dirname, join, samePath } from '../paths.js';
import { quote } from '../shell.js';

export type TestFramework = 'vitest' | 'jest' | 'mocha' | 'node' | 'unknown';

export function detectFramework(packageJsonText: string | undefined): TestFramework {
	if (!packageJsonText) return 'unknown';
	let json: PackageJson;
	try {
		json = JSON.parse(packageJsonText) as PackageJson;
	} catch {
		return 'unknown';
	}
	const dependencies = { ...json.dependencies, ...json.devDependencies };
	if (dependencies['vitest']) return 'vitest';
	if (dependencies['jest'] || dependencies['ts-jest'] || dependencies['@jest/core']) return 'jest';
	if (dependencies['mocha']) return 'mocha';
	const testScript = json.scripts?.['test'] ?? '';
	if (/\bvitest\b/.test(testScript)) return 'vitest';
	if (/\bjest\b/.test(testScript)) return 'jest';
	if (/\bmocha\b/.test(testScript)) return 'mocha';
	if (/--test\b/.test(testScript)) return 'node';
	return 'unknown';
}

/**
 * The runner of the package that holds a file. A monorepo runs a different
 * runner per package, so the search starts at the file and it walks up to the
 * workspace root.
 */
export async function detectWorkspaceFramework(fs: FileSystem, root: string, from: string): Promise<{ framework: TestFramework; packageJsonFile?: string }> {
	let directory = dirname(from);
	for (let depth = 0; depth < 20; depth++) {
		const candidate = join(directory, 'package.json');
		const text = await fs.readFile(candidate);
		if (text) {
			const framework = detectFramework(text);
			if (framework !== 'unknown') return { framework, packageJsonFile: candidate };
		}
		const parent = dirname(directory);
		if (samePath(directory, root) || parent === directory) break;
		directory = parent;
	}
	return { framework: 'unknown' };
}

export interface TestCommandInput {
	/** The test file, relative to the workspace root. */
	testFile: string;
	/** A regular expression that selects the test case. */
	testNamePattern: string;
	platform: Platform;
}

/**
 * The command that runs one test case and that exits non-zero when the case
 * fails. Stryker runs this command once per mutant, so the exit code is the
 * whole contract.
 */
export function testCommandFor(framework: TestFramework, input: TestCommandInput): string {
	const file = quote(input.testFile, input.platform);
	const pattern = quote(input.testNamePattern, input.platform);
	switch (framework) {
		case 'vitest':
			return `npx vitest run ${file} --testNamePattern ${pattern}`;
		case 'jest':
			return `npx jest --runTestsByPath ${file} --testNamePattern ${pattern}`;
		case 'mocha':
			return `npx mocha ${file} --grep ${pattern}`;
		case 'node':
			return `node --test --test-name-pattern ${pattern} ${file}`;
		case 'unknown':
			return `npm test`;
	}
}

interface PackageJson {
	scripts?: Record<string, string>;
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
}
