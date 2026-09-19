/**
 * The test cases of a file, read from the syntax.
 *
 * The extension must answer two questions: which test case holds the cursor,
 * and what pattern selects that case on a command line. Both answers come from
 * the same walk. The walk knows `describe`, `suite`, `context`, `it` and
 * `test`, with the `.only`, `.skip`, `.todo`, `.each`, `.concurrent`,
 * `.sequential` and `.failing` modifiers, so it fits Vitest, Jest, Mocha and
 * the Node test runner.
 */
import type * as tsApi from 'typescript';
import type { TypeScriptApi } from '../ports.js';
import type { Position, Range } from '../model.js';
import { rangeContains } from '../model.js';
import { parseSource, rangeOfNode } from '../syntax.js';

export type TestKind = 'suite' | 'case';

const SUITE_NAMES = new Set(['describe', 'suite', 'context', 'fdescribe', 'xdescribe', 'xcontext']);
const CASE_NAMES = new Set(['it', 'test', 'fit', 'xit', 'xtest', 'specify']);
const MODIFIERS = new Set(['only', 'skip', 'todo', 'each', 'for', 'concurrent', 'sequential', 'failing', 'runIf', 'skipIf', 'extend', 'scoped']);

export interface TestCase {
	kind: TestKind;
	/** The title as written. An unreadable title gives an empty string. */
	title: string;
	/** The titles from the outermost suite down to this entry. */
	titlePath: string[];
	/** The titles joined with a space, for a message to the user. */
	fullTitle: string;
	/** True when the title holds a substitution, such as `${name}` or `%s`. */
	dynamic: boolean;
	modifiers: string[];
	range: Range;
	/** The title argument, for a "go to" jump. */
	selectionRange: Range;
	children: TestCase[];
}

export interface TestFileAnalysis {
	file: string;
	/** The top level entries. Each one holds its own children. */
	cases: TestCase[];
	hasTests: boolean;
}

export function analyzeTestSource(ts: TypeScriptApi, file: string, text: string): TestFileAnalysis {
	return analyzeTestSourceFile(ts, parseSource(ts, file, text), file);
}

export function analyzeTestSourceFile(ts: TypeScriptApi, sf: tsApi.SourceFile, file = sf.fileName): TestFileAnalysis {
	const roots: TestCase[] = [];

	function walk(node: tsApi.Node, parentPath: string[], siblings: TestCase[]): void {
		if (ts.isCallExpression(node)) {
			const call = readTestCall(ts, sf, node);
			if (call) {
				const titlePath = [...parentPath, call.title];
				const entry: TestCase = {
					kind: call.kind,
					title: call.title,
					titlePath,
					fullTitle: titlePath.filter((part) => part.length > 0).join(' '),
					dynamic: call.dynamic,
					modifiers: call.modifiers,
					range: rangeOfNode(sf, node),
					selectionRange: call.titleRange ?? rangeOfNode(sf, node),
					children: [],
				};
				siblings.push(entry);
				for (const argument of node.arguments) walk(argument, titlePath, entry.children);
				return;
			}
		}
		ts.forEachChild(node, (child) => walk(child, parentPath, siblings));
	}

	walk(sf, [], roots);
	return { file, cases: roots, hasTests: roots.length > 0 };
}

/** The innermost entry that holds the position. A case wins over its suite. */
export function testCaseAt(analysis: TestFileAnalysis, at: Position): TestCase | undefined {
	let found: TestCase | undefined;
	for (const entry of flattenCases(analysis)) {
		if (!rangeContains(entry.range, at)) continue;
		if (!found) found = entry;
		else if (entry.titlePath.length >= found.titlePath.length) found = entry;
	}
	return found;
}

export function flattenCases(analysis: TestFileAnalysis): TestCase[] {
	const out: TestCase[] = [];
	const push = (entries: TestCase[]): void => {
		for (const entry of entries) {
			out.push(entry);
			push(entry.children);
		}
	};
	push(analysis.cases);
	return out;
}

/** The case whose range holds the line, or the nearest case above it. */
export function caseCoveringLine(analysis: TestFileAnalysis, line: number): TestCase | undefined {
	const cases = flattenCases(analysis).filter((entry) => entry.kind === 'case');
	const holding = cases.filter((entry) => entry.range.start.line <= line && entry.range.end.line >= line);
	if (holding.length > 0) return holding[holding.length - 1];
	return undefined;
}

/**
 * A regular expression that selects the case on a command line.
 *
 * The parts join with `.*`, so the pattern matches a runner that joins titles
 * with a space, such as Jest, and a runner that joins them with ` > `, such as
 * Vitest.
 */
export function titlePattern(entry: TestCase, scope: 'leaf' | 'full' = 'full'): string {
	const parts = scope === 'leaf' ? [entry.title] : entry.titlePath;
	return parts
		.filter((part) => part.length > 0)
		.map((part) => escapeRegExp(part))
		.join('.*');
}

export function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface TestCall {
	kind: TestKind;
	title: string;
	titleRange?: Range;
	dynamic: boolean;
	modifiers: string[];
}

function readTestCall(ts: TypeScriptApi, sf: tsApi.SourceFile, call: tsApi.CallExpression): TestCall | undefined {
	const callee = readCallee(ts, call.expression);
	if (!callee) return undefined;
	const kind: TestKind | undefined = SUITE_NAMES.has(callee.base) ? 'suite' : CASE_NAMES.has(callee.base) ? 'case' : undefined;
	if (!kind) return undefined;
	if (callee.modifiers.some((modifier) => !MODIFIERS.has(modifier))) return undefined;

	const titleNode = call.arguments[0];
	const title = readTitle(ts, titleNode);
	if (!title) return undefined;
	const result: TestCall = { kind, title: title.text, dynamic: title.dynamic, modifiers: callee.modifiers };
	if (titleNode) result.titleRange = rangeOfNode(sf, titleNode);
	return result;
}

/** The base identifier of the callee and the modifiers between it and the call. */
function readCallee(ts: TypeScriptApi, expression: tsApi.Expression): { base: string; modifiers: string[] } | undefined {
	// `test.each(table)(...)` and `test.each`...`(...)` call the result of a call.
	let current: tsApi.Node = expression;
	if (ts.isCallExpression(current)) current = current.expression;
	else if (ts.isTaggedTemplateExpression(current)) current = current.tag;

	const modifiers: string[] = [];
	while (ts.isPropertyAccessExpression(current)) {
		modifiers.unshift(current.name.text);
		current = current.expression;
	}
	if (!ts.isIdentifier(current)) return undefined;
	return { base: current.text, modifiers };
}

function readTitle(ts: TypeScriptApi, node: tsApi.Expression | undefined): { text: string; dynamic: boolean } | undefined {
	if (!node) return undefined;
	if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
		return { text: node.text, dynamic: /%[sdifjop#%]/.test(node.text) };
	}
	if (ts.isTemplateExpression(node)) {
		// Keep the static head. It is the part that a name filter can match.
		return { text: node.head.text, dynamic: true };
	}
	return undefined;
}
