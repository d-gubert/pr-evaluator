/**
 * The file level answer: every function, with its count and its range.
 *
 * The analysis is one syntax walk. A hover asks for the function under the
 * cursor, and the test lookup asks for the function that owns a line, so both
 * read the same result.
 */
import type * as tsApi from 'typescript';
import type { TypeScriptApi } from '../ports.js';
import type { Position, Range } from '../model.js';
import { rangeContains, rangeLineCount } from '../model.js';
import { parseSource, rangeOfNode } from '../syntax.js';
import { countFunction, countingUnitOf, isAnonymousCallback, isFunctionLike, type FunctionLike } from './counter.js';
import { describeFunction, type FunctionKind } from './names.js';
import { DEFAULT_THRESHOLDS, gradeOf, type ComplexityGrade, type ComplexityThresholds } from './grade.js';

export interface FunctionComplexity {
	/** The index of the function in `FileComplexity.functions`. */
	id: number;
	name: string;
	container?: string;
	qualifiedName: string;
	kind: FunctionKind;
	/** The whole function, from the first modifier to the closing brace. */
	range: Range;
	/** The name alone, for a "go to" jump. */
	selectionRange: Range;
	own: number;
	inline: number;
	total: number;
	lineCount: number;
	grade: ComplexityGrade;
	/** False for an anonymous callback, whose count folds into its caller. */
	isCountingUnit: boolean;
	/** The function that reports this one. Equal to `id` for a unit. */
	countingUnitId: number;
	/** The function that encloses this one, when there is one. */
	parentId?: number;
}

export interface FileComplexity {
	file: string;
	functions: FunctionComplexity[];
	/** The highest total of a counting unit in the file. */
	peak: number;
}

export interface AnalyzeOptions {
	thresholds?: ComplexityThresholds;
}

export function analyzeSource(ts: TypeScriptApi, file: string, text: string, options: AnalyzeOptions = {}): FileComplexity {
	return analyzeSourceFile(ts, parseSource(ts, file, text), file, options);
}

export function analyzeSourceFile(ts: TypeScriptApi, sf: tsApi.SourceFile, file = sf.fileName, options: AnalyzeOptions = {}): FileComplexity {
	const thresholds = options.thresholds ?? DEFAULT_THRESHOLDS;
	const nodes: FunctionLike[] = [];
	collectFunctions(ts, sf, nodes);

	const idByNode = new Map<FunctionLike, number>();
	nodes.forEach((node, index) => idByNode.set(node, index));

	const functions = nodes.map((node, id) => {
		const count = countFunction(ts, node);
		const total = count.own + count.inline;
		const named = describeFunction(ts, sf, node);
		const nodeRange = rangeOfNode(sf, node);
		const unit = countingUnitOf(ts, node);
		const parent = enclosingCollected(ts, node, idByNode);
		const entry: FunctionComplexity = {
			id,
			name: named.name,
			qualifiedName: named.qualified,
			kind: named.kind,
			range: nodeRange,
			selectionRange: selectionRangeOf(ts, sf, node),
			own: count.own,
			inline: count.inline,
			total,
			lineCount: rangeLineCount(nodeRange),
			grade: gradeOf(total, thresholds),
			isCountingUnit: !isAnonymousCallback(ts, node),
			countingUnitId: idByNode.get(unit) ?? id,
		};
		if (named.container) entry.container = named.container;
		if (parent !== undefined) entry.parentId = parent;
		return entry;
	});

	const peak = functions.reduce((max, fn) => (fn.isCountingUnit && fn.total > max ? fn.total : max), 0);
	return { file, functions, peak };
}

/** The innermost function that holds the position. */
export function functionAt(result: FileComplexity, at: Position): FunctionComplexity | undefined {
	let found: FunctionComplexity | undefined;
	for (const fn of result.functions) {
		if (!rangeContains(fn.range, at)) continue;
		if (!found || isInside(fn.range, found.range)) found = fn;
	}
	return found;
}

/**
 * The function that the hover must report for a position: the innermost one,
 * or the unit that already counts it when the innermost is a callback.
 */
export function countingUnitAt(result: FileComplexity, at: Position): FunctionComplexity | undefined {
	const inner = functionAt(result, at);
	if (!inner) return undefined;
	return result.functions[inner.countingUnitId] ?? inner;
}

function isInside(inner: Range, outer: Range): boolean {
	return rangeContains(outer, inner.start) && rangeContains(outer, inner.end);
}

function collectFunctions(ts: TypeScriptApi, node: tsApi.Node, out: FunctionLike[]): void {
	if (isFunctionLike(ts, node)) out.push(node);
	ts.forEachChild(node, (child) => collectFunctions(ts, child, out));
}

function enclosingCollected(ts: TypeScriptApi, node: FunctionLike, ids: Map<FunctionLike, number>): number | undefined {
	for (let parent: tsApi.Node | undefined = node.parent; parent; parent = parent.parent) {
		if (isFunctionLike(ts, parent)) return ids.get(parent);
	}
	return undefined;
}

/** The name of the function, or its first token when it has no name. */
function selectionRangeOf(ts: TypeScriptApi, sf: tsApi.SourceFile, node: FunctionLike): Range {
	const named = node as { name?: tsApi.Node };
	if (named.name) return rangeOfNode(sf, named.name);
	if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && node.parent) {
		const parent = node.parent as { name?: tsApi.Node };
		if (parent.name) return rangeOfNode(sf, parent.name);
	}
	const start = rangeOfNode(sf, node).start;
	return { start, end: { line: start.line, character: start.character + 1 } };
}
