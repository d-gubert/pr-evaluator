/**
 * The reference port, on the TypeScript language server of VS Code.
 *
 * `vscode.executeReferenceProvider` runs the same search as "Find All
 * References", so it follows an import, a re-export and an alias. A name
 * search over the test files cannot do that.
 */
import * as vscode from 'vscode';
import type { FileRange, Logger, ReferenceFinder } from '@complexity-lens/core';
import { coreRange, corePath, editorPosition, fileUri } from '../convert.js';

export function createReferenceFinder(logger: Logger): ReferenceFinder {
	return {
		async findReferences(location) {
			try {
				const found = await vscode.commands.executeCommand<vscode.Location[]>('vscode.executeReferenceProvider', fileUri(location.file), editorPosition(location.position));
				return (found ?? []).map<FileRange>((reference) => ({ file: corePath(reference.uri), range: coreRange(reference.range) }));
			} catch (error) {
				logger.warn(`The reference provider failed: ${String(error)}`);
				return [];
			}
		},
	};
}
