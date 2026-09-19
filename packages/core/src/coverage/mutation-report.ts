/**
 * The mutation report, in the `mutation-testing-elements` schema that Stryker
 * writes to `reports/mutation/mutation.json`.
 *
 * The report is the one input that holds *per test* coverage: every mutant
 * carries the ids of the tests that ran it, and `testFiles` carries the name
 * and the position of each test. So the report answers "which test covers this
 * line" exactly, and a mutation run of one test case produces it.
 *
 * Every line and every column in this schema is one based.
 */
import { matchesPathTail } from '../paths.js';

export interface SchemaPosition {
	line: number;
	column: number;
}

export interface SchemaLocation {
	start: SchemaPosition;
	end?: SchemaPosition;
}

export type MutantStatus = 'Killed' | 'Survived' | 'NoCoverage' | 'CompileError' | 'RuntimeError' | 'Timeout' | 'Ignored' | 'Pending';

export interface MutantResult {
	id: string;
	mutatorName: string;
	replacement?: string;
	description?: string;
	location: SchemaLocation;
	status: MutantStatus;
	coveredBy?: string[];
	killedBy?: string[];
	statusReason?: string;
}

export interface TestDefinition {
	id: string;
	name: string;
	location?: SchemaLocation;
}

export interface MutationReport {
	schemaVersion?: string;
	files: Record<string, { mutants: MutantResult[] }>;
	testFiles?: Record<string, { tests: TestDefinition[] }>;
}

export function parseMutationReport(text: string): MutationReport | undefined {
	const json = JSON.parse(text) as Partial<MutationReport>;
	if (!json || typeof json !== 'object' || !json.files) return undefined;
	return { files: json.files, ...(json.testFiles ? { testFiles: json.testFiles } : {}), ...(json.schemaVersion ? { schemaVersion: json.schemaVersion } : {}) };
}

export interface ReportedTest {
	/** The path as the report writes it. */
	testFile: string;
	test: TestDefinition;
	/** The mutants of the target line that this test ran. */
	mutants: MutantResult[];
}

/**
 * The tests that ran a mutant on `line` of `file`. An empty answer means the
 * report holds no mutant there, which is not the same as "no test covers it".
 */
export function testsCoveringLine(report: MutationReport, file: string, line: number): ReportedTest[] {
	const mutants = mutantsOnLine(report, file, line);
	const byTestId = new Map<string, ReportedTest>();
	for (const mutant of mutants) {
		for (const testId of mutant.coveredBy ?? []) {
			const found = findTest(report, testId);
			if (!found) continue;
			const existing = byTestId.get(testId);
			if (existing) existing.mutants.push(mutant);
			else byTestId.set(testId, { testFile: found.testFile, test: found.test, mutants: [mutant] });
		}
	}
	return [...byTestId.values()].sort((a, b) => b.mutants.length - a.mutants.length);
}

export function mutantsOnLine(report: MutationReport, file: string, line: number): MutantResult[] {
	for (const [candidate, entry] of Object.entries(report.files)) {
		if (!matchesPathTail(candidate, file)) continue;
		return entry.mutants.filter((mutant) => holdsLine(mutant.location, line));
	}
	return [];
}

export function mutantsOfFile(report: MutationReport, file: string): MutantResult[] {
	for (const [candidate, entry] of Object.entries(report.files)) {
		if (matchesPathTail(candidate, file)) return entry.mutants;
	}
	return [];
}

export function findTest(report: MutationReport, testId: string): { testFile: string; test: TestDefinition } | undefined {
	for (const [testFile, entry] of Object.entries(report.testFiles ?? {})) {
		const test = entry.tests.find((candidate) => candidate.id === testId);
		if (test) return { testFile, test };
	}
	return undefined;
}

function holdsLine(location: SchemaLocation, line: number): boolean {
	const from = location.start.line;
	const to = location.end?.line ?? from;
	return from <= line && line <= to;
}
