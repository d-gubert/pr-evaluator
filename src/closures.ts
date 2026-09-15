/**
 * Local closure resolution. (D17)
 *
 * The checker resolves `undoer()` to the parameter that declares it, so the
 * walk records a `function-type` stop. The values of that parameter are often
 * in one scope, in plain sight:
 *
 *     const undoSteps: Array<() => Promise<void>> = [];
 *     undoSteps.push(() => this.appSourceStorage.remove(descriptor));
 *     await Promise.all(undoSteps.map((undoer) => undoer()));
 *
 * This module reads that evidence. It resolves the callee to the arrow
 * functions the array holds, and it reports whether the evidence is complete.
 * The analysis never leaves the function that declares the array, so it needs
 * no extra program and it costs one scope walk per stop.
 */
import * as ts from 'typescript';
import { isFunctionLike, type FunctionLike } from './complexity.js';

export interface ClosureResolution {
	/** The function bodies that flow into the callee. */
	decls: FunctionLike[];
	/**
	 * True when every use of the array is a known one, and every element
	 * resolves to a body. The caller then drops the stop. False keeps the
	 * stop, because the walk found some values but maybe not all. (D14)
	 */
	complete: boolean;
}

/** Array methods that pass an element as the first callback parameter. */
const ELEMENT_FIRST = new Set(['map', 'forEach', 'filter', 'find', 'findIndex', 'findLast', 'findLastIndex', 'some', 'every', 'flatMap']);

/** Array methods that add an element. Their arguments are the values. */
const WRITERS = new Set(['push', 'unshift']);

/**
 * Array members that read without adding a value. `sort` and `reduce` are
 * absent on purpose: their callbacks do not take an element first.
 */
const READERS = new Set([
	'length', 'map', 'forEach', 'filter', 'find', 'findIndex', 'findLast', 'findLastIndex', 'some', 'every', 'flatMap',
	'reduce', 'reduceRight', 'slice', 'at', 'concat', 'join', 'indexOf', 'lastIndexOf', 'includes', 'entries', 'keys',
	'values', 'pop', 'shift', 'reverse', 'sort', 'splice', 'toString',
]);

/**
 * Resolve a `function-type` callee to the closures a local array holds.
 * Returns undefined when the call does not match the pattern, so the caller
 * keeps the stop it already has.
 */
export function resolveLocalClosures(checker: ts.TypeChecker, call: ts.CallExpression | ts.NewExpression, reasonDecls: readonly ts.Declaration[]): ClosureResolution | undefined {
	if (!ts.isIdentifier(call.expression)) return undefined;

	const decls: FunctionLike[] = [];
	let complete = true;
	let matched = false;

	for (const decl of reasonDecls) {
		const source = valueSourceOf(decl);
		if (!source) continue;
		const array = localArrayDeclaration(checker, source);
		if (!array) continue;
		matched = true;
		const held = elementsOf(checker, array);
		complete &&= held.complete;
		for (const fn of held.decls) decls.push(fn);
	}

	if (!matched) return undefined;
	return { decls: [...new Set(decls)], complete };
}

/**
 * The expression whose elements a binding takes its value from. Only the
 * callback parameter of an array method reaches here: a `for..of` binding is
 * a variable, and `resolveCallee` resolves a variable with no reason, so the
 * walk never asks us about it. See the open question in `docs/symbol-mode.md`.
 */
function valueSourceOf(decl: ts.Declaration): ts.Expression | undefined {
	if (!ts.isParameter(decl)) return undefined;
	const fn = decl.parent;
	if (!isFunctionLike(fn) || fn.parameters.indexOf(decl) !== 0) return undefined;
	const call = fn.parent;
	if (!ts.isCallExpression(call) || call.arguments[0] !== (fn as unknown as ts.Expression)) return undefined;
	const callee = call.expression;
	if (!ts.isPropertyAccessExpression(callee) || !ELEMENT_FIRST.has(callee.name.text)) return undefined;
	return callee.expression;
}

/**
 * The `const` array declaration an expression names, when the declaration is
 * an array literal in the same file. Anything else leaves the stop in place.
 */
function localArrayDeclaration(checker: ts.TypeChecker, expr: ts.Expression): ts.VariableDeclaration | undefined {
	if (!ts.isIdentifier(expr)) return undefined;
	const sym = checker.getSymbolAtLocation(expr);
	const decl = sym?.declarations?.find((d) => ts.isVariableDeclaration(d)) as ts.VariableDeclaration | undefined;
	if (!decl || !decl.initializer || !ts.isArrayLiteralExpression(decl.initializer)) return undefined;
	if (!ts.isVariableDeclarationList(decl.parent) || !(decl.parent.flags & ts.NodeFlags.Const)) return undefined;
	if (!ts.isIdentifier(decl.name)) return undefined;
	return decl;
}

/**
 * Every function the array can hold, from the initializer and from each
 * `push`. It reports the set as incomplete when the array escapes the scope,
 * or when an element is not a function this file declares.
 */
function elementsOf(checker: ts.TypeChecker, array: ts.VariableDeclaration): ClosureResolution {
	const values: ts.Expression[] = [...(array.initializer as ts.ArrayLiteralExpression).elements];
	const scope = enclosingScope(array);
	const target = checker.getSymbolAtLocation(array.name);
	let complete = true;

	const visit = (node: ts.Node): void => {
		if (ts.isIdentifier(node) && node !== array.name && checker.getSymbolAtLocation(node) === target) {
			if (!classifyUse(node, values)) complete = false;
		}
		ts.forEachChild(node, visit);
	};
	visit(scope);

	const decls: FunctionLike[] = [];
	for (const value of values) {
		const fn = functionValueOf(checker, value);
		if (fn) decls.push(fn);
		else complete = false;
	}
	return { decls, complete };
}

/**
 * Read one use of the array. A write adds its arguments to `values`. The
 * function returns false for a use that can hide a value from us.
 */
function classifyUse(use: ts.Identifier, values: ts.Expression[]): boolean {
	const parent = use.parent;
	if (ts.isForOfStatement(parent) && parent.expression === use) return true;
	if (!ts.isPropertyAccessExpression(parent) || parent.expression !== use) return false;

	const member = parent.name.text;
	if (WRITERS.has(member) && ts.isCallExpression(parent.parent) && parent.parent.expression === parent) {
		for (const arg of parent.parent.arguments) {
			if (ts.isSpreadElement(arg)) return false;
			values.push(arg);
		}
		return true;
	}
	return READERS.has(member);
}

/** The function body an element expression holds, through one `const` hop. */
function functionValueOf(checker: ts.TypeChecker, expr: ts.Expression): FunctionLike | undefined {
	const inner = ts.isParenthesizedExpression(expr) ? expr.expression : expr;
	if (isFunctionLike(inner) && inner.body) return inner;
	if (!ts.isIdentifier(inner)) return undefined;
	for (const decl of checker.getSymbolAtLocation(inner)?.declarations ?? []) {
		if (isFunctionLike(decl) && decl.body) return decl;
		if (ts.isVariableDeclaration(decl) && decl.initializer && isFunctionLike(decl.initializer) && decl.initializer.body) return decl.initializer;
	}
	return undefined;
}

/** The function that declares the array, or the file when it is top level. */
function enclosingScope(node: ts.Node): ts.Node {
	for (let cur: ts.Node | undefined = node.parent; cur; cur = cur.parent) {
		if (isFunctionLike(cur) && cur.body) return cur.body;
		if (ts.isSourceFile(cur)) return cur;
	}
	return node.getSourceFile();
}
