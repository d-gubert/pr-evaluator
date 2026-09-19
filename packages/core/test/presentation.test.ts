import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { analyzeSource } from '../src/complexity/analyze.js';
import { gradeAtLeast, GRADE_ORDER } from '../src/complexity/grade.js';
import { complexityHover, complexityLabel, complexityTooltip } from '../src/presentation.js';
import { tsApi } from './helpers.js';

const source = `
export function total(lines: number[], rate = 0): number {
	if (lines.length === 0) return 0;
	const sum = lines.reduce((carry, line) => carry + (line > 0 ? line : 0), 0);
	return rate > 0 ? sum * rate : sum;
}
`;

function unit() {
	const analysis = analyzeSource(tsApi, '/repo/src/pricing.ts', source);
	const found = analysis.functions.find((fn) => fn.name === 'total');
	assert.ok(found);
	return found;
}

describe('the short label', () => {
	it('names the count, the grade and the inline share', () => {
		const fn = unit();
		assert.equal(fn.total, 4);
		assert.equal(fn.inline, 1);
		assert.equal(complexityLabel(fn), 'complexity 4 · simple · 1 inline');
	});

	it('leaves out the inline share when there is none', () => {
		const analysis = analyzeSource(tsApi, '/repo/src/a.ts', 'export function one(): number { return 1; }');
		const fn = analysis.functions[0];
		assert.ok(fn);
		assert.equal(complexityLabel(fn), 'complexity 1 · simple');
	});

	it('spells the whole count out in the tooltip', () => {
		const tooltip = complexityTooltip(unit());
		assert.equal(tooltip, 'total: cyclomatic complexity 4 (simple, from under 6). 3 in the body, 1 in inline callbacks, 5 lines.');
		// The tooltip is plain text: no surface that shows it renders Markdown.
		assert.ok(!tooltip.includes('*'));
	});

	it('keeps the hover in Markdown, and the label out of it', () => {
		const hover = complexityHover(unit());
		assert.ok(hover.includes('**total**'));
		assert.ok(!hover.includes('complexity 4 ·'));
	});
});

describe('the grade order', () => {
	it('runs from the mildest to the worst', () => {
		assert.deepEqual([...GRADE_ORDER], ['simple', 'moderate', 'complex', 'critical']);
	});

	it('filters a view down to what is worth looking at', () => {
		assert.equal(gradeAtLeast('critical', 'complex'), true);
		assert.equal(gradeAtLeast('complex', 'complex'), true);
		assert.equal(gradeAtLeast('moderate', 'complex'), false);
		// The mildest minimum keeps everything.
		assert.ok(GRADE_ORDER.every((grade) => gradeAtLeast(grade, 'simple')));
	});
});
