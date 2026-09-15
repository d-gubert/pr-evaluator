/**
 * Coverage input. The tool never runs the tests. (D9)
 *
 * Input order, decided by what each format carries:
 *   1. istanbul `coverage-final.json` — preferred, it carries start and end.
 *   2. the Codecov public API — line level, no token needed for Rocket.Chat.
 *   3. `lcov.info` — last resort, `FN:<line>,<name>` carries no end line.
 *
 * All three reduce to the same normal form: file -> line -> hits. Codecov is
 * line level only, so a symbol range must come from our own AST either way.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

export type LineHits = Map<string, Map<number, number>>;

export interface CoverageReport {
	source: 'istanbul' | 'lcov' | 'codecov' | 'none';
	lines: LineHits;
	files: number;
}

export const EMPTY_COVERAGE: CoverageReport = { source: 'none', lines: new Map(), files: 0 };

export function readCoverage(root: string, file: string | undefined): CoverageReport {
	if (!file) return EMPTY_COVERAGE;
	const abs = path.resolve(file);
	if (!fs.existsSync(abs)) return EMPTY_COVERAGE;
	const text = fs.readFileSync(abs, 'utf8');
	return abs.endsWith('.json') ? readIstanbul(root, text) : readLcov(root, text);
}

function rel(root: string, file: string): string {
	return path.isAbsolute(file) ? path.relative(root, file) : file;
}

function readIstanbul(root: string, text: string): CoverageReport {
	const json = JSON.parse(text);
	const lines: LineHits = new Map();
	for (const [file, entry] of Object.entries<any>(json)) {
		const map = new Map<number, number>();
		for (const [id, loc] of Object.entries<any>(entry.statementMap ?? {})) {
			const hits = entry.s?.[id] ?? 0;
			for (let l = loc.start.line; l <= (loc.end?.line ?? loc.start.line); l++) {
				map.set(l, Math.max(map.get(l) ?? 0, hits));
			}
		}
		lines.set(rel(root, file), map);
	}
	return { source: 'istanbul', lines, files: lines.size };
}

function readLcov(root: string, text: string): CoverageReport {
	const lines: LineHits = new Map();
	let current: Map<number, number> | undefined;
	for (const line of text.split('\n')) {
		if (line.startsWith('SF:')) {
			current = new Map();
			lines.set(rel(root, line.slice(3).trim()), current);
		} else if (line.startsWith('DA:') && current) {
			const [n, hits] = line.slice(3).split(',');
			current.set(Number(n), Number(hits));
		}
	}
	return { source: 'lcov', lines, files: lines.size };
}

/**
 * Coverage of one boundary symbol: the hit ratio over the transitive internal
 * function set — the same set that D6 counts. Returns null when no report
 * covers any of those files, so the report can say "unknown". (OQ15)
 */
export function coverageOf(report: CoverageReport, ranges: { file: string; start: number; end: number }[]): number | null {
	let covered = 0;
	let total = 0;
	let known = false;
	for (const r of ranges) {
		const map = report.lines.get(r.file);
		if (!map) continue;
		known = true;
		for (let l = r.start; l <= r.end; l++) {
			const hits = map.get(l);
			if (hits === undefined) continue;
			total++;
			if (hits > 0) covered++;
		}
	}
	if (!known || total === 0) return null;
	return covered / total;
}
