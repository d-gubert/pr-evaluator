/**
 * The cyclomatic counter.
 *
 * Pinned definition: a function starts at 1. Add 1 for each `if`, `for`,
 * `for..in`, `for..of`, `while`, `do`, `case`, `catch`, ternary, `&&`, `||`
 * and `??`. Optional chaining does not count. A default parameter does not
 * count. A logical assignment does not count.
 *
 * The definition is pinned because no two tools agree. ESLint reports a higher
 * number on the same file and it reports no line range, so the count lives
 * here.
 */
import type * as tsApi from 'typescript';
import type { TypeScriptApi } from '../ports.js';

export type FunctionLike =
	| tsApi.FunctionDeclaration
	| tsApi.FunctionExpression
	| tsApi.ArrowFunction
	| tsApi.MethodDeclaration
	| tsApi.GetAccessorDeclaration
	| tsApi.SetAccessorDeclaration
	| tsApi.ConstructorDeclaration;

export function isFunctionLike(ts: TypeScriptApi, node: tsApi.Node): node is FunctionLike {
	return (
		ts.isFunctionDeclaration(node) ||
		ts.isFunctionExpression(node) ||
		ts.isArrowFunction(node) ||
		ts.isMethodDeclaration(node) ||
		ts.isGetAccessor(node) ||
		ts.isSetAccessor(node) ||
		ts.isConstructorDeclaration(node)
	);
}

function decisionPoints(ts: TypeScriptApi, node: tsApi.Node): number {
	switch (node.kind) {
		case ts.SyntaxKind.IfStatement:
		case ts.SyntaxKind.ForStatement:
		case ts.SyntaxKind.ForInStatement:
		case ts.SyntaxKind.ForOfStatement:
		case ts.SyntaxKind.WhileStatement:
		case ts.SyntaxKind.DoStatement:
		case ts.SyntaxKind.CaseClause:
		case ts.SyntaxKind.CatchClause:
		case ts.SyntaxKind.ConditionalExpression:
			return 1;
		case ts.SyntaxKind.BinaryExpression: {
			const operator = (node as tsApi.BinaryExpression).operatorToken.kind;
			return operator === ts.SyntaxKind.AmpersandAmpersandToken || operator === ts.SyntaxKind.BarBarToken || operator === ts.SyntaxKind.QuestionQuestionToken ? 1 : 0;
		}
		default:
			return 0;
	}
}

export interface Count {
	/** McCabe for this function alone. A nested function is excluded. */
	own: number;
	/** The sum over the nested anonymous functions, such as an inline callback. */
	inline: number;
}

/**
 * Count one function. A nested *named* function is a unit of its own, so its
 * count stays out of `own`. A nested anonymous function is an inline callback,
 * and its branches belong to the reader of the caller, so `inline` carries
 * them.
 */
export function countFunction(ts: TypeScriptApi, fn: FunctionLike): Count {
	let own = 1;
	let inline = 0;

	function nest(node: FunctionLike): void {
		if (!isAnonymousCallback(ts, node)) return; // A named nested unit counts on its own.
		const nested = countFunction(ts, node);
		// The base of 1 adds no path to the caller.
		inline += nested.own - 1 + nested.inline;
	}

	function visit(node: tsApi.Node): void {
		if (isFunctionLike(ts, node)) {
			nest(node);
			return;
		}
		own += decisionPoints(ts, node);
		ts.forEachChild(node, visit);
	}

	// A default value carries `&&`, `||` and `??`, so the parameter list counts.
	// The `=` of the default itself does not.
	for (const parameter of fn.parameters) if (parameter.initializer) visit(parameter.initializer);

	const body = fn.body;
	if (!body) return { own, inline };
	// A curried arrow has a function as its body: `(a) => (b) => {...}`.
	if (isFunctionLike(ts, body)) nest(body);
	// An expression body is a decision point itself when it is `a || b`, so the
	// body node is visited, not only its children.
	else visit(body);
	return { own, inline };
}

/**
 * The function whose count already holds `fn`. An anonymous callback folds
 * into its caller through `inline`, so the hover must report the caller.
 * Returns `fn` itself when the function is a unit of its own.
 */
export function countingUnitOf(ts: TypeScriptApi, fn: FunctionLike): FunctionLike {
	let current = fn;
	while (isAnonymousCallback(ts, current)) {
		const parent = enclosingFunction(ts, current);
		if (!parent) return current;
		current = parent;
	}
	return current;
}

export function enclosingFunction(ts: TypeScriptApi, node: tsApi.Node): FunctionLike | undefined {
	for (let parent: tsApi.Node | undefined = node.parent; parent; parent = parent.parent) {
		if (isFunctionLike(ts, parent)) return parent;
	}
	return undefined;
}

export function isAnonymousCallback(ts: TypeScriptApi, node: FunctionLike): boolean {
	if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node) || ts.isGetAccessor(node) || ts.isSetAccessor(node)) return false;
	const parent = node.parent;
	// `const f = () => {}` and `x.f = () => {}` declare a named unit.
	if (ts.isVariableDeclaration(parent) || ts.isPropertyDeclaration(parent) || ts.isPropertyAssignment(parent)) return false;
	if (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken) return false;
	if (ts.isExportAssignment(parent)) return false;
	return true;
}
