/**
 * The cyclomatic counter. (D6)
 *
 * Pinned definition: a function starts at 1. Add 1 for each `if`, `for`,
 * `for..in`, `for..of`, `while`, `do`, `case`, `catch`, ternary, `&&`, `||`
 * and `??`. Optional chaining does not count. A default parameter does not
 * count. A logical assignment does not count.
 *
 * No library matches this definition, so we write it. ESLint's `complexity`
 * rule reports 11.1% more on apps/meteor/server and it reports no line range.
 */
import * as ts from 'typescript';

export type FunctionLike = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration | ts.GetAccessorDeclaration | ts.SetAccessorDeclaration | ts.ConstructorDeclaration;

export function isFunctionLike(node: ts.Node): node is FunctionLike {
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

function decisionPoints(node: ts.Node): number {
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
			const op = (node as ts.BinaryExpression).operatorToken.kind;
			return op === ts.SyntaxKind.AmpersandAmpersandToken || op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken ? 1 : 0;
		}
		default:
			return 0;
	}
}

export interface Count {
	/** McCabe for this function, nested functions excluded. Comparable to ESLint. */
	own: number;
	/** The sum over nested anonymous functions, such as an inline callback. */
	inline: number;
}

/**
 * Count one function. A nested *named* function is a separate unit, so its
 * count is not added here. A nested anonymous function is an inline callback,
 * and its branches belong to the caller, so `inline` carries them.
 */
export function countFunction(fn: FunctionLike): Count {
	let own = 1;
	let inline = 0;

	function nest(node: FunctionLike): void {
		if (!isAnonymousCallback(node)) return; // A named nested unit counts on its own.
		const nested = countFunction(node);
		// Its own base of 1 adds no path to the caller.
		inline += nested.own - 1 + nested.inline;
	}

	function visit(node: ts.Node): void {
		if (isFunctionLike(node)) {
			nest(node);
			return;
		}
		own += decisionPoints(node);
		ts.forEachChild(node, visit);
	}

	// A default value carries `&&`, `||` and `??`, so the parameter list counts.
	// The `=` of the default itself does not.
	for (const p of fn.parameters) if (p.initializer) visit(p.initializer);

	const body = fn.body;
	if (!body) return { own, inline };
	// A curried arrow has a function as its body: `(a) => (b) => {...}`.
	if (isFunctionLike(body)) nest(body);
	// An expression body is itself a decision point when it is `a || b`, so the
	// body node is visited, not only its children.
	else visit(body);
	return { own, inline };
}

function isAnonymousCallback(node: FunctionLike): boolean {
	if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) return false;
	const parent = node.parent;
	// `const f = () => {}` and `x.f = () => {}` declare a named unit.
	if (ts.isVariableDeclaration(parent) || ts.isPropertyDeclaration(parent) || ts.isPropertyAssignment(parent)) return false;
	if (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken) return false;
	return true;
}

/**
 * The second implementation D13 demands. It counts the decision *tokens* of a
 * whole file through `getChildren()`, so it shares no traversal and no
 * function-scoping logic with `countFunction` above. The research agent's
 * counter undercounted apps/meteor/server by 23% through an evaluation-order
 * bug in exactly that scoping logic, and only a cross-check caught it.
 *
 * The raw `ts.createScanner` is not usable here: it swallows a template
 * literal whole and it loses every token inside the substitutions.
 *
 * The source file must be parsed with `setParentNodes` true.
 */
export function countFileTokens(sf: ts.SourceFile, root: ts.Node = sf): number {
	let n = 0;
	(function visit(node: ts.Node): void {
		switch (node.kind) {
			case ts.SyntaxKind.IfKeyword:
			case ts.SyntaxKind.ForKeyword:
			case ts.SyntaxKind.WhileKeyword:
			case ts.SyntaxKind.DoKeyword:
			case ts.SyntaxKind.CaseKeyword:
			case ts.SyntaxKind.CatchKeyword:
			case ts.SyntaxKind.AmpersandAmpersandToken:
			case ts.SyntaxKind.BarBarToken:
			case ts.SyntaxKind.QuestionQuestionToken:
				n++;
				break;
			case ts.SyntaxKind.QuestionToken:
				// Only a ternary counts. An optional parameter, an optional
				// property and an optional method carry the same token.
				if (node.parent && ts.isConditionalExpression(node.parent)) n++;
				break;
			default:
				break;
		}
		for (const child of node.getChildren(sf)) visit(child);
	})(root);
	return n;
}
