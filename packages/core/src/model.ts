/**
 * The shared vocabulary. Every type here is plain data, so an adapter can map
 * it to the types of its own editor.
 *
 * A line and a character are zero based, as in the Language Server Protocol.
 * A file is an absolute path with `/` separators, not a URI.
 */

export interface Position {
	line: number;
	character: number;
}

export interface Range {
	start: Position;
	end: Position;
}

export interface FileRange {
	file: string;
	range: Range;
}

export interface FileLocation {
	file: string;
	position: Position;
}

export function position(line: number, character = 0): Position {
	return { line, character };
}

export function range(startLine: number, startCharacter: number, endLine: number, endCharacter: number): Range {
	return { start: position(startLine, startCharacter), end: position(endLine, endCharacter) };
}

export function comparePositions(a: Position, b: Position): number {
	return a.line !== b.line ? a.line - b.line : a.character - b.character;
}

export function rangeContains(outer: Range, inner: Position): boolean {
	return comparePositions(outer.start, inner) <= 0 && comparePositions(outer.end, inner) >= 0;
}

export function rangeLineCount(r: Range): number {
	return r.end.line - r.start.line + 1;
}

/** A one based line number, the unit that every coverage report speaks. */
export function toReportLine(p: Position): number {
	return p.line + 1;
}

export function fromReportLine(line: number, character = 0): Position {
	return position(Math.max(0, line - 1), character);
}
