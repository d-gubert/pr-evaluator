/** The delta is the head model minus the base model. (D4, D12) */
import type { BoundarySymbol, ModuleId, ModuleModel, TreeModel } from './types.js';

export interface FactDelta<T> {
	base: T;
	head: T;
	delta: T extends number ? number : undefined;
}

export interface SymbolDelta {
	name: string;
	status: 'added' | 'removed' | 'changed' | 'same';
	provider: string;
	typeOnly: boolean;
	usedBy: { base: number; head: number; delta: number };
	complexity: { base: number | null; head: number | null; delta: number | null };
	complexityStops: string[];
	effects: { base: string[]; head: string[]; added: string[]; removed: string[] };
	coverage: { base: number | null; head: number | null; delta: number | null };
}

export interface ModuleDelta {
	id: ModuleId;
	status: 'added' | 'removed' | 'changed';
	typeOnly: boolean;
	fileCount: { base: number; head: number; delta: number };
	boundary: { base: number; head: number; delta: number; symbols: SymbolDelta[] };
	/** A declared symbol that nobody imports widens the boundary for no benefit. (D2) */
	unusedExports: string[];
	directDeps: { base: number; head: number; delta: number; added: string[]; removed: string[] };
	indirectDeps: { base: number; head: number; delta: number; added: string[]; removed: string[] };
	totalComplexity: { base: number | null; head: number | null; delta: number | null };
	dependents: string[];
	confidence: { base: number; head: number; reasons: { reason: string; count: number }[] };
}

export interface Report {
	base: { ref: string; commit: string };
	head: { ref: string; commit: string };
	coverage: { base: string; head: string };
	touched: ModuleId[];
	renamed: { from: ModuleId; to: ModuleId }[];
	modules: ModuleDelta[];
	dependentsOfTouched: ModuleId[];
	timings: Record<string, unknown>;
}

const num = (b: number | null, h: number | null) => (b === null || h === null ? null : h - b);

export function diffModule(id: ModuleId, base: ModuleModel | undefined, head: ModuleModel | undefined): ModuleDelta {
	const status = !base ? 'added' : !head ? 'removed' : 'changed';
	const b = base ?? empty(id);
	const h = head ?? empty(id);
	const names = new Set([...b.boundary.map((s) => s.name), ...h.boundary.map((s) => s.name)]);
	const symbols: SymbolDelta[] = [];
	for (const name of names) {
		const bs = b.boundary.find((s) => s.name === name);
		const hs = h.boundary.find((s) => s.name === name);
		symbols.push(diffSymbol(name, bs, hs));
	}
	symbols.sort((a, b2) => Math.abs(b2.complexity.delta ?? 0) - Math.abs(a.complexity.delta ?? 0) || (b2.complexity.head ?? 0) - (a.complexity.head ?? 0));

	const bDeps = new Set(b.directDeps.map((d) => d.module));
	const hDeps = new Set(h.directDeps.map((d) => d.module));
	const bInd = new Set(b.indirectDeps.map((d) => d.module));
	const hInd = new Set(h.indirectDeps.map((d) => d.module));

	return {
		id,
		status,
		typeOnly: h.typeOnly,
		fileCount: { base: b.fileCount, head: h.fileCount, delta: h.fileCount - b.fileCount },
		boundary: { base: b.boundary.length, head: h.boundary.length, delta: h.boundary.length - b.boundary.length, symbols },
		unusedExports: h.boundary.filter((s) => !s.usedBy.length).map((s) => s.name).sort(),
		directDeps: { base: bDeps.size, head: hDeps.size, delta: hDeps.size - bDeps.size, added: [...hDeps].filter((d) => !bDeps.has(d)).sort(), removed: [...bDeps].filter((d) => !hDeps.has(d)).sort() },
		indirectDeps: { base: bInd.size, head: hInd.size, delta: hInd.size - bInd.size, added: [...hInd].filter((d) => !bInd.has(d)).sort(), removed: [...bInd].filter((d) => !hInd.has(d)).sort() },
		totalComplexity: { base: b.totalComplexity, head: h.totalComplexity, delta: num(b.totalComplexity, h.totalComplexity) },
		dependents: h.dependents,
		confidence: { base: b.confidence.value, head: h.confidence.value, reasons: h.confidence.reasons },
	};
}

function diffSymbol(name: string, b: BoundarySymbol | undefined, h: BoundarySymbol | undefined): SymbolDelta {
	const bEff = b?.effects ?? [];
	const hEff = h?.effects ?? [];
	const cBase = b?.complexity ?? null;
	const cHead = h?.complexity ?? null;
	const status = !b ? 'added' : !h ? 'removed' : cBase !== cHead || bEff.join() !== hEff.join() ? 'changed' : 'same';
	return {
		name,
		status,
		provider: (h ?? b)!.provider,
		typeOnly: (h ?? b)!.typeOnly,
		usedBy: { base: b?.usedBy.length ?? 0, head: h?.usedBy.length ?? 0, delta: (h?.usedBy.length ?? 0) - (b?.usedBy.length ?? 0) },
		complexity: { base: cBase, head: cHead, delta: num(cBase, cHead) },
		complexityStops: h?.complexityStops ?? [],
		effects: { base: bEff, head: hEff, added: hEff.filter((e) => !bEff.includes(e)), removed: bEff.filter((e) => !hEff.includes(e)) },
		coverage: { base: b?.coverage ?? null, head: h?.coverage ?? null, delta: num(b?.coverage ?? null, h?.coverage ?? null) },
	};
}

function empty(id: ModuleId): ModuleModel {
	return { id, fileCount: 0, typeOnly: false, boundary: [], directDeps: [], indirectDeps: [], dependents: [], totalComplexity: null, confidence: { value: 0, reasons: [] } };
}

export function buildReport(baseTree: TreeModel, headTree: TreeModel, touched: ModuleId[], extra: Omit<Report, 'base' | 'head' | 'touched' | 'modules'>): Report {
	const modules = touched.map((id) => diffModule(id, baseTree.modules.get(id), headTree.modules.get(id)));
	return {
		base: { ref: baseTree.ref, commit: baseTree.commit },
		head: { ref: headTree.ref, commit: headTree.commit },
		touched,
		modules,
		...extra,
	};
}
