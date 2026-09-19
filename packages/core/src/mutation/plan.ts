/**
 * The mutation run of one test case.
 *
 * Stryker has no flag that selects a single test, so the plan uses the command
 * test runner: Stryker runs the command that the plan builds, once per mutant,
 * and it reads the exit code. The command runs exactly one test case, through
 * the name filter of the runner of the workspace.
 *
 * The scope of the mutation is the source file that the test covers, not the
 * whole workspace. A run over one file and one test takes seconds, so the
 * command belongs in a keybinding.
 */
import type { CommandSpec, Platform } from '../ports.js';
import { join, relative } from '../paths.js';
import { applyTemplate, quote } from '../shell.js';
import { titlePattern, type TestCase } from '../tests/cases.js';
import { testCommandFor, type TestFramework } from './framework.js';

export interface MutationPlanInput {
	workspaceRoot: string;
	/** The test file, absolute. */
	testFile: string;
	testCase: TestCase;
	/** The source files to mutate, absolute. */
	mutate: string[];
	framework: TestFramework;
	platform: Platform;
	/** Where Stryker writes the report, relative to the root. */
	reportDirectory?: string;
	/** The whole Stryker command line. `${...}` placeholders fill in. */
	commandTemplate?: string;
	/** `full` joins the suite titles into the pattern. */
	namePatternScope?: 'leaf' | 'full';
	concurrency?: number;
	extraArgs?: string[];
}

export interface MutationPlan {
	command: CommandSpec;
	/** The json report that the run writes. */
	reportFile: string;
	/** The command that Stryker runs once per mutant. */
	innerCommand: string;
	testNamePattern: string;
	/** The mutation scope, as Stryker reads it: paths relative to the root. */
	mutate: string[];
	label: string;
	warnings: string[];
}

export const DEFAULT_REPORT_DIRECTORY = 'reports/mutation';

export const DEFAULT_COMMAND_TEMPLATE = 'npx stryker run --testRunner command --commandRunner.command ${testCommand} --mutate ${mutate} --reporters json,clear-text --logLevel info';

export function buildMutationPlan(input: MutationPlanInput): MutationPlan {
	const warnings: string[] = [];
	const reportDirectory = input.reportDirectory ?? DEFAULT_REPORT_DIRECTORY;
	const testFile = relativeToRoot(input.workspaceRoot, input.testFile);
	const mutate = input.mutate.map((file) => relativeToRoot(input.workspaceRoot, file));
	const testNamePattern = titlePattern(input.testCase, input.namePatternScope ?? 'full');

	if (input.testCase.kind !== 'case') warnings.push(`"${input.testCase.title}" is a suite, so the run covers every case in it.`);
	if (input.testCase.dynamic) warnings.push('The title of the test is dynamic, so the name filter may select more than one case.');
	if (input.framework === 'unknown') warnings.push('No test runner was detected, so the run falls back to `npm test` and it runs the whole suite.');
	if (mutate.length === 0) warnings.push('No source file was found for this test, so nothing will be mutated. Set the mutation scope by hand.');

	const innerCommand = testCommandFor(input.framework, { testFile, testNamePattern, platform: input.platform });
	const template = input.commandTemplate ?? DEFAULT_COMMAND_TEMPLATE;
	const values: Record<string, string> = {
		workspaceFolder: input.workspaceRoot,
		testCommand: quote(innerCommand, input.platform),
		testFile: quote(testFile, input.platform),
		testName: quote(input.testCase.fullTitle, input.platform),
		testNamePattern: quote(testNamePattern, input.platform),
		mutate: quote(mutate.join(','), input.platform),
		reportDirectory: quote(reportDirectory, input.platform),
	};
	const extra = [...(input.concurrency ? ['--concurrency', String(input.concurrency)] : []), ...(input.extraArgs ?? [])];
	const commandLine = [applyTemplate(template, values), ...extra].join(' ').trim();

	return {
		command: {
			label: `Mutation test: ${input.testCase.fullTitle || input.testCase.title}`,
			commandLine,
			cwd: input.workspaceRoot,
		},
		reportFile: join(input.workspaceRoot, reportDirectory, 'mutation.json'),
		innerCommand,
		testNamePattern,
		mutate,
		label: input.testCase.fullTitle || input.testCase.title,
		warnings,
	};
}

/** Stryker reads a glob relative to its working directory. */
function relativeToRoot(root: string, file: string): string {
	const result = relative(root, file);
	return result.startsWith('..') ? file : result;
}
