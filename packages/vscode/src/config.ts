/**
 * The settings, read once per command and per hover.
 *
 * The core takes plain options, so this file is the only one that knows the
 * name of a setting.
 */
import * as vscode from 'vscode';
import { DEFAULT_REPORT_DIRECTORY, type ComplexityGrade, type ComplexityThresholds, type TestFramework, type TestLookupConfig } from '@complexity-lens/core';

export interface MutationConfig {
	testRunner: TestFramework | 'auto';
	reportDirectory: string;
	commandTemplate?: string;
	concurrency?: number;
	namePatternScope: 'full' | 'leaf';
	confirmBeforeRun: boolean;
	markSurvivors: boolean;
}

export interface CodeLensConfig {
	enabled: boolean;
	/** The mildest grade that still earns a lens. */
	minimumGrade: ComplexityGrade;
}

export interface ExtensionConfig {
	hoverEnabled: boolean;
	codeLens: CodeLensConfig;
	thresholds: ComplexityThresholds;
	testLookup: Partial<TestLookupConfig>;
	mutation: MutationConfig;
}

export function readConfig(scope?: vscode.Uri): ExtensionConfig {
	const settings = vscode.workspace.getConfiguration('complexityLens', scope);
	const commandTemplate = settings.get<string>('mutation.commandTemplate', '').trim();
	const concurrency = settings.get<number>('mutation.concurrency', 0);
	return {
		hoverEnabled: settings.get<boolean>('hover.enabled', true),
		codeLens: {
			enabled: settings.get<boolean>('codeLens.enabled', true),
			minimumGrade: settings.get<ComplexityGrade>('codeLens.minimumGrade', 'simple'),
		},
		thresholds: {
			moderate: settings.get<number>('complexity.moderateThreshold', 6),
			complex: settings.get<number>('complexity.complexThreshold', 11),
			critical: settings.get<number>('complexity.criticalThreshold', 21),
		},
		testLookup: {
			mutationReportPaths: settings.get<string[]>('testLookup.mutationReportPaths', ['reports/mutation/mutation.json']),
			coveragePaths: settings.get<string[]>('testLookup.coveragePaths', ['coverage/coverage-final.json', 'coverage/lcov.info']),
			useReferences: settings.get<boolean>('testLookup.useReferences', true),
		},
		mutation: {
			testRunner: settings.get<MutationConfig['testRunner']>('mutation.testRunner', 'auto'),
			reportDirectory: settings.get<string>('mutation.reportDirectory', DEFAULT_REPORT_DIRECTORY),
			...(commandTemplate ? { commandTemplate } : {}),
			...(concurrency > 0 ? { concurrency } : {}),
			namePatternScope: settings.get<'full' | 'leaf'>('mutation.namePatternScope', 'full'),
			confirmBeforeRun: settings.get<boolean>('mutation.confirmBeforeRun', true),
			markSurvivors: settings.get<boolean>('mutation.markSurvivors', true),
		},
	};
}
