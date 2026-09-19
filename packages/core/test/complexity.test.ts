import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { analyzeSource, countingUnitAt, functionAt } from '../src/complexity/analyze.js';
import { gradeOf } from '../src/complexity/grade.js';
import { tsApi } from './helpers.js';

function analyze(text: string) {
	return analyzeSource(tsApi, '/repo/src/sample.ts', text);
}

describe('cyclomatic count', () => {
	it('starts a function at one', () => {
		const result = analyze('export function nothing(): void {}');
		assert.equal(result.functions[0]?.total, 1);
		assert.equal(result.functions[0]?.grade, 'simple');
	});

	it('counts every branch of the pinned definition', () => {
		const result = analyze(`
			export function classify(value: number): string {
				if (value < 0) return 'negative';
				if (value === 0) return 'zero';
				return value > 10 && value < 100 ? 'medium' : 'other';
			}
		`);
		const fn = result.functions[0];
		assert.equal(fn?.name, 'classify');
		assert.equal(fn?.own, 5);
		assert.equal(fn?.inline, 0);
	});

	it('does not count optional chaining, a default value or a logical assignment', () => {
		const result = analyze(`
			export function plain(input?: { a?: string }, fallback = 'x'): string {
				let out = input?.a;
				out ||= fallback;
				return out;
			}
		`);
		assert.equal(result.functions[0]?.total, 1);
	});

	it('counts a logical operator inside a default value', () => {
		const result = analyze(`export function withDefault(a: string, b = a || 'x'): string { return b; }`);
		assert.equal(result.functions[0]?.own, 2);
	});

	it('folds an anonymous callback into the caller', () => {
		const result = analyze(`
			export function run(items: number[]): number[] {
				return items.map((item) => (item > 0 ? item : -item));
			}
		`);
		const caller = result.functions.find((fn) => fn.name === 'run');
		assert.equal(caller?.own, 1);
		assert.equal(caller?.inline, 1);
		assert.equal(caller?.total, 2);
	});

	it('keeps a named nested function as a unit of its own', () => {
		const result = analyze(`
			export function outer(flag: boolean): number {
				const inner = (x: number) => (x > 0 ? 1 : 2);
				return flag ? inner(1) : 0;
			}
		`);
		const outer = result.functions.find((fn) => fn.name === 'outer');
		const inner = result.functions.find((fn) => fn.name === 'inner');
		assert.equal(outer?.own, 2);
		assert.equal(outer?.inline, 0);
		assert.equal(inner?.total, 2);
		assert.equal(inner?.isCountingUnit, true);
	});

	it('counts a case clause and a catch clause', () => {
		const result = analyze(`
			export function pick(value: string): number {
				try {
					switch (value) {
						case 'a':
							return 1;
						case 'b':
							return 2;
						default:
							return 0;
					}
				} catch {
					return -1;
				}
			}
		`);
		assert.equal(result.functions[0]?.own, 4);
	});

	it('names a method with its class', () => {
		const result = analyze(`
			export class Parser {
				parse(text: string): number { return text.length > 0 ? 1 : 0; }
				get size(): number { return 0; }
			}
		`);
		const method = result.functions.find((fn) => fn.name === 'parse');
		assert.equal(method?.qualifiedName, 'Parser.parse');
		assert.equal(method?.kind, 'method');
		const getter = result.functions.find((fn) => fn.name === 'size');
		assert.equal(getter?.kind, 'getter');
	});
});

describe('lookup by position', () => {
	const source = `
export function outer(items: number[]): number[] {
	return items.filter((item) => (item > 2 ? true : false));
}
`;

	it('finds the innermost function', () => {
		const result = analyze(source);
		const inner = functionAt(result, { line: 2, character: 32 });
		assert.equal(inner?.isCountingUnit, false);
	});

	it('reports the unit that already counts the callback', () => {
		const result = analyze(source);
		const unit = countingUnitAt(result, { line: 2, character: 32 });
		assert.equal(unit?.name, 'outer');
		assert.equal(unit?.inline, 1);
	});
});

describe('grade', () => {
	it('follows the thresholds', () => {
		assert.equal(gradeOf(5), 'simple');
		assert.equal(gradeOf(6), 'moderate');
		assert.equal(gradeOf(11), 'complex');
		assert.equal(gradeOf(21), 'critical');
		assert.equal(gradeOf(7, { moderate: 3, complex: 5, critical: 7 }), 'critical');
	});
});
