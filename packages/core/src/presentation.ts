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

/**
 * The short label of a count, for a place with one line and no Markdown: a
 * code lens, a status bar, a gutter, a virtual-text hint.
 *
 * It names no function, because every surface that shows it already sits on
 * the function.
 */
export function complexityLabel(fn: FunctionComplexity): string {
	const parts = [`complexity ${fn.total}`, fn.grade];
	if (fn.inline > 0) parts.push(`${fn.inline} inline`);
	return parts.join(' · ');
}

/** The one sentence behind that label, as plain text. */
export function complexityTooltip(fn: FunctionComplexity, thresholds: ComplexityThresholds = DEFAULT_THRESHOLDS): string {
	const parts = [`${fn.own} in the body`];
	if (fn.inline > 0) parts.push(`${fn.inline} in inline callbacks`);
	parts.push(`${fn.lineCount} lines`);
	return `${fn.qualifiedName}: cyclomatic complexity ${fn.total} (${fn.grade}, from ${bandOf(fn.grade, thresholds)}). ${parts.join(', ')}.`;
}

function bandOf(grade: FunctionComplexity['grade'], thresholds: ComplexityThresholds): string {
	switch (grade) {
		case 'simple':
			return `under ${thresholds.moderate}`;
		case 'moderate':
			return `${thresholds.moderate}`;
		case 'complex':
			return `${thresholds.complex}`;
		case 'critical':
			return `${thresholds.critical}`;
	}
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
