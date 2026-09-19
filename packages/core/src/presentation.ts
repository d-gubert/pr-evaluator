/**
 * The text that a user reads. It lives here, not in the editor adapter, so
 * every editor shows the same words.
 *
 * The strings are Markdown, because VS Code, Neovim and Emacs all render
 * Markdown in a hover.
 */
import type { FunctionComplexity } from './complexity/analyze.js';
import { DEFAULT_THRESHOLDS, type ComplexityThresholds } from './complexity/grade.js';
import type { CoveringTest } from './link/test-lookup.js';
import { basename } from './paths.js';

export function complexityHover(fn: FunctionComplexity, thresholds: ComplexityThresholds = DEFAULT_THRESHOLDS): string {
	const lines: string[] = [];
	lines.push(`**${fn.qualifiedName}** · cyclomatic complexity **${fn.total}** (${fn.grade})`);
	const parts = [`${fn.own} in the body`];
	if (fn.inline > 0) parts.push(`${fn.inline} in inline callbacks`);
	parts.push(`${fn.lineCount} lines`);
	lines.push(parts.join(' · '));
	lines.push(`Bands: simple < ${thresholds.moderate} · moderate < ${thresholds.complex} · complex < ${thresholds.critical} · critical from ${thresholds.critical}.`);
	return lines.join('\n\n');
}

export function describeCoveringTest(test: CoveringTest): string {
	const where = `${basename(test.file)}:${test.range.start.line + 1}`;
	const title = test.title ? `${test.title} — ` : '';
	return `${title}${where} (${test.confidence}: ${test.reason})`;
}

export function confidenceIcon(confidence: CoveringTest['confidence']): string {
	switch (confidence) {
		case 'exact':
			return '$(pass-filled)';
		case 'likely':
			return '$(search)';
		case 'guess':
			return '$(question)';
	}
}
