/**
 * The VS Code adapter.
 *
 * Every rule of the extension lives in `@complexity-lens/core`. This file
 * wires the core to the editor: it loads the TypeScript of VS Code, it
 * registers the hover and the two commands, and it keeps the context keys that
 * the menus and the keybindings read.
 */
import * as vscode from 'vscode';
import { isTestFile, type TypeScriptApi } from '@complexity-lens/core';
import { goToCoveringTest } from './commands/go-to-covering-test.js';
import { runMutationTesting } from './commands/run-mutation-testing.js';
import { corePath, isSupported, SUPPORTED_LANGUAGES, workspaceRootOf } from './convert.js';
import { ComplexityHoverProvider } from './hover.js';
import { createLogger } from './logging.js';
import { MutationMarks } from './mutation-marks.js';
import { loadTypeScript, resetTypeScript, TypeScriptNotFoundError } from './typescript-loader.js';

export function activate(context: vscode.ExtensionContext): void {
	const output = vscode.window.createOutputChannel('Complexity Lens');
	const logger = createLogger(output);
	const showLog = (): void => output.show(true);
	const typescript = (): TypeScriptApi => loadTypeScript(logger);

	const marks = new MutationMarks();
	const hover = new ComplexityHoverProvider(typescript, logger);
	const commandContext = { typescript, logger, showLog };

	context.subscriptions.push(
		output,
		marks,
		hover,
		vscode.languages.registerHoverProvider(documentSelector(), hover),
		vscode.commands.registerCommand('complexityLens.goToCoveringTest', () => guard(logger, showLog, () => goToCoveringTest(commandContext))),
		vscode.commands.registerCommand('complexityLens.runMutationTesting', () => guard(logger, showLog, () => runMutationTesting({ ...commandContext, marks }))),
		vscode.commands.registerCommand('complexityLens.showLog', showLog),
		vscode.window.onDidChangeActiveTextEditor((editor) => void updateContextKeys(editor)),
		// A language change closes and reopens the document, so the keys follow it.
		vscode.workspace.onDidOpenTextDocument(() => void updateContextKeys(vscode.window.activeTextEditor)),
		vscode.workspace.onDidChangeConfiguration((event) => {
			// A new tsdk means a new compiler, so the next read reloads it.
			if (event.affectsConfiguration('typescript.tsdk')) resetTypeScript();
		}),
	);

	void updateContextKeys(vscode.window.activeTextEditor);
	logger.info('Complexity Lens is active.');
}

export function deactivate(): void {
	resetTypeScript();
}

function documentSelector(): vscode.DocumentFilter[] {
	return SUPPORTED_LANGUAGES.flatMap((language) => [
		{ language, scheme: 'file' },
		{ language, scheme: 'untitled' },
	]);
}

/**
 * The context keys of the menus and the keybindings. The mutation command
 * belongs to a test file alone, so the menu entry hides everywhere else.
 */
async function updateContextKeys(editor: vscode.TextEditor | undefined): Promise<void> {
	const supported = editor !== undefined && isSupported(editor.document);
	const test = supported && editor !== undefined && isTestFile(corePath(editor.document.uri), workspaceRootOf(editor.document.uri));
	await vscode.commands.executeCommand('setContext', 'complexityLens.supportedFile', supported);
	await vscode.commands.executeCommand('setContext', 'complexityLens.testFile', test);
}

/** One place to turn a thrown error into a message that the user can act on. */
async function guard(logger: ReturnType<typeof createLogger>, showLog: () => void, run: () => Promise<void>): Promise<void> {
	try {
		await run();
	} catch (error) {
		if (error instanceof TypeScriptNotFoundError) {
			logger.error(error.message);
			const answer = await vscode.window.showErrorMessage('Complexity Lens found no TypeScript to read with. Set `typescript.tsdk`, or install TypeScript in the workspace.', 'Show Log');
			if (answer === 'Show Log') showLog();
			return;
		}
		logger.error(String(error instanceof Error ? (error.stack ?? error.message) : error));
		const answer = await vscode.window.showErrorMessage(`Complexity Lens failed: ${error instanceof Error ? error.message : String(error)}`, 'Show Log');
		if (answer === 'Show Log') showLog();
	}
}
