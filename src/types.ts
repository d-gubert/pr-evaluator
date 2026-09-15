/** The neutral model. The core owns it; a language adapter fills it. (D11) */

/** A module id is a repo-relative directory path. (D1) */
export type ModuleId = string;

/** Why a number is a floor and not a total. (D6, D14) */
export type StopReason = 'function-type' | 'abstract' | 'interface' | 'dynamic' | 'unresolved' | 'javascript' | 'stale-dist' | 'no-tsconfig';

export interface Dep {
	module: ModuleId;
	/** True when every edge to this module is `import type`. (OQ8) */
	typeOnly: boolean;
	/** How many import statements make this edge. */
	count: number;
}

export interface IndirectDep {
	module: ModuleId;
	/** Shortest path length in the module graph. 2 or more. (D8) */
	hops: number;
}

export interface BoundarySymbol {
	name: string;
	/** Which provider found it. (D3) */
	provider: string;
	/** Repo-relative file that declares it. */
	file: string;
	/** True when the symbol is a type, an interface or a type alias. (D2) */
	typeOnly: boolean;
	/** Modules outside this one that import the symbol. Empty = declared but unused. (D2) */
	usedBy: ModuleId[];
	/** Sum of the symbol and of every internal function it reaches. (D6) */
	complexity: number | null;
	/** Reasons the transitive walk stopped. A non-empty list makes complexity a floor. (D14) */
	complexityStops: StopReason[];
	/** Effect categories that reach this symbol. (D7) */
	effects: string[];
	/** Line coverage over the transitive internal function set, 0 to 1. (D9) */
	coverage: number | null;
}

export interface ModuleModel {
	id: ModuleId;
	fileCount: number;
	/** True when the module holds no executable code. (D2, finding 3) */
	typeOnly: boolean;
	boundary: BoundarySymbol[];
	directDeps: Dep[];
	indirectDeps: IndirectDep[];
	/** Modules that import from this one. Feeds the blast radius. (D10) */
	dependents: ModuleId[];
	/** Total complexity of the module, counting each function once. (D6) */
	totalComplexity: number | null;
	confidence: Confidence;
}

export interface Confidence {
	/** 0 to 1. 1 means no reason lowered it. (D14) */
	value: number;
	reasons: { reason: StopReason; count: number }[];
}

/** One tree, fully analysed. (D4) */
export interface TreeModel {
	ref: string;
	commit: string;
	root: string;
	modules: Map<ModuleId, ModuleModel>;
}
