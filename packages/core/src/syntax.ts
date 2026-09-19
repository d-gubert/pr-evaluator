/**
 * One parse, shared by every feature.
 *
 * The parse needs no type checker and no program, so it costs one file read
 * and it never blocks on a project load. Parent pointers are on, because the
 * counter walks upward to find the unit that owns a callback.
 */
import type * as tsApi from 'typescript';
import type { TypeScriptApi } from './ports.js';
import type { Position, Range } from './model.js';
import { extname } from './paths.js';

export function scriptKindOf(ts: TypeScriptApi, file: string): tsApi.ScriptKind {
	switch (extname(file).toLowerCase()) {
		case '.tsx':
			return ts.ScriptKind.TSX;
		case '.jsx':
			return ts.ScriptKind.JSX;
		case '.js':
		case '.mjs':
		case '.cjs':
			return ts.ScriptKind.JS;
		default:
			return ts.ScriptKind.TS;
	}
}

export function parseSource(ts: TypeScriptApi, file: string, text: string): tsApi.SourceFile {
	return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKindOf(ts, file));
}

export function positionOfOffset(sf: tsApi.SourceFile, offset: number): Position {
	const { line, character } = sf.getLineAndCharacterOfPosition(offset);
	return { line, character };
}

export function offsetOfPosition(sf: tsApi.SourceFile, position: Position): number {
	const lineStarts = sf.getLineStarts();
	const line = Math.min(Math.max(position.line, 0), lineStarts.length - 1);
	const start = lineStarts[line] ?? 0;
	const nextLineStart = lineStarts[line + 1] ?? sf.text.length;
	return Math.min(start + position.character, Math.max(start, nextLineStart - 1));
}

/** The range of a node, comments excluded. */
export function rangeOfNode(sf: tsApi.SourceFile, node: tsApi.Node): Range {
	return {
		start: positionOfOffset(sf, node.getStart(sf)),
		end: positionOfOffset(sf, node.getEnd()),
	};
}

/** The text of a node, or an empty string when the node is absent. */
export function textOf(sf: tsApi.SourceFile, node: tsApi.Node | undefined): string {
	return node ? node.getText(sf) : '';
}
