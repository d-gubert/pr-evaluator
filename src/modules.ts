/**
 * Module detection and the tier 1 half of the model: the boundary surface,
 * the direct dependencies and the indirect dependencies. (D1, D2, D8, D10)
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { isTestFile, matchesPattern, type Config } from './config.js';
import { followReexport, type Tier1 } from './tier1.js';
import type { Dep, IndirectDep, ModuleId, IndirectDep as _I } from './types.js';

export interface ModuleShape {
	id: ModuleId;
	/** Repo-relative files, test files excluded. (OQ7) */
	files: string[];
	testFiles: string[];
	/** The entry file, when the module has one. (D2) */
	entry?: string;
	/** Declared surface: name -> typeOnly. (D2) */
	declared: Map<string, boolean>;
	/** Used surface: name -> the modules that import it. (D2) */
	usedBy: Map<string, Set<ModuleId>>;
	/** name -> the file that declares it, after the re-export follow. */
	declaredIn: Map<string, string>;
	/** Names that consumers import from a deep path, bypassing the entry file. (D2) */
	bypassed: Set<string>;
	/** Modules that import this one through `import * as`. Names are unknown. */
	starImporters: Set<ModuleId>;
	directDeps: Map<ModuleId, { count: number; typeOnly: boolean }>;
	dependents: Set<ModuleId>;
}

export interface Tier1Model {
	modules: Map<ModuleId, ModuleShape>;
	/** file -> module id, for every file that belongs to a module. */
	moduleOf: Map<string, ModuleId>;
}

/** The longest matching ancestor directory wins, so a nested pattern beats its parent. */
export function moduleForFile(rel: string, config: Config): ModuleId | undefined {
	const parts = path.dirname(rel).split('/');
	for (let i = parts.length; i > 0; i--) {
		const dir = parts.slice(0, i).join('/');
		if (config.modules.some((p) => matchesPattern(dir, p))) return dir;
	}
	return undefined;
}

function emptyShape(id: ModuleId): ModuleShape {
	return { id, files: [], testFiles: [], declared: new Map(), declaredIn: new Map(), bypassed: new Set(), usedBy: new Map(), starImporters: new Set(), directDeps: new Map(), dependents: new Set() };
}

export function buildTier1Model(t1: Tier1, config: Config): Tier1Model {
	const modules = new Map<ModuleId, ModuleShape>();
	const moduleOf = new Map<string, ModuleId>();

	for (const rel of t1.files.keys()) {
		const id = moduleForFile(rel, config);
		if (!id) continue;
		moduleOf.set(rel, id);
		const shape = modules.get(id) ?? emptyShape(id);
		if (isTestFile(rel, config)) shape.testFiles.push(rel);
		else shape.files.push(rel);
		modules.set(id, shape);
	}

	// The entry file, and the declared surface it carries. (D2)
	for (const shape of modules.values()) {
		for (const name of ['index.ts', 'index.tsx', 'index.js']) {
			const entry = `${shape.id}/${name}`;
			if (!t1.files.has(entry)) continue;
			shape.entry = entry;
			const facts = t1.files.get(entry)!;
			for (const e of facts.exports) {
				shape.declared.set(e.name, e.typeOnly);
				shape.declaredIn.set(e.name, entry);
			}
			for (const re of facts.reexports) {
				for (const n of re.names) {
					shape.declared.set(n.exported, re.typeOnly);
					const origin = followReexport(t1, entry, n.exported, config.reexportDepth);
					if (origin) shape.declaredIn.set(n.exported, origin.file);
				}
				if (re.star && re.to) {
					// `export *` hides the names. Take them from the target.
					const target = t1.files.get(re.to);
					for (const e of target?.exports ?? []) {
						shape.declared.set(e.name, e.typeOnly || re.typeOnly);
						shape.declaredIn.set(e.name, re.to);
					}
				}
			}
			break;
		}
	}

	// The used surface, and the dependency edges. Every import in the tree
	// counts, including imports from files that belong to no module.
	for (const facts of t1.files.values()) {
		const fromModule = moduleOf.get(facts.rel);
		for (const edge of facts.imports) {
			if (!edge.to) continue;
			for (const name of edge.names) {
				const origin = name === '*' ? undefined : followReexport(t1, edge.to, name, config.reexportDepth);
				const targetFile = origin?.file ?? edge.to;
				const toModule = moduleOf.get(targetFile);
				if (!toModule || toModule === fromModule) continue;
				const shape = modules.get(toModule)!;
				if (name === '*') {
					if (fromModule) shape.starImporters.add(fromModule);
				} else {
					const key = origin?.name ?? name;
					const set = shape.usedBy.get(key) ?? new Set<ModuleId>();
					if (fromModule) set.add(fromModule);
					shape.usedBy.set(key, set);
					if (origin) shape.declaredIn.set(key, origin.file);
					// The consumer reached past the entry file. (D2)
					if (shape.entry && !shape.declared.has(key)) shape.bypassed.add(key);
				}
				if (!fromModule) continue;
				shape.dependents.add(fromModule);
				const from = modules.get(fromModule)!;
				const dep = from.directDeps.get(toModule) ?? { count: 0, typeOnly: true };
				dep.count += 1;
				dep.typeOnly = dep.typeOnly && edge.typeOnly;
				from.directDeps.set(toModule, dep);
			}
		}
	}

	// Without an entry file the declared surface is the used surface. (D2)
	for (const shape of modules.values()) {
		if (shape.entry) continue;
		for (const [name] of shape.usedBy) if (!shape.declared.has(name)) shape.declared.set(name, isTypeExport(t1, shape, name));
	}
	// A bypassed name is part of the real surface, so the declared list holds it.
	for (const shape of modules.values()) {
		for (const name of shape.bypassed) if (!shape.declared.has(name)) shape.declared.set(name, isTypeExport(t1, shape, name));
	}
	return { modules, moduleOf };
}

function isTypeExport(t1: Tier1, shape: ModuleShape, name: string): boolean {
	for (const file of shape.files) {
		const hit = t1.files.get(file)?.exports.find((e) => e.name === name);
		if (hit) return hit.typeOnly;
	}
	return false;
}

/** Breadth-first over the module graph. Depth 1 is a direct dependency. (D8) */
export function indirectDeps(model: Tier1Model, id: ModuleId, maxHops = 5): IndirectDep[] {
	const direct = new Set(model.modules.get(id)?.directDeps.keys() ?? []);
	const seen = new Set<ModuleId>([id, ...direct]);
	const out: IndirectDep[] = [];
	let frontier = [...direct];
	for (let hops = 2; hops <= maxHops && frontier.length; hops++) {
		const next: ModuleId[] = [];
		for (const m of frontier) {
			for (const dep of model.modules.get(m)?.directDeps.keys() ?? []) {
				if (seen.has(dep)) continue;
				seen.add(dep);
				out.push({ module: dep, hops });
				next.push(dep);
			}
		}
		frontier = next;
	}
	return out;
}

export function directDeps(shape: ModuleShape): Dep[] {
	return [...shape.directDeps.entries()]
		.map(([module, d]) => ({ module, typeOnly: d.typeOnly, count: d.count }))
		.sort((a, b) => a.module.localeCompare(b.module));
}

/** A module with no executable code. Its complexity is 0, not unknown. (D2, finding 3) */
export function isTypeOnlyModule(t1: Tier1, shape: ModuleShape): boolean {
	return shape.files.every((f) => {
		const facts = t1.files.get(f);
		if (!facts) return true;
		if (!facts.exports.every((e) => e.typeOnly)) return false;
		try {
			return !/\b(function|class)\b|=>/.test(fs.readFileSync(path.join(t1.root, f), 'utf8'));
		} catch {
			return true;
		}
	});
}
