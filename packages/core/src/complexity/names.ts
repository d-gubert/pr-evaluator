/**
 * The display name of a function.
 *
 * The name comes from the syntax, not from the type checker, so it stays
 * correct in a file that does not compile yet.
 */
import type * as tsApi from 'typescript';
import type { TypeScriptApi } from '../ports.js';
import type { FunctionLike } from './counter.js';

export type FunctionKind = 'function' | 'method' | 'constructor' | 'getter' | 'setter' | 'arrow' | 'expression';

export interface FunctionName {
	/** The short name, such as `parse`. */
	name: string;
	/** The class that holds the method, when there is one. */
	container?: string;
	/** `Class.method`, or the short name when there is no container. */
	qualified: string;
	kind: FunctionKind;
}

export function describeFunction(ts: TypeScriptApi, sf: tsApi.SourceFile, fn: FunctionLike): FunctionName {
	const kind = kindOf(ts, fn);
	const container = containerOf(ts, sf, fn);
	const name = shortNameOf(ts, sf, fn, kind);
	return { name, container, qualified: container ? `${container}.${name}` : name, kind };
}

function kindOf(ts: TypeScriptApi, fn: FunctionLike): FunctionKind {
	if (ts.isFunctionDeclaration(fn)) return 'function';
	if (ts.isMethodDeclaration(fn)) return 'method';
	if (ts.isConstructorDeclaration(fn)) return 'constructor';
	if (ts.isGetAccessor(fn)) return 'getter';
	if (ts.isSetAccessor(fn)) return 'setter';
	if (ts.isArrowFunction(fn)) return 'arrow';
	return 'expression';
}

function shortNameOf(ts: TypeScriptApi, sf: tsApi.SourceFile, fn: FunctionLike, kind: FunctionKind): string {
	if (kind === 'constructor') return 'constructor';
	if (ts.isFunctionDeclaration(fn) || ts.isMethodDeclaration(fn) || ts.isGetAccessor(fn) || ts.isSetAccessor(fn)) {
		return fn.name ? fn.name.getText(sf) : 'default';
	}
	if (ts.isFunctionExpression(fn) && fn.name) return fn.name.getText(sf);
	return nameFromParent(ts, sf, fn);
}

/** An arrow and a function expression take the name of the thing that holds them. */
function nameFromParent(ts: TypeScriptApi, sf: tsApi.SourceFile, fn: FunctionLike): string {
	const parent = fn.parent;
	if (ts.isVariableDeclaration(parent) || ts.isPropertyDeclaration(parent) || ts.isPropertyAssignment(parent)) return parent.name.getText(sf);
	if (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken) return parent.left.getText(sf);
	if (ts.isExportAssignment(parent)) return 'default export';
	if (ts.isCallExpression(parent) || ts.isNewExpression(parent)) {
		const callee = parent.expression.getText(sf);
		const args: readonly tsApi.Expression[] = parent.arguments ?? [];
		const index = args.indexOf(fn as unknown as tsApi.Expression);
		return index > 0 ? `${callee}() callback #${index + 1}` : `${callee}() callback`;
	}
	if (ts.isReturnStatement(parent)) return 'returned function';
	return '(anonymous)';
}

function containerOf(ts: TypeScriptApi, sf: tsApi.SourceFile, fn: FunctionLike): string | undefined {
	for (let node: tsApi.Node | undefined = fn.parent; node; node = node.parent) {
		if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) return node.name ? node.name.getText(sf) : 'class';
		if (ts.isInterfaceDeclaration(node)) return node.name.getText(sf);
	}
	return undefined;
}
