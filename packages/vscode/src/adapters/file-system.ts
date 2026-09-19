/**
 * The file system port, on `vscode.workspace.fs`.
 *
 * The API of VS Code reads a file that no editor has open, it follows the
 * remote file systems of a Dev Container or of SSH, and it works in the web
 * host. `node:fs` does none of that.
 */
import * as vscode from 'vscode';
import type { FileSystem } from '@complexity-lens/core';
import { corePath, fileUri } from '../convert.js';

export function createFileSystem(): FileSystem {
	const decoder = new TextDecoder('utf-8');
	return {
		async readFile(file) {
			// An open editor may hold changes that the disk does not have yet.
			const open = vscode.workspace.textDocuments.find((document) => corePath(document.uri) === file);
			if (open) return open.getText();
			try {
				return decoder.decode(await vscode.workspace.fs.readFile(fileUri(file)));
			} catch {
				return undefined;
			}
		},
		async exists(file) {
			try {
				await vscode.workspace.fs.stat(fileUri(file));
				return true;
			} catch {
				return false;
			}
		},
		async findFiles(glob, exclude) {
			const found = await vscode.workspace.findFiles(glob, exclude ?? '**/node_modules/**');
			return found.map((uri) => corePath(uri));
		},
	};
}
