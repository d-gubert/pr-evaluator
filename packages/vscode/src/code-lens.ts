/**
 * The count above each function.
 *
 * A code lens is the surface that composes. The outline does not: VS Code
 * builds one group per document symbol provider and only flattens the tree
 * when exactly one provider answers, so a second provider beside the
 * TypeScript one turns the outline into two duplicate trees. A code lens from
 * a second provider simply appears.
 *
 * The lens carries an empty command id on purpose. VS Code renders a lens with
 * a command as a link, a lens with an empty command id as plain text with a
 * tooltip, and a lens with no command at all as the placeholder "no commands".
 * A count is a fact, not an action, so plain text with a tooltip is the honest
 * rendering — the hover holds the actions.
 *
 * Only a counting unit gets a lens. An anonymous callback is already inside
 * the count of the function that holds it, so a lens on the callback would
 * report the same branches twice.
 */
import * as vscode from 'vscode';
import { complexityLabel, complexityTooltip, gradeAtLeast, type FileComplexity, type Logger } from '@complexity-lens/core';
import type { AnalysisCache } from './analysis-cache.js';
import { readConfig } from './config.js';
import { editorPosition, isSupported } from './convert.js';

export class ComplexityCodeLensProvider implements vscode.CodeLensProvider, vscode.Disposable {
	private readonly changed = new vscode.EventEmitter<void>();

	/** VS Code asks again on an edit. This event covers a settings change. */
	readonly onDidChangeCodeLenses = this.changed.event;

	private readonly configured: vscode.Disposable;

	constructor(
		private readonly cache: AnalysisCache,
		private readonly logger: Logger,
	) {
		this.configured = vscode.workspace.onDidChangeConfiguration((event) => {
			if (event.affectsConfiguration('complexityLens')) this.changed.fire();
		});
	}

	dispose(): void {
		this.configured.dispose();
		this.changed.dispose();
	}

	provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): vscode.CodeLens[] {
		const config = readConfig(document.uri);
		if (!config.codeLens.enabled || !isSupported(document)) return [];

		let analysis: FileComplexity;
		try {
			analysis = this.cache.analyze(document, config.thresholds);
		} catch (error) {
			this.logger.error(`The analysis of ${document.uri.fsPath} failed: ${String(error)}`);
			return [];
		}
		if (token.isCancellationRequested) return [];

		const lenses: vscode.CodeLens[] = [];
		for (const fn of analysis.functions) {
			if (!fn.isCountingUnit) continue;
			if (!gradeAtLeast(fn.grade, config.codeLens.minimumGrade)) continue;
			const start = editorPosition(fn.range.start);
			lenses.push(
				new vscode.CodeLens(new vscode.Range(start, start), {
					title: complexityLabel(fn),
					tooltip: complexityTooltip(fn, config.thresholds),
					command: '',
				}),
			);
		}
		return lenses;
	}
}
