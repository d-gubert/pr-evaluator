/**
 * The hover.
 *
 * The hover reports the *counting unit*. When the cursor sits in an anonymous
 * callback, the count of that callback is already inside the count of the
 * function that holds it, so the unit is the honest answer.
 */
import * as vscode from 'vscode';
import { complexityHover, countingUnitAt, functionAt, isTestFile, type FileComplexity, type Logger } from '@complexity-lens/core';
import type { AnalysisCache } from './analysis-cache.js';
import { readConfig } from './config.js';
import { corePath, corePosition, isSupported, workspaceRootOf } from './convert.js';

export class ComplexityHoverProvider implements vscode.HoverProvider {
	constructor(
		private readonly cache: AnalysisCache,
		private readonly logger: Logger,
	) {}

	provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
		const config = readConfig(document.uri);
		if (!config.hoverEnabled || !isSupported(document)) return undefined;

		let analysis: FileComplexity;
		try {
			analysis = this.cache.analyze(document, config.thresholds);
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

	private actions(document: vscode.TextDocument): string {
		const links = ['[$(beaker) Go to covering test](command:complexityLens.goToCoveringTest)'];
		if (isTestFile(corePath(document.uri), workspaceRootOf(document.uri))) links.push('[$(zap) Mutation test this case](command:complexityLens.runMutationTesting)');
		return links.join(' · ');
	}
}
