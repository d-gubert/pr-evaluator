/**
 * "Which test covers this line?"
 *
 * No single input answers the question, so three strategies run in order of
 * confidence and the first one that answers wins:
 *
 *   1. The mutation report. A mutant carries the ids of the tests that ran it,
 *      so a line maps to test names exactly. This input is exact and it is the
 *      by-product of the mutation command of this extension.
 *   2. The reference search of the editor. The TypeScript server knows every
 *      caller of the enclosing function, and a caller inside a test file is a
 *      test that covers the line. This input follows imports and re-exports.
 *   3. The name convention. `a.ts` pairs with `a.test.ts`, and a test title
 *      that holds the function name is the best entry in it.
 *
 * Line coverage never names a test, so it is not a strategy. It turns a failed
 * lookup into a clear message: the line is covered, or it is not.
 */
import type { FileSystem, Logger, ReferenceFinder, TypeScriptApi } from '../ports.js';
import { SILENT_LOGGER } from '../ports.js';
import type { Position, Range } from '../model.js';
import { fromReportLine, toReportLine } from '../model.js';
import { resolve, samePath } from '../paths.js';
import { analyzeSource, countingUnitAt, type FunctionComplexity } from '../complexity/analyze.js';
import { analyzeTestSource, caseCoveringLine, flattenCases, testCaseAt, type TestCase } from '../tests/cases.js';
import { isTestFile, testFileCandidates } from '../tests/naming.js';
import { fileEntry, hitsOfLine, NO_COVERAGE, parseCoverage, type LineCoverage } from '../coverage/line-coverage.js';
import { parseMutationReport, testsCoveringLine } from '../coverage/mutation-report.js';

export type Confidence = 'exact' | 'likely' | 'guess';

export interface CoveringTest {
	file: string;
	range: Range;
	/** The full title, when the source of the answer carries one. */
	title?: string;
	confidence: Confidence;
	/** Why this test is an answer. The user sees this text. */
	reason: string;
}

export interface TestLookupConfig {
	/** Mutation reports to read, relative to the workspace root. */
	mutationReportPaths: string[];
	/** Line coverage reports to read, relative to the workspace root. */
	coveragePaths: string[];
	/** Ask the editor for the callers of the enclosing function. */
	useReferences: boolean;
	maxResults: number;
}

export const DEFAULT_TEST_LOOKUP_CONFIG: TestLookupConfig = {
	mutationReportPaths: ['reports/mutation/mutation.json'],
	coveragePaths: ['coverage/coverage-final.json', 'coverage/lcov.info'],
	useReferences: true,
	maxResults: 25,
};

export interface TestLookupDeps {
	ts: TypeScriptApi;
	fs: FileSystem;
	workspaceRoot: string;
	referenceFinder?: ReferenceFinder;
	logger?: Logger;
	config?: Partial<TestLookupConfig>;
}

export interface TestLookupQuery {
	file: string;
	position: Position;
	sourceText: string;
}

export interface TestLookupResult {
	/** The function that owns the line, when the line sits in one. */
	target?: FunctionComplexity;
	/** The one based line that the lookup asked about. */
	line: number;
	tests: CoveringTest[];
	/** Short sentences for the user, such as the state of the coverage report. */
	notes: string[];
}

export interface TestLookup {
	find(query: TestLookupQuery): Promise<TestLookupResult>;
}

export function createTestLookup(deps: TestLookupDeps): TestLookup {
	const config = { ...DEFAULT_TEST_LOOKUP_CONFIG, ...deps.config };
	const logger = deps.logger ?? SILENT_LOGGER;

	return { find };

	async function find(query: TestLookupQuery): Promise<TestLookupResult> {
		const line = toReportLine(query.position);
		const complexity = analyzeSource(deps.ts, query.file, query.sourceText);
		const target = countingUnitAt(complexity, query.position);
		const notes: string[] = [];
		const result: TestLookupResult = { line, tests: [], notes };
		if (target) result.target = target;

		if (isTestFile(query.file, deps.workspaceRoot)) {
			const here = testCaseAt(analyzeTestSource(deps.ts, query.file, query.sourceText), query.position);
			if (here) {
				notes.push('The cursor already sits in a test file.');
				result.tests = [
					{
						file: query.file,
						range: here.selectionRange,
						title: here.fullTitle,
						confidence: 'exact',
						reason: 'the cursor is inside this test',
					},
				];
				return result;
			}
		}

		const fromMutation = await fromMutationReports(query.file, line);
		if (fromMutation.length > 0) {
			result.tests = limit(fromMutation);
			return result;
		}

		const coverage = await readLineCoverage();
		notes.push(...coverageNote(coverage, query.file, line));

		if (config.useReferences && deps.referenceFinder && target) {
			const fromReferences = await fromReferenceSearch(query.file, target);
			if (fromReferences.length > 0) {
				result.tests = limit(fromReferences);
				return result;
			}
		}

		const fromNames = await fromNameConvention(query.file, target);
		result.tests = limit(fromNames);
		if (result.tests.length === 0) notes.push('No mutation report, no caller in a test file and no test file beside the source file.');
		return result;
	}

	function limit(tests: CoveringTest[]): CoveringTest[] {
		return dedupe(tests).slice(0, config.maxResults);
	}

	/** Strategy 1. */
	async function fromMutationReports(file: string, line: number): Promise<CoveringTest[]> {
		const out: CoveringTest[] = [];
		for (const relative of config.mutationReportPaths) {
			const path = resolve(deps.workspaceRoot, relative);
			const text = await deps.fs.readFile(path);
			if (!text) continue;
			let report;
			try {
				report = parseMutationReport(text);
			} catch (error) {
				logger.warn(`The mutation report ${path} does not parse: ${String(error)}`);
				continue;
			}
			if (!report) continue;
			for (const found of testsCoveringLine(report, file, line)) {
				const start = found.test.location?.start;
				out.push({
					file: resolve(deps.workspaceRoot, found.testFile),
					range: rangeOfReportPosition(start),
					title: found.test.name,
					confidence: 'exact',
					reason: `ran ${found.mutants.length} mutant${found.mutants.length === 1 ? '' : 's'} on this line`,
				});
			}
		}
		return out;
	}

	/** Strategy 2. */
	async function fromReferenceSearch(file: string, target: FunctionComplexity): Promise<CoveringTest[]> {
		if (!deps.referenceFinder) return [];
		let references;
		try {
			references = await deps.referenceFinder.findReferences({ file, position: target.selectionRange.start });
		} catch (error) {
			logger.warn(`The reference search failed: ${String(error)}`);
			return [];
		}
		const out: CoveringTest[] = [];
		for (const reference of references) {
			if (samePath(reference.file, file) || !isTestFile(reference.file, deps.workspaceRoot)) continue;
			const text = await deps.fs.readFile(reference.file);
			if (!text) continue;
			const analysis = analyzeTestSource(deps.ts, reference.file, text);
			const holder = caseCoveringLine(analysis, reference.range.start.line);
			out.push({
				file: reference.file,
				range: holder ? holder.selectionRange : reference.range,
				...(holder ? { title: holder.fullTitle } : {}),
				confidence: 'likely',
				reason: holder ? `calls ${target.name}()` : `names ${target.name} outside a test case`,
			});
		}
		return out;
	}

	/** Strategy 3. */
	async function fromNameConvention(file: string, target: FunctionComplexity | undefined): Promise<CoveringTest[]> {
		const out: CoveringTest[] = [];
		for (const candidate of testFileCandidates(file)) {
			const text = await deps.fs.readFile(candidate);
			if (!text) continue;
			const analysis = analyzeTestSource(deps.ts, candidate, text);
			const named = target ? flattenCases(analysis).filter((entry) => mentions(entry, target.name)) : [];
			if (named.length > 0) {
				for (const entry of named) {
					out.push({
						file: candidate,
						range: entry.selectionRange,
						title: entry.fullTitle,
						confidence: 'likely',
						reason: `the title names ${target?.name ?? 'the function'}`,
					});
				}
				continue;
			}
			const first = analysis.cases[0];
			out.push({
				file: candidate,
				range: first ? first.selectionRange : { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
				...(first ? { title: first.fullTitle } : {}),
				confidence: 'guess',
				reason: 'the test file that the name convention pairs with this source file',
			});
		}
		return out;
	}

	async function readLineCoverage(): Promise<LineCoverage> {
		for (const relative of config.coveragePaths) {
			const path = resolve(deps.workspaceRoot, relative);
			const text = await deps.fs.readFile(path);
			if (!text) continue;
			try {
				return parseCoverage(path, text);
			} catch (error) {
				logger.warn(`The coverage report ${path} does not parse: ${String(error)}`);
			}
		}
		return NO_COVERAGE;
	}

	function coverageNote(coverage: LineCoverage, file: string, line: number): string[] {
		if (coverage.source === 'none') return [];
		if (!fileEntry(coverage, file)) return [`The ${coverage.source} report holds no entry for this file.`];
		const hits = hitsOfLine(coverage, file, line);
		if (hits === undefined) return [`The ${coverage.source} report holds no statement on this line.`];
		if (hits === 0) return [`The ${coverage.source} report says no test runs this line.`];
		return [`The ${coverage.source} report counts ${hits} hit${hits === 1 ? '' : 's'} on this line.`];
	}
}

function mentions(entry: TestCase, name: string): boolean {
	if (name.length < 3) return false;
	return entry.fullTitle.toLowerCase().includes(name.toLowerCase());
}

function rangeOfReportPosition(start: { line: number; column: number } | undefined): Range {
	const position: Position = start ? fromReportLine(start.line, Math.max(0, start.column - 1)) : { line: 0, character: 0 };
	return { start: position, end: position };
}

function dedupe(tests: CoveringTest[]): CoveringTest[] {
	const rank: Record<Confidence, number> = { exact: 0, likely: 1, guess: 2 };
	const byKey = new Map<string, CoveringTest>();
	for (const test of tests) {
		const key = `${test.file.toLowerCase()}:${test.range.start.line}:${test.title ?? ''}`;
		const existing = byKey.get(key);
		if (!existing || rank[test.confidence] < rank[existing.confidence]) byKey.set(key, test);
	}
	return [...byKey.values()].sort((a, b) => rank[a.confidence] - rank[b.confidence] || a.file.localeCompare(b.file) || a.range.start.line - b.range.start.line);
}
