/** One tree, from the refs to the neutral model. (D4, D5) */
import * as path from 'node:path';
import type { Config } from './config.js';
import { readWorkspace, type Workspace } from './workspace.js';
import { runTier1, type Tier1 } from './tier1.js';
import { buildTier1Model, directDeps, indirectDeps, isTypeOnlyModule, type ModuleShape, type Tier1Model } from './modules.js';
import { runTier2, type ModuleResult } from './tier2.js';
import { coverageOf, type CoverageReport } from './coverage.js';
import type { BoundarySymbol, Confidence, ModuleId, ModuleModel, StopReason, TreeModel } from './types.js';

export interface TreeInput {
	root: string;
	ref: string;
	commit: string;
	config: Config;
	coverage: CoverageReport;
	/** Modules to analyse with tier 2. Tier 1 always covers the whole tree. */
	touched?: ModuleId[];
	log?: (s: string) => void;
}

export interface TreeOutput extends TreeModel {
	tier1: Tier1;
	graph: Tier1Model;
	timings: { workspace: number; tier1: number; model: number; tier2: number };
}

export function analyseTree(input: TreeInput): TreeOutput {
	const { root, config, log = () => {} } = input;
	let t = Date.now();
	const ws = readWorkspace(root);
	const workspaceMs = Date.now() - t;
	log(`  workspace map   ${ws.dirOf.size} packages   ${workspaceMs}ms`);

	const tier1 = runTier1(root, ws, config);
	log(`  tier 1          ${tier1.files.size} files   ${tier1.ms}ms`);

	t = Date.now();
	const graph = buildTier1Model(tier1, config);
	const modelMs = Date.now() - t;
	log(`  modules         ${graph.modules.size}   ${modelMs}ms`);

	const touched = (input.touched ?? [...graph.modules.keys()]).filter((id) => graph.modules.has(id));
	const shapes = touched.map((id) => graph.modules.get(id)!);

	t = Date.now();
	const typed = shapes.length ? runTier2(root, ws, shapes, config) : new Map<ModuleId, ModuleResult>();
	const tier2Ms = Date.now() - t;
	log(`  tier 2          ${shapes.length} modules   ${tier2Ms}ms`);

	const modules = new Map<ModuleId, ModuleModel>();
	for (const shape of shapes) {
		modules.set(shape.id, assemble(tier1, graph, shape, typed.get(shape.id), input.coverage));
	}
	return {
		ref: input.ref,
		commit: input.commit,
		root,
		modules,
		tier1,
		graph,
		timings: { workspace: workspaceMs, tier1: tier1.ms, model: modelMs, tier2: tier2Ms },
	};
}

function assemble(tier1: Tier1, graph: Tier1Model, shape: ModuleShape, typed: ModuleResult | undefined, coverage: CoverageReport): ModuleModel {
	const typeOnly = isTypeOnlyModule(tier1, shape);
	const boundary: BoundarySymbol[] = [];
	const names = new Set([...shape.declared.keys(), ...(typed?.symbols.keys() ?? [])]);

	for (const name of names) {
		const sym = typed?.symbols.get(name);
		const provided = typed?.provided.find((p) => p.name === name);
		const declaredType = shape.declared.get(name);
		const usedBy = [...(shape.usedBy.get(name) ?? [])].sort();
		for (const star of shape.starImporters) if (!usedBy.includes(star)) usedBy.push(star);
		boundary.push({
			name,
			provider: provided?.provider ?? 'exportProvider',
			file: provided?.file ?? shape.declaredIn.get(name) ?? shape.id,
			typeOnly: declaredType ?? false,
			usedBy,
			complexity: sym ? sym.complexity : null,
			complexityStops: sym?.stops ?? [],
			effects: sym?.effects ?? [],
			coverage: sym ? coverageOf(coverage, sym.ranges) : null,
		});
	}
	boundary.sort((a, b) => (b.complexity ?? 0) - (a.complexity ?? 0) || a.name.localeCompare(b.name));

	return {
		id: shape.id,
		fileCount: shape.files.length,
		typeOnly,
		boundary,
		directDeps: directDeps(shape),
		indirectDeps: indirectDeps(graph, shape.id),
		dependents: [...shape.dependents].sort(),
		totalComplexity: typed ? typed.totalComplexity : null,
		confidence: confidenceOf(shape, typed),
	};
}

/**
 * D14 says every module carries a confidence value. Open question 14 has not
 * decided whether that is a number, a set of reason tags, or both, so the
 * prototype reports both and the weights below are a placeholder.
 */
function confidenceOf(shape: ModuleShape, typed: ModuleResult | undefined): Confidence {
	const reasons: { reason: StopReason; count: number }[] = [...(typed?.stops ?? new Map())].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count);
	if (!typed) return { value: 0, reasons: [{ reason: 'no-tsconfig', count: 1 }] };
	if (typed.stops.has('no-tsconfig')) return { value: 0, reasons };

	const symbols = [...typed.symbols.values()];
	const withStops = symbols.filter((s) => s.stops.length).length;
	const stopFraction = symbols.length ? withStops / symbols.length : 0;
	const jsFraction = shape.files.length ? shape.files.filter((f) => /\.(js|jsx)$/.test(f)).length / shape.files.length : 0;
	const value = Math.max(0, Math.min(1, 1 - 0.5 * stopFraction - 0.2 * jsFraction));
	return { value: Math.round(value * 100) / 100, reasons };
}

export { path };
