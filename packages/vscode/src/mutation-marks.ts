/**
 * The survivors of a mutation run, drawn in the editor.
 *
 * A survivor is a change to the source that the test did not catch, so it
 * belongs on the line that changed, not in a report that nobody opens. The
 * marks are diagnostics of severity `Information`: they are a result, not an
 * error in the code.
 */
import * as vscode from 'vscode';
import { paths, type MutationSummary, type ReportedMutant } from '@complexity-lens/core';
import { editorRange, fileUri } from './convert.js';

export class MutationMarks implements vscode.Disposable {
	private readonly diagnostics = vscode.languages.createDiagnosticCollection('complexityLens.mutation');

	dispose(): void {
		this.diagnostics.dispose();
	}

	clear(files: string[]): void {
		for (const file of files) this.diagnostics.delete(fileUri(file));
	}

	clearAll(): void {
		this.diagnostics.clear();
	}

	/** Mark every survivor and every uncovered mutant of the run. */
	show(workspaceRoot: string, summary: MutationSummary): void {
		const byFile = new Map<string, vscode.Diagnostic[]>();
		const add = (mutant: ReportedMutant, severity: vscode.DiagnosticSeverity, prefix: string): void => {
			const file = paths.resolve(workspaceRoot, mutant.file);
			const diagnostic = new vscode.Diagnostic(editorRange(mutant.range), message(prefix, mutant), severity);
			diagnostic.source = 'Complexity Lens';
			diagnostic.code = mutant.mutatorName;
			const list = byFile.get(file) ?? [];
			list.push(diagnostic);
			byFile.set(file, list);
		};

		for (const mutant of summary.survivors) add(mutant, vscode.DiagnosticSeverity.Warning, 'A mutant survived');
		for (const mutant of summary.uncovered) add(mutant, vscode.DiagnosticSeverity.Information, 'No test covered this mutant');

		for (const [file, list] of byFile) this.diagnostics.set(fileUri(file), list);
	}
}

function message(prefix: string, mutant: ReportedMutant): string {
	const change = mutant.replacement ? `: ${mutant.mutatorName} → ${short(mutant.replacement)}` : `: ${mutant.mutatorName}`;
	return `${prefix}${change}. The test still passed, so this behaviour is not checked.`;
}

function short(replacement: string): string {
	const oneLine = replacement.replace(/\s+/g, ' ').trim();
	return oneLine.length > 60 ? `${oneLine.slice(0, 57)}...` : oneLine;
}
