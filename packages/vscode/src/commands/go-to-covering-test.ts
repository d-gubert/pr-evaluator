/**
 * "Take me to the test that covers this line."
 *
 * The command shows one answer without a question, and a pick list when the
 * strategies find several. When nothing is found, the message carries the
 * notes of the lookup, so the user learns *why*, such as "the lcov report says
 * no test runs this line".
 */
import * as vscode from 'vscode';
import { confidenceIcon, createTestLookup, paths, type CoveringTest, type Logger, type TypeScriptApi } from '@complexity-lens/core';
import { createFileSystem } from '../adapters/file-system.js';
import { createReferenceFinder } from '../adapters/reference-finder.js';
import { readConfig } from '../config.js';
import { corePath, corePosition, editorRange, fileUri, isSupported, workspaceRootOf } from '../convert.js';

export interface CommandContext {
	typescript: () => TypeScriptApi;
	logger: Logger;
	showLog: () => void;
}

export async function goToCoveringTest(context: CommandContext): Promise<void> {
	const editor = vscode.window.activeTextEditor;
	if (!editor || !isSupported(editor.document)) {
		void vscode.window.showInformationMessage('Complexity Lens: open a TypeScript or JavaScript file first.');
		return;
	}

	const document = editor.document;
	const file = corePath(document.uri);
	const config = readConfig(document.uri);
	const lookup = createTestLookup({
		ts: context.typescript(),
		fs: createFileSystem(),
		workspaceRoot: workspaceRootOf(document.uri),
		referenceFinder: createReferenceFinder(context.logger),
		logger: context.logger,
		config: config.testLookup,
	});

	const result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: 'Complexity Lens: searching for the covering test' }, () =>
		lookup.find({ file, position: corePosition(editor.selection.active), sourceText: document.getText() }),
	);

	for (const note of result.notes) context.logger.info(note);

	if (result.tests.length === 0) {
		const target = result.target ? ` for ${result.target.qualifiedName}()` : '';
		const answer = await vscode.window.showWarningMessage(`No covering test found${target}. ${result.notes.join(' ')}`.trim(), 'Show Log');
		if (answer === 'Show Log') context.showLog();
		return;
	}

	const chosen = result.tests.length === 1 ? result.tests[0] : await pick(result.tests);
	if (chosen) await reveal(chosen);
}

async function pick(tests: CoveringTest[]): Promise<CoveringTest | undefined> {
	const items = tests.map((test) => ({
		label: `${confidenceIcon(test.confidence)} ${test.title ?? paths.basename(test.file)}`,
		description: `${paths.basename(test.file)}:${test.range.start.line + 1}`,
		detail: test.reason,
		test,
	}));
	const answer = await vscode.window.showQuickPick(items, { title: 'Tests that cover this line', matchOnDescription: true, matchOnDetail: true });
	return answer?.test;
}

async function reveal(test: CoveringTest): Promise<void> {
	const document = await vscode.workspace.openTextDocument(fileUri(test.file));
	const editor = await vscode.window.showTextDocument(document, { preview: false });
	const range = editorRange(test.range);
	editor.selection = new vscode.Selection(range.start, range.start);
	editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}
