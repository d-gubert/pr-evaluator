/**
 * "Run mutation testing on this test case."
 *
 * The run is narrow on purpose: one test case, and only the source files that
 * the test imports. That is the difference between a command you press while
 * you write a test and a nightly job.
 *
 * The run writes the json report that the "go to covering test" command reads
 * first, so every run makes the next lookup exact.
 */
import * as vscode from 'vscode';
import {
	analyzeTestSource,
	buildMutationPlan,
	describeSummary,
	detectWorkspaceFramework,
	isTestFile,
	parseMutationReport,
	paths,
	resolveMutationScope,
	summarizeMutationReport,
	testCaseAt,
	type MutationPlan,
	type TestFramework,
} from '@complexity-lens/core';
import { createFileSystem } from '../adapters/file-system.js';
import { createTaskRunner } from '../adapters/task-runner.js';
import { readConfig } from '../config.js';
import { corePath, corePosition, fileUri, isSupported, platform, workspaceRootOf } from '../convert.js';
import type { MutationMarks } from '../mutation-marks.js';
import type { CommandContext } from './go-to-covering-test.js';

export interface MutationCommandContext extends CommandContext {
	marks: MutationMarks;
}

export async function runMutationTesting(context: MutationCommandContext): Promise<void> {
	const editor = vscode.window.activeTextEditor;
	if (!editor || !isSupported(editor.document)) {
		void vscode.window.showInformationMessage('Complexity Lens: open a test file first.');
		return;
	}

	const document = editor.document;
	const file = corePath(document.uri);
	const workspaceRoot = workspaceRootOf(document.uri);
	if (!isTestFile(file, workspaceRoot)) {
		void vscode.window.showWarningMessage('Complexity Lens: this file does not look like a test file. Open the test, then run the command inside a test case.');
		return;
	}

	const ts = context.typescript();
	const text = document.getText();
	const testCase = testCaseAt(analyzeTestSource(ts, file, text), corePosition(editor.selection.active));
	if (!testCase) {
		void vscode.window.showWarningMessage('Complexity Lens: put the cursor inside a test case, then run the command again.');
		return;
	}

	const config = readConfig(document.uri);
	const fs = createFileSystem();
	const scope = await resolveMutationScope({ ts, fs, workspaceRoot }, file, text);
	context.logger.info(`The mutation scope is ${scope.files.join(', ') || '(empty)'} — ${scope.reason}.`);

	const framework = await frameworkFor(config.mutation.testRunner, fs, workspaceRoot, file);
	const plan = buildMutationPlan({
		workspaceRoot,
		testFile: file,
		testCase,
		mutate: scope.files,
		framework,
		platform: platform(),
		reportDirectory: config.mutation.reportDirectory,
		namePatternScope: config.mutation.namePatternScope,
		...(config.mutation.commandTemplate ? { commandTemplate: config.mutation.commandTemplate } : {}),
		...(config.mutation.concurrency ? { concurrency: config.mutation.concurrency } : {}),
	});
	context.logger.info(`Mutation command: ${plan.command.commandLine}`);

	if (!(await confirm(plan, config.mutation.confirmBeforeRun))) return;

	context.marks.clear(plan.mutate.map((relative) => paths.resolve(workspaceRoot, relative)));
	const result = await createTaskRunner(context.logger).run(plan.command);

	const reportText = await fs.readFile(plan.reportFile);
	if (!reportText) {
		const answer = await vscode.window.showErrorMessage(`The mutation run wrote no report (exit code ${String(result.exitCode)}). Check the terminal and the log.`, 'Show Log');
		if (answer === 'Show Log') context.showLog();
		return;
	}

	const report = parseMutationReport(reportText);
	if (!report) {
		void vscode.window.showErrorMessage(`The mutation report at ${plan.reportFile} does not parse.`);
		return;
	}

	const summary = summarizeMutationReport(report, plan.mutate);
	if (config.mutation.markSurvivors) context.marks.show(workspaceRoot, summary);
	context.logger.info(`${plan.label}: ${describeSummary(summary)}`);

	const answer = await vscode.window.showInformationMessage(`${plan.label} — ${describeSummary(summary)}`, 'Open Report', 'Show Log');
	if (answer === 'Open Report') await vscode.window.showTextDocument(fileUri(plan.reportFile));
	if (answer === 'Show Log') context.showLog();
}

async function frameworkFor(setting: TestFramework | 'auto', fs: ReturnType<typeof createFileSystem>, workspaceRoot: string, file: string): Promise<TestFramework> {
	if (setting !== 'auto') return setting;
	const found = await detectWorkspaceFramework(fs, workspaceRoot, file);
	return found.framework;
}

async function confirm(plan: MutationPlan, ask: boolean): Promise<boolean> {
	if (plan.warnings.length > 0) void vscode.window.showWarningMessage(`Complexity Lens: ${plan.warnings.join(' ')}`);
	if (!ask) return true;
	const answer = await vscode.window.showInformationMessage(`Run mutation testing on "${plan.label}"?`, {
		modal: true,
		detail: `Mutates: ${plan.mutate.join(', ') || '(nothing)'}\n\n${plan.command.commandLine}`,
	}, 'Run');
	return answer === 'Run';
}
