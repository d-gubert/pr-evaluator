#!/usr/bin/env node
/**
 * pr-symbol — every fact the engine has about ONE symbol, on one tree.
 *
 * The diff-driven CLI (`src/cli.ts`) is untouched. This entry answers the
 * smaller question: what does the engine know about this symbol, before the
 * open questions of `docs/design.md` are answered.
 *
 * Usage:
 *   pr-symbol --repo <path> --symbol <file>#<Name>
 *   pr-symbol --symbol <file>#<Class>.<method> --edge package --compare-edges
 *   pr-symbol --symbol <Name> --html report.html
 *   pr-symbol --symbol <Name>            # a bare name searches the tree
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadConfig } from './config.js';
import { readCoverage } from './coverage.js';
import { evaluateSymbol, SymbolNotFound, type EdgeKind } from './symbol.js';
import { renderHtml } from './symbol-html.js';
import { renderDot, renderSymbol } from './symbol-report.js';

function arg(name: string, fallback?: string): string | undefined {
	const i = process.argv.indexOf(`--${name}`);
	return i === -1 ? fallback : process.argv[i + 1];
}
const flag = (name: string) => process.argv.includes(`--${name}`);

function main(): void {
	const repo = path.resolve(arg('repo') ?? process.cwd());
	const ref = arg('symbol') ?? arg('ref');
	if (!ref) {
		console.error('pr-symbol: --symbol is required. Example: --symbol src/tier1.ts#runTier1');
		console.error('           forms: <file>#<Name>, <file>#<Class>.<method>, or a bare <Name>.');
		process.exit(2);
	}
	const config = loadConfig(arg('config'));
	const log = (s: string) => console.error(s);
	const coverageFile = arg('coverage');
	const coverage = coverageFile ? readCoverage(repo, coverageFile) : undefined;

	try {
		const report = evaluateSymbol({
			root: repo,
			config,
			ref,
			edge: (arg('edge') as EdgeKind) ?? 'module',
			maxDepth: Number(arg('depth', '12')),
			maxNodes: Number(arg('max-nodes', '4000')),
			program: flag('full-program') ? 'full' : 'lazy',
			coverage,
			references: !flag('no-refs'),
			callers: !flag('no-callers'),
			callersDeep: flag('callers-deep'),
			compareEdges: flag('compare-edges'),
			followDist: flag('follow-dist'),
			treeLines: Number(arg('tree', '80')),
			log,
		});

		const jsonFile = arg('json');
		if (jsonFile) {
			fs.writeFileSync(jsonFile, JSON.stringify(report, null, 2));
			log(`json written to ${jsonFile}`);
		}
		const htmlFile = arg('html');
		if (htmlFile) {
			fs.writeFileSync(htmlFile, renderHtml(report));
			log(`html written to ${htmlFile}   open it in a browser`);
		}
		const dotFile = arg('dot');
		if (dotFile) {
			fs.writeFileSync(dotFile, renderDot(report));
			log(`dot written to ${dotFile}   render it with: dot -Tsvg ${dotFile} -o graph.svg`);
		}
		console.log(renderSymbol(report, { brief: flag('brief'), rows: Number(arg('rows', '20')) }));
	} catch (err) {
		if (err instanceof SymbolNotFound) {
			console.error(`pr-symbol: ${err.message}`);
			for (const c of err.candidates.slice(0, 40)) console.error(`  ${c}`);
			if (err.candidates.length > 40) console.error(`  ... and ${err.candidates.length - 40} more`);
			process.exit(3);
		}
		throw err;
	}
}

main();
