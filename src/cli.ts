#!/usr/bin/env node
/**
 * pr-evaluate — the risk of a change, as facts. (D12)
 *
 * Usage:
 *   pr-evaluate --repo <path> --base <ref> --head <ref>
 *               [--config <file>] [--coverage-head <file>] [--coverage-base <file>]
 *               [--json <file>] [--symbols <n>] [--keep-worktree]
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadConfig } from './config.js';
import { readCoverage, EMPTY_COVERAGE } from './coverage.js';
import { buildReport } from './delta.js';
import { changeSet, makeWorktree, resolveCommit, git } from './git.js';
import { moduleForFile } from './modules.js';
import { analyseTree } from './pipeline.js';
import { renderTable } from './report.js';
import type { ModuleId } from './types.js';

function arg(name: string, fallback?: string): string | undefined {
	const i = process.argv.indexOf(`--${name}`);
	return i === -1 ? fallback : process.argv[i + 1];
}
const flag = (name: string) => process.argv.includes(`--${name}`);

function main(): void {
	const repo = path.resolve(arg('repo') ?? process.cwd());
	const baseRef = arg('base');
	const headRef = arg('head') ?? 'HEAD';
	if (!baseRef) {
		console.error('pr-evaluate: --base is required. Example: --base develop --head HEAD');
		process.exit(2);
	}
	const config = loadConfig(arg('config'));
	const log = (s: string) => console.error(s);

	const baseCommit = resolveCommit(repo, baseRef);
	const headCommit = resolveCommit(repo, headRef);
	log(`base ${baseRef} ${baseCommit.slice(0, 10)}`);
	log(`head ${headRef} ${headCommit.slice(0, 10)}`);

	const change = changeSet(repo, baseCommit, headCommit);
	log(`changed files ${change.changed.length}, renames ${change.renames.length}`);

	// The touched set is the modules of the changed files, in both trees. (D1)
	const touchedSet = new Set<ModuleId>();
	for (const file of change.changed) {
		const id = moduleForFile(file, config);
		if (id) touchedSet.add(id);
	}
	const touched = [...touchedSet].sort();
	log(`touched modules ${touched.length}`);
	if (!touched.length) log('  none: no changed file sits under a module pattern of D1');

	// A rename shows as one module removed and one added. Open question 3.
	const renamedModules = new Map<string, string>();
	for (const r of change.renames) {
		const from = moduleForFile(r.from, config);
		const to = moduleForFile(r.to, config);
		if (from && to && from !== to) renamedModules.set(from, to);
	}

	const cleanups: (() => void)[] = [];
	try {
		const headRoot = resolveCommit(repo, 'HEAD') === headCommit ? repo : worktree(repo, headCommit, cleanups, 'head', log);
		const baseRoot = worktree(repo, baseCommit, cleanups, 'base', log);

		const headCoverage = readCoverage(headRoot, arg('coverage-head'));
		const baseCoverage = readCoverage(baseRoot, arg('coverage-base'));

		log('head tree:');
		const head = analyseTree({ root: headRoot, ref: headRef, commit: headCommit, config, coverage: headCoverage, touched, log });
		log('base tree:');
		const base = analyseTree({ root: baseRoot, ref: baseRef, commit: baseCommit, config, coverage: baseCoverage, touched, log });

		const dependents = new Set<ModuleId>();
		for (const id of touched) for (const d of head.graph.modules.get(id)?.dependents ?? []) if (!touchedSet.has(d)) dependents.add(d);

		const report = buildReport(base, head, touched, {
			coverage: { base: baseCoverage.source, head: headCoverage.source },
			renamed: [...renamedModules].map(([from, to]) => ({ from, to })),
			dependentsOfTouched: [...dependents].sort(),
			timings: { head: head.timings, base: base.timings },
		});

		const jsonFile = arg('json');
		if (jsonFile) {
			fs.writeFileSync(jsonFile, JSON.stringify(report, null, 2));
			log(`json written to ${jsonFile}`);
		}
		console.log(renderTable(report, { symbols: Number(arg('symbols', '6')) }));
	} finally {
		if (!flag('keep-worktree')) for (const c of cleanups) c();
	}
}

function worktree(repo: string, commit: string, cleanups: (() => void)[], label: string, log: (s: string) => void): string {
	const t = Date.now();
	const wt = makeWorktree(repo, commit);
	cleanups.push(wt.cleanup);
	log(`${label} worktree ${wt.dir}  ${Date.now() - t}ms`);
	return wt.dir;
}

main();
