/**
 * Line coverage input. The extension never runs the tests to get it.
 *
 * Two formats cover the field: the istanbul `coverage-final.json`, which Jest
 * and Vitest both write, and `lcov.info`, which almost every runner writes.
 * Both reduce to the same normal form: file, line, hits.
 *
 * Line coverage alone cannot say *which* test covers a line. It says whether
 * any test does, which is what turns a failed lookup into a clear message.
 */
import { matchesPathTail } from '../paths.js';

/** File to one based line to hit count. */
export type LineHits = Map<string, Map<number, number>>;

export interface LineCoverage {
	source: 'istanbul' | 'lcov' | 'none';
	lines: LineHits;
	files: number;
}

export const NO_COVERAGE: LineCoverage = { source: 'none', lines: new Map(), files: 0 };

export function parseCoverage(file: string, text: string): LineCoverage {
	return file.toLowerCase().endsWith('.json') ? parseIstanbul(text) : parseLcov(text);
}

export function parseIstanbul(text: string): LineCoverage {
	const json = JSON.parse(text) as Record<string, IstanbulFile>;
	const lines: LineHits = new Map();
	for (const [file, entry] of Object.entries(json)) {
		const map = new Map<number, number>();
		for (const [id, location] of Object.entries(entry.statementMap ?? {})) {
			const hits = entry.s?.[id] ?? 0;
			const from = location.start.line;
			const to = location.end?.line ?? from;
			for (let line = from; line <= to; line++) map.set(line, Math.max(map.get(line) ?? 0, hits));
		}
		lines.set(file, map);
	}
	return { source: 'istanbul', lines, files: lines.size };
}

export function parseLcov(text: string): LineCoverage {
	const lines: LineHits = new Map();
	let current: Map<number, number> | undefined;
	for (const raw of text.split('\n')) {
		const line = raw.trim();
		if (line.startsWith('SF:')) {
			current = new Map();
			lines.set(line.slice(3).trim(), current);
			continue;
		}
		if (!line.startsWith('DA:') || !current) continue;
		const [number, hits] = line.slice(3).split(',');
		if (number === undefined || hits === undefined) continue;
		current.set(Number(number), Number(hits));
	}
	return { source: 'lcov', lines, files: lines.size };
}

/**
 * The hits of one line, or undefined when the report says nothing about it.
 * A report writes a relative path and the editor holds an absolute one, so the
 * match is on the tail of the path.
 */
export function hitsOfLine(coverage: LineCoverage, file: string, line: number): number | undefined {
	const map = fileEntry(coverage, file);
	return map?.get(line);
}

export function fileEntry(coverage: LineCoverage, file: string): Map<number, number> | undefined {
	const direct = coverage.lines.get(file);
	if (direct) return direct;
	for (const [candidate, map] of coverage.lines) {
		if (matchesPathTail(candidate, file)) return map;
	}
	return undefined;
}

interface IstanbulFile {
	statementMap?: Record<string, { start: { line: number }; end?: { line: number } }>;
	s?: Record<string, number>;
}
