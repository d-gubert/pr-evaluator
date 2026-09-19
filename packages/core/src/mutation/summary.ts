/**
 * The answer of a mutation run, in the shape that a user reads.
 *
 * A survivor is the point of the run: the test passed although the code
 * changed, so the test does not check that behaviour. The summary carries
 * every survivor with its position, so the editor can mark the line.
 */
import type { Range } from '../model.js';
import { fromReportLine } from '../model.js';
import { matchesPathTail } from '../paths.js';
import type { MutantResult, MutationReport, MutantStatus } from '../coverage/mutation-report.js';

export interface ReportedMutant {
	file: string;
	range: Range;
	mutatorName: string;
	status: MutantStatus;
	replacement?: string;
	description?: string;
}

export interface MutationSummary {
	total: number;
	killed: number;
	survived: number;
	timeout: number;
	noCoverage: number;
	ignored: number;
	errors: number;
	/** Killed and timed out over every valid mutant, as a percentage. */
	score?: number;
	survivors: ReportedMutant[];
	uncovered: ReportedMutant[];
}

export function summarizeMutationReport(report: MutationReport, files?: string[]): MutationSummary {
	const summary: MutationSummary = { total: 0, killed: 0, survived: 0, timeout: 0, noCoverage: 0, ignored: 0, errors: 0, survivors: [], uncovered: [] };
	for (const [file, entry] of Object.entries(report.files)) {
		if (files && files.length > 0 && !files.some((wanted) => matchesPathTail(file, wanted))) continue;
		for (const mutant of entry.mutants) {
			summary.total++;
			switch (mutant.status) {
				case 'Killed':
					summary.killed++;
					break;
				case 'Timeout':
					summary.timeout++;
					break;
				case 'Survived':
					summary.survived++;
					summary.survivors.push(toReported(file, mutant));
					break;
				case 'NoCoverage':
					summary.noCoverage++;
					summary.uncovered.push(toReported(file, mutant));
					break;
				case 'Ignored':
					summary.ignored++;
					break;
				default:
					summary.errors++;
					break;
			}
		}
	}
	const valid = summary.killed + summary.timeout + summary.survived + summary.noCoverage;
	if (valid > 0) summary.score = ((summary.killed + summary.timeout) / valid) * 100;
	return summary;
}

export function describeSummary(summary: MutationSummary): string {
	const score = summary.score === undefined ? 'no score' : `${summary.score.toFixed(1)}% score`;
	return `${score}: ${summary.killed + summary.timeout} killed, ${summary.survived} survived, ${summary.noCoverage} uncovered, of ${summary.total} mutants`;
}

function toReported(file: string, mutant: MutantResult): ReportedMutant {
	const start = fromReportLine(mutant.location.start.line, Math.max(0, mutant.location.start.column - 1));
	const endPosition = mutant.location.end;
	const end = endPosition ? fromReportLine(endPosition.line, Math.max(0, endPosition.column - 1)) : start;
	return {
		file,
		range: { start, end },
		mutatorName: mutant.mutatorName,
		status: mutant.status,
		...(mutant.replacement ? { replacement: mutant.replacement } : {}),
		...(mutant.description ? { description: mutant.description } : {}),
	};
}
