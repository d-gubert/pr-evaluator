/**
 * One parse per document version, shared by every provider.
 *
 * The hover and the code lens ask the same question about the same file, and
 * the editor asks the code lens provider again on every edit. Without a shared
 * cache a keystroke would parse the file twice.
 *
 * The key is the document version plus the thresholds. A `TextDocument`
 * version increments on every edit, so the key is the whole invalidation
 * contract: any provider that caches something derived from a document needs
 * the same two parts.
 */
import * as vscode from 'vscode';
import { analyzeSource, type ComplexityThresholds, type FileComplexity, type TypeScriptApi } from '@complexity-lens/core';
import { corePath } from './convert.js';

/** How many documents to keep. The oldest entry goes first. */
const CACHE_LIMIT = 40;

export class AnalysisCache implements vscode.Disposable {
	private readonly entries = new Map<string, { key: string; result: FileComplexity }>();

	private readonly closed: vscode.Disposable;

	constructor(private readonly typescript: () => TypeScriptApi) {
		this.closed = vscode.workspace.onDidCloseTextDocument((document) => this.entries.delete(document.uri.toString()));
	}

	dispose(): void {
		this.closed.dispose();
		this.entries.clear();
	}

	analyze(document: vscode.TextDocument, thresholds: ComplexityThresholds): FileComplexity {
		const uri = document.uri.toString();
		const key = `${document.version}:${thresholds.moderate}:${thresholds.complex}:${thresholds.critical}`;
		const cached = this.entries.get(uri);
		if (cached && cached.key === key) return cached.result;

		const result = analyzeSource(this.typescript(), corePath(document.uri), document.getText(), { thresholds });
		// A re-set moves the entry to the end of the insertion order, so the
		// first key is always the least recently analysed one.
		this.entries.delete(uri);
		if (this.entries.size >= CACHE_LIMIT) {
			const oldest = this.entries.keys().next();
			if (!oldest.done) this.entries.delete(oldest.value);
		}
		this.entries.set(uri, { key, result });
		return result;
	}
}
