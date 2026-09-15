/**
 * Tier 2: the typed pass over the touched modules only. (D5)
 *
 * It produces the call graph, the transitive complexity of every boundary
 * symbol (D6) and the effects that reach it (D7). It marks every place the
 * walk stops, so the report can say that a number is a floor. (D14)
 */
import { Project } from 'ts-morph';
import * as ts from 'typescript';

// ts-morph bundles its own copy of the compiler. Every node that crosses the
// boundary is cast once, here, so the rest of the file speaks one type.
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Config } from './config.js';
import { countFunction, countingUnitOf, isFunctionLike, type FunctionLike } from './complexity.js';
import { resolveLocalClosures } from './closures.js';
import { findEffects, findProvided, hasAstGrep, type Match } from './effects.js';
import { remapDistToSrc, type Workspace } from './workspace.js';
import type { ModuleId, StopReason } from './types.js';
import type { ModuleShape } from './modules.js';

export interface SymbolResult {
	complexity: number;
	stops: StopReason[];
	effects: string[];
	/** How many internal functions the symbol reaches, itself included. */
	reach: number;
	/** Line ranges of those functions. Coverage maps onto exactly this set. (D9) */
	ranges: { file: string; start: number; end: number }[];
}

export interface ModuleResult {
	symbols: Map<string, SymbolResult>;
	/** Each internal function counted once. (D6) */
	totalComplexity: number;
	stops: Map<StopReason, number>;
	/** Boundary symbols that no `export` declares. (D3) */
	provided: { name: string; provider: string; file: string; line: number }[];
	loadMs: number;
}

/** The nearest tsconfig above a directory. Open question 4 is still open. */
export function nearestTsconfig(root: string, dir: string): string | undefined {
	let cur = dir;
	while (cur && cur !== '.') {
		const candidate = path.join(root, cur, 'tsconfig.json');
		if (fs.existsSync(candidate)) return candidate;
		cur = path.dirname(cur);
	}
	const top = path.join(root, 'tsconfig.json');
	return fs.existsSync(top) ? top : undefined;
}

type FnId = string;
const idOf = (fn: FunctionLike): FnId => `${fn.getSourceFile().fileName}#${fn.getStart()}`;

export function runTier2(root: string, ws: Workspace, shapes: ModuleShape[], config: Config): Map<ModuleId, ModuleResult> {
	const results = new Map<ModuleId, ModuleResult>();
	const byConfig = new Map<string, ModuleShape[]>();
	for (const shape of shapes) {
		const tsconfig = nearestTsconfig(root, shape.id);
		if (!tsconfig) {
			results.set(shape.id, { symbols: new Map(), totalComplexity: 0, stops: new Map([['no-tsconfig', 1]]), provided: [], loadMs: 0 });
			continue;
		}
		byConfig.set(tsconfig, [...(byConfig.get(tsconfig) ?? []), shape]);
	}

	const dirs = shapes.map((s) => s.id).filter((d) => fs.existsSync(path.join(root, d)));
	const effects = hasAstGrep() ? findEffects(root, dirs, config) : new Map<string, Match[]>();
	const provided = hasAstGrep() ? config.providers.map((p) => ({ p, hits: findProvided(root, dirs, p) })) : [];

	for (const [tsconfig, group] of byConfig) {
		const t0 = Date.now();
		const project = new Project({ tsConfigFilePath: tsconfig, skipAddingFilesFromTsConfig: false });
		const checker = project.getTypeChecker().compilerObject as unknown as ts.TypeChecker;
		const loadMs = Date.now() - t0;
		for (const shape of group) {
			results.set(shape.id, analyseModule(root, ws, project, checker, shape, effects, provided, loadMs));
		}
	}
	return results;
}

function analyseModule(
	root: string,
	ws: Workspace,
	project: Project,
	checker: ts.TypeChecker,
	shape: ModuleShape,
	effects: Map<string, Match[]>,
	providers: { p: Config['providers'][number]; hits: Match[] }[],
	loadMs: number,
): ModuleResult {
	const inModule = new Set(shape.files.map((f) => path.join(root, f)));
	const stops = new Map<StopReason, number>();
	const bump = (r: StopReason) => stops.set(r, (stops.get(r) ?? 0) + 1);
	for (const f of shape.files) if (/\.(js|jsx)$/.test(f)) bump('javascript');

	// Every function-like node inside the module, with its line range. The
	// effect matcher and the call walk both need this index.
	const fnIndex: { id: FnId; fn: FunctionLike; file: string; start: number; end: number }[] = [];
	for (const rel of shape.files) {
		const sf = project.getSourceFile(path.join(root, rel));
		if (!sf) continue;
		sf.forEachDescendant((node) => {
			const compiler = node.compilerNode as unknown as ts.Node;
			if (!isFunctionLike(compiler)) return;
			const fn = compiler;
			const src = fn.getSourceFile();
			fnIndex.push({
				id: idOf(fn),
				fn,
				file: rel,
				start: src.getLineAndCharacterOfPosition(fn.getStart(src)).line + 1,
				end: src.getLineAndCharacterOfPosition(fn.getEnd()).line + 1,
			});
		});
	}

	// Effects attach to the innermost function that contains the match. (D7)
	const directEffects = new Map<FnId, Set<string>>();
	for (const [category, matches] of effects) {
		for (const m of matches) {
			const containing = fnIndex
				.filter((f) => f.file === m.file && f.start <= m.line && f.end >= m.line)
				.sort((a, b) => a.end - a.start - (b.end - b.start))[0];
			if (!containing) continue;
			const set = directEffects.get(containing.id) ?? new Set<string>();
			set.add(category);
			directEffects.set(containing.id, set);
		}
	}

	const counts = new Map<FnId, number>();
	const rangeOf = new Map<FnId, { file: string; start: number; end: number }>();
	for (const entry of fnIndex) {
		const c = countFunction(entry.fn);
		counts.set(entry.id, c.own + c.inline);
		rangeOf.set(entry.id, { file: entry.file, start: entry.start, end: entry.end });
	}
	const rangesFor = (ids: Iterable<FnId>) => [...ids].map((id) => rangeOf.get(id)).filter((r): r is { file: string; start: number; end: number } => !!r);

	const symbols = new Map<string, SymbolResult>();
	const allReached = new Set<FnId>();

	for (const [name, typeOnly] of shape.declared) {
		if (typeOnly) {
			symbols.set(name, { complexity: 0, stops: [], effects: [], reach: 0, ranges: [] });
			continue;
		}
		const decls = findDeclarations(root, project, shape, name);
		if (!decls.length) {
			symbols.set(name, { complexity: 0, stops: ['unresolved'], effects: [], reach: 0, ranges: [] });
			bump('unresolved');
			continue;
		}
		const seeds = decls.flatMap(seedFunctions);
		if (!seeds.length) {
			// A const, an object literal or a type. It carries no branches.
			symbols.set(name, { complexity: 0, stops: [], effects: [], reach: 0, ranges: [] });
			continue;
		}
		const walk = walkCalls(root, ws, checker, seeds, inModule, counts);
		for (const r of walk.stops) bump(r);
		for (const id of walk.reached) allReached.add(id);
		const symEffects = new Set<string>();
		for (const id of walk.reached) for (const e of directEffects.get(id) ?? []) symEffects.add(e);
		symbols.set(name, {
			complexity: walk.complexity,
			stops: [...new Set(walk.stops)],
			effects: [...symEffects].sort(),
			reach: walk.reached.size,
			ranges: rangesFor(walk.reached),
		});
	}

	// A provider that is not `export`. Its symbol is the route path. (D3)
	const providedOut: ModuleResult['provided'] = [];
	for (const { p, hits } of providers) {
		for (const m of hits) {
			if (!shape.files.includes(m.file)) continue;
			providedOut.push({ name: m.name!, provider: p.name, file: m.file, line: m.line });
			if (symbols.has(m.name!)) continue;
			const containing = fnIndex.filter((f) => f.file === m.file && f.start <= m.line && f.end >= m.line);
			const inner = containing.map((f) => counts.get(f.id) ?? 0).reduce((a, b) => a + b, 0);
			const routeEffects = new Set<string>();
			for (const f of containing) for (const e of directEffects.get(f.id) ?? []) routeEffects.add(e);
			symbols.set(m.name!, { complexity: inner, stops: [], effects: [...routeEffects].sort(), reach: containing.length, ranges: rangesFor(containing.map((f) => f.id)) });
			for (const f of containing) allReached.add(f.id);
		}
	}

	let total = 0;
	for (const id of allReached) total += counts.get(id) ?? 0;
	return { symbols, totalComplexity: total, stops, provided: providedOut, loadMs };
}

function findDeclarations(root: string, project: Project, shape: ModuleShape, name: string): ts.Declaration[] {
	const file = shape.declaredIn.get(name);
	const candidates = file ? [file] : shape.files;
	for (const rel of candidates) {
		const sf = project.getSourceFile(path.join(root, rel));
		if (!sf) continue;
		const hit = sf.getExportedDeclarations().get(name);
		if (hit?.length) return hit.map((n) => n.compilerNode as unknown as ts.Declaration);
	}
	return [];
}

export function seedFunctions(decl: ts.Declaration): FunctionLike[] {
	if (isFunctionLike(decl)) return [decl];
	if (ts.isClassDeclaration(decl)) return decl.members.filter((m) => isFunctionLike(m)) as FunctionLike[];
	if (ts.isVariableDeclaration(decl) && decl.initializer && isFunctionLike(decl.initializer)) return [decl.initializer];
	return [];
}

interface Walk {
	complexity: number;
	reached: Set<FnId>;
	stops: StopReason[];
}

/**
 * The transitive walk of D6. It sums the complexity of the seed and of every
 * internal function the seed reaches. It stops at the module edge, and it
 * records why it stopped anywhere else.
 */
function walkCalls(root: string, ws: Workspace, checker: ts.TypeChecker, seeds: FunctionLike[], inModule: Set<string>, counts: Map<FnId, number>): Walk {
	const reached = new Set<FnId>();
	const stops: StopReason[] = [];
	const queue = [...seeds];
	while (queue.length) {
		const fn = queue.pop()!;
		const id = idOf(fn);
		if (reached.has(id)) continue;
		reached.add(id);
		if (!fn.body) continue;
		visit(fn.body);

		function visit(node: ts.Node): void {
			if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
				const target = resolveCallee(checker, node);
				// A `function-type` callee is often a closure that one scope
				// holds in plain sight. Read that evidence before we call the
				// number a floor. (D17)
				const closures = target.reason === 'function-type' ? resolveLocalClosures(checker, node, target.reasonDecls) : undefined;
				let accounted = closures?.complete ?? false;
				for (const closure of closures?.decls ?? []) {
					if (!isInModule(root, ws, closure, inModule)) continue; // the module edge
					const unit = countingUnitOf(closure);
					if (unit === closure) queue.push(closure);
					else if (!reached.has(idOf(unit))) accounted = false; // its count sits in a function the walk has not reached
				}
				// A callee with no body outside this module is the module edge,
				// which D6 stops at by design. Only a stop inside the module
				// makes the number a floor. (D14)
				if (accounted) {
					/* the closures are resolved, so this call is not a stop */
				} else if (target.reason === 'unresolved' || target.reason === 'dynamic') stops.push(target.reason);
				else if (target.reason && target.reasonDecls.some((d) => isInModule(root, ws, d, inModule))) stops.push(target.reason);
				for (const decl of target.decls) {
					const declFile = decl.getSourceFile().fileName;
					const source = remapDistToSrc(root, ws, declFile) ?? declFile;
					if (!inModule.has(source) && !inModule.has(declFile)) continue; // the module edge
					if (isFunctionLike(decl)) queue.push(decl);
					else for (const s of seedFunctions(decl)) queue.push(s);
				}
			}
			ts.forEachChild(node, visit);
		}
	}
	let complexity = 0;
	for (const id of reached) complexity += counts.get(id) ?? 0;
	return { complexity, reached, stops };
}

/**
 * Two resolution strategies, because the probe found they disagree on 1.2% to
 * 16.3% of calls. The merge rule prefers whichever strategy finds a body.
 */
function isInModule(root: string, ws: Workspace, decl: ts.Node, inModule: Set<string>): boolean {
	const file = decl.getSourceFile().fileName;
	return inModule.has(file) || inModule.has(remapDistToSrc(root, ws, file) ?? file);
}

export function resolveCallee(checker: ts.TypeChecker, call: ts.CallExpression | ts.NewExpression): { decls: ts.Declaration[]; reason?: StopReason; reasonDecls: ts.Declaration[] } {
	const expr = call.expression;
	const decls: ts.Declaration[] = [];

	let sym = checker.getSymbolAtLocation(expr);
	if (sym && sym.flags & ts.SymbolFlags.Alias) {
		try {
			sym = checker.getAliasedSymbol(sym);
		} catch {
			/* an unresolvable alias stays as it is */
		}
	}
	for (const d of sym?.declarations ?? []) decls.push(d);

	try {
		for (const sig of checker.getTypeAtLocation(expr).getCallSignatures()) {
			if (sig.declaration) decls.push(sig.declaration as ts.Declaration);
		}
	} catch {
		/* the checker gives up on some dynamic expressions */
	}

	const unique = [...new Set(decls)];
	const withBody = unique.filter((d) => isFunctionLike(d) && !!d.body);
	if (withBody.length) return { decls: withBody, reasonDecls: [] };
	if (unique.some((d) => ts.isClassDeclaration(d) || ts.isVariableDeclaration(d))) return { decls: unique, reasonDecls: [] };

	if (!unique.length) {
		const dynamic = !ts.isIdentifier(expr) && !ts.isPropertyAccessExpression(expr);
		return { decls: [], reason: dynamic ? 'dynamic' : 'unresolved', reasonDecls: [] };
	}
	const abstract = unique.filter((d) => ts.isMethodDeclaration(d) && d.modifiers?.some((m) => m.kind === ts.SyntaxKind.AbstractKeyword));
	if (abstract.length) return { decls: [], reason: 'abstract', reasonDecls: abstract };
	const fnType = unique.filter((d) => ts.isFunctionTypeNode(d as unknown as ts.Node) || ts.isParameter(d));
	if (fnType.length) return { decls: [], reason: 'function-type', reasonDecls: fnType };
	const iface = unique.filter((d) => ts.isMethodSignature(d) || ts.isPropertySignature(d) || ts.isInterfaceDeclaration(d));
	if (iface.length) return { decls: [], reason: 'interface', reasonDecls: iface };
	return { decls: unique, reasonDecls: [] };
}
