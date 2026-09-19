/**
 * The hover.
 *
 * Every function of the file carries its count, so the provider analyses the
 * whole file and keeps the answer until the document changes. A file of a few
 * thousand lines parses in a few milliseconds, which a hover can afford.
 *
 * The hover reports the *counting unit*. When the cursor sits in an anonymous
 * callback, the count of that callback is already inside the count of the
 * function that holds it, so the unit is the honest answer.
 */
import * as vscode from 'vscode';
import { analyzeSource, complexityHover, countingUnitAt, functionAt, isTestFile, type ComplexityThresholds, type FileComplexity, type Logger, type TypeScriptApi } from '@complexity-lens/core';
import { corePath, corePosition, isSupported, workspaceRootOf } from './convert.js';
import { readConfig } from './config.js';

const CACHE_LIMIT = 40;

export class ComplexityHoverProvider implements vscode.HoverProvider, vscode.Disposable {
	private readonly cache = new Map<string, { key: string; result: FileComplexity }>();

	private readonly closed: vscode.Disposable;

	constructor(
		private readonly typescript: () => TypeScriptApi,
		private readonly logger: Logger,
	) {
		this.closed = vscode.workspace.onDidCloseTextDocument((document) => this.cache.delete(document.uri.toString()));
	}

	dispose(): void {
		this.closed.dispose();
		this.cache.clear();
	}

	provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
		const config = readConfig(document.uri);
		if (!config.hoverEnabled || !isSupported(document)) return undefined;

		let analysis: FileComplexity;
		try {
			analysis = this.analyze(document, config.thresholds);
		} catch (error) {
			this.logger.error(`The analysis of ${document.uri.fsPath} failed: ${String(error)}`);
			return undefined;
		}

		const unit = countingUnitAt(analysis, corePosition(position));
		if (!unit) return undefined;

		const markdown = new vscode.MarkdownString(complexityHover(unit, config.thresholds), true);
		const inner = functionAt(analysis, corePosition(position));
		if (inner && inner.id !== unit.id) markdown.appendMarkdown(`\n\nThe cursor sits in an inline callback, and its branches are already inside this count.`);
		markdown.appendMarkdown(`\n\n${this.actions(document)}`);
		markdown.isTrusted = { enabledCommands: ['complexityLens.goToCoveringTest', 'complexityLens.runMutationTesting'] };
		return new vscode.Hover(markdown);
	}

	/** The analysis of a document, from the cache when the document is unchanged. */
	analyze(document: vscode.TextDocument, thresholds: ComplexityThresholds): FileComplexity {
		const uri = document.uri.toString();
		const key = `${document.version}:${thresholds.moderate}:${thresholds.complex}:${thresholds.critical}`;
		const cached = this.cache.get(uri);
		if (cached && cached.key === key) return cached.result;

		const result = analyzeSource(this.typescript(), corePath(document.uri), document.getText(), { thresholds });
		if (this.cache.size >= CACHE_LIMIT) {
			const oldest = this.cache.keys().next();
			if (!oldest.done) this.cache.delete(oldest.value);
		}
		this.cache.set(uri, { key, result });
		return result;
	}

	private actions(document: vscode.TextDocument): string {
		const links = ['[$(beaker) Go to covering test](command:complexityLens.goToCoveringTest)'];
		if (isTestFile(corePath(document.uri), workspaceRootOf(document.uri))) links.push('[$(zap) Mutation test this case](command:complexityLens.runMutationTesting)');
		return links.join(' · ');
	}
}
