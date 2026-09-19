/**
 * The boundary between the two type systems.
 *
 * The core speaks plain paths, plain positions and plain ranges. VS Code
 * speaks `Uri`, `Position` and `Range`. Every conversion happens here, so no
 * other file has to hold both shapes in its head.
 */
import * as vscode from 'vscode';
import { paths, type Position as CorePosition, type Range as CoreRange } from '@complexity-lens/core';

/** An absolute path with `/` separators, which is what the core reads. */
export function corePath(uri: vscode.Uri): string {
	return paths.toPosix(uri.fsPath);
}

export function fileUri(file: string): vscode.Uri {
	return vscode.Uri.file(file);
}

export function corePosition(position: vscode.Position): CorePosition {
	return { line: position.line, character: position.character };
}

export function editorPosition(position: CorePosition): vscode.Position {
	return new vscode.Position(position.line, position.character);
}

export function coreRange(range: vscode.Range): CoreRange {
	return { start: corePosition(range.start), end: corePosition(range.end) };
}

export function editorRange(range: CoreRange): vscode.Range {
	return new vscode.Range(editorPosition(range.start), editorPosition(range.end));
}

/** The workspace folder that holds the file, or the folder of the file. */
export function workspaceRootOf(uri: vscode.Uri): string {
	const folder = vscode.workspace.getWorkspaceFolder(uri);
	return folder ? corePath(folder.uri) : paths.dirname(corePath(uri));
}

export const SUPPORTED_LANGUAGES = ['typescript', 'typescriptreact', 'javascript', 'javascriptreact'];

export function isSupported(document: vscode.TextDocument): boolean {
	return SUPPORTED_LANGUAGES.includes(document.languageId);
}

/** The shell family of the machine, for the quoting of a command line. */
export function platform(): 'posix' | 'win32' {
	return process.platform === 'win32' ? 'win32' : 'posix';
}
