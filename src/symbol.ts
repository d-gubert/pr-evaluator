/**
 * Symbol mode: every fact the engine can produce about ONE symbol reference.
 *
 * The diff-driven pipeline reports the six facts per module, over two trees.
 * This file reports the same six facts for one symbol, over one tree, with no
 * diff and no delta. It adds a path; it changes no number in the old one.
 * `src/pipeline.ts`, `src/modules.ts` and `src/cli.ts` stay as they are.
 *
 * Why a smaller unit. Open question 11 found that `apps/meteor/client/views`
 * is one module of 1870 files, and that a change inside it moves no module
 * number. A symbol reports a number whatever the module size.
 *
 * The walk edge is a flag here, not a decision. D6 stops at the module edge.
 * `--edge` selects file, module, package or repo, so the prototype can compare
 * the four on real code before D6 is pinned.
 */
import { Project } from 'ts-morph';
import * as ts from 'typescript';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Config } from './config.js';
import { countFunction, countingUnitOf, isFunctionLike, type FunctionLike } from './complexity.js';
import { findEffects, findProvided, hasAstGrep, type Match } from './effects.js';
import { coverageOf, type CoverageReport } from './coverage.js';
import { buildTier1Model, moduleForFile, type ModuleShape, type Tier1Model } from './modules.js';
import { followReexport, resolveSpec, runTier1, type Tier1 } from './tier1.js';
import { nearestTsconfig, resolveCallee, seedFunctions } from './tier2.js';
import { resolveLocalClosures } from './closures.js';
import { readWorkspace, remapDistToSrc, type Workspace } from './workspace.js';
import type { ModuleId, StopReason } from './types.js';

export type EdgeKind = 'file' | 'module' | 'package' | 'repo';
export const EDGE_KINDS: EdgeKind[] = ['file', 'module', 'package', 'repo'];

export interface SymbolRef {
	/** Repo-relative file that holds the declaration. */
	file: string;
	/** The declared name. `Class.method` splits into name and member. */
	name: string;
	member?: string;
	raw: string;
}

/** One function the walk reached. (D6) */
export interface FnNode {
	id: string;
	name: string;
	kind: string;
	file: string;
	start: number;
	end: number;
	/** McCabe for this function, nested named functions excluded. */
	own: number;
	/** The sum over inline callbacks, which belong to this function. */
	inline: number;
	exported: boolean;
	module?: ModuleId;
	/** Shortest call depth from the seed. 0 is the symbol itself. */
	depth: number;
	async: boolean;
	coverage: number | null;
	effects: string[];
}

export interface CallEdge {
	from: string;
	to: string;
	line: number;
	text: string;
	/** Set when the edge comes from an inference, not from the checker. (D17) */
	via?: 'closure';
}

/** A call or a type reference that leaves the walk edge. Feeds facts 3 and 4. */
export interface Crossing {
	kind: 'call' | 'reference';
	fromNode: string;
	fromFile: string;
	line: number;
	/** What the source calls it. */
	name: string;
	/** Repo-relative target file, after the dist-to-src remap of D15. */
	file?: string;
	module?: ModuleId;
	package?: string;
	/** True when the target sits outside the repository, such as an npm package. */
	external: boolean;
	typeOnly: boolean;
	/** The raw file the checker landed on, before the D15 remap. Evidence. */
	target: string;
	/** True for the TypeScript standard library, which is not a dependency. */
	lib: boolean;
	/** How many times the walk saw this target. */
	count: number;
}

/** A place the walk stopped inside the edge, so the number is a floor. (D14) */
export interface Stop {
	reason: StopReason;
	fromNode: string;
	file: string;
	line: number;
	text: string;
}

/** A call the closure pass resolved, and how. Evidence for the reader. (D17) */
export interface Resolved {
	reason: StopReason;
	fromNode: string;
	file: string;
	line: number;
	text: string;
	/** How many function bodies the pass found. */
	closures: number;
	/** True when the pass dropped the stop, false when it only narrowed it. */
	complete: boolean;
}

export interface WalkResult {
	nodes: Map<string, FnNode>;
	calls: CallEdge[];
	crossings: Crossing[];
	stops: Stop[];
	resolved: Resolved[];
	seedIds: string[];
	truncated: boolean;
	maxDepth: number;
	/** Source files the redirect wants, which the program has not loaded. */
	pending: Set<string>;
}

export interface Importer {
	file: string;
	module?: ModuleId;
	line: number;
	spec: string;
	typeOnly: boolean;
	/** The name the importer writes, when a re-export renamed it. */
	as: string;
}

export interface CallerSite {
	file: string;
	module?: ModuleId;
	line: number;
	inFunction: string;
	text: string;
}

/** The caller scan loads files into the program, so it needs a ceiling. */
export const MAX_CALLER_FILES = 80;

export interface SymbolReport {
	ref: SymbolRef;
	edge: EdgeKind;
	tree: { root: string; commit?: string; files: number };
	identity: {
		kind: string;
		signature: string;
		jsdoc?: string;
		file: string;
		start: number;
		end: number;
		exported: boolean;
		defaultExport: boolean;
		typeOnly: boolean;
		overloads: number;
		seeds: number;
		declarations: { file: string; start: number; end: number; kind: string }[];
	};
	context: {
		module?: ModuleId;
		moduleFiles?: number;
		moduleEntry?: string;
		moduleIsTypeOnly?: boolean;
		package?: string;
		packageDir?: string;
		tsconfig?: string;
		/** The file the program is rooted at, when `--from` moved it. (D18) */
		programRoot?: string;
		isTestFile: boolean;
	};
	facts: {
		boundary: {
			onDeclaredSurface: boolean;
			declaredInEntry: boolean;
			bypassed: boolean;
			typeOnly: boolean;
			unused: boolean;
			usedByModules: ModuleId[];
			starImporters: ModuleId[];
			importers: Importer[];
			reexportedBy: string[];
			providers: { provider: string; name: string; file: string; line: number }[];
		};
		complexity: {
			own: number;
			ownPlusInline: number;
			transitive: number;
			reach: number;
			depth: number;
			floor: boolean;
			perFile: { file: string; functions: number; complexity: number }[];
			hotspots: FnNode[];
		};
		directDeps: {
			modules: { module: ModuleId; calls: number; references: number; typeOnly: boolean; names: string[] }[];
			packages: { package: string; calls: number; references: number; names: string[] }[];
			external: { name: string; references: number; typeOnly: boolean; names: string[] }[];
		};
		indirectDeps: { module: ModuleId; hops: number }[];
		effects: {
			categories: string[];
			hits: { category: string; file: string; line: number; inFunction: string; depth: number }[];
			astGrep: boolean;
		};
		coverage: {
			source: string;
			value: number | null;
			coveredLines: number;
			knownLines: number;
			perFunction: { node: string; file: string; value: number | null }[];
		};
	};
	confidence: { value: number; reasons: { reason: StopReason; count: number }[] };
	stops: Stop[];
	resolved: Resolved[];
	crossings: Crossing[];
	callers: { scanned: number; sites: CallerSite[]; skipped: number };
	callTree: TreeLine[];
	callEdges: CallEdge[];
	nodes: FnNode[];
	edgesCompared?: EdgeComparison[];
	timings: Record<string, number>;
	notes: string[];
}

export interface TreeLine {
	depth: number;
	node: string;
	name: string;
	file: string;
	line: number;
	own: number;
	inline: number;
	repeat: boolean;
	stop?: StopReason;
	crossing?: string;
	/** Set when the edge comes from an inference, not from the checker. (D17) */
	via?: 'closure';
}

export interface EdgeComparison {
	edge: EdgeKind;
	reach: number;
	transitive: number;
	stops: number;
	crossings: number;
	modules: number;
	ms: number;
}

export interface SymbolInput {
	root: string;
	config: Config;
	ref: string;
	edge?: EdgeKind;
	maxDepth?: number;
	maxNodes?: number;
	program?: 'lazy' | 'full';
	coverage?: CoverageReport;
	references?: boolean;
	callers?: boolean;
	/** Also scan every file of the module, not only the importers. It costs. */
	callersDeep?: boolean;
	compareEdges?: boolean;
	/** Follow a call into a sibling package by its source, not its `dist`. */
	followDist?: boolean;
	/** Resolve a `function-type` callee to the closures one scope holds. (D17) */
	closures?: boolean;
	/**
	 * Root the program at this file instead of the symbol's own file, so the
	 * program spans the consumer that supplies a concrete type. (D18)
	 */
	from?: string;
	treeLines?: number;
	log?: (s: string) => void;
}

export class SymbolNotFound extends Error {
	constructor(
		message: string,
		readonly candidates: string[],
	) {
		super(message);
	}
}

const fnId = (fn: ts.Node): string => `${fn.getSourceFile().fileName}#${fn.getStart()}`;
const lineOf = (node: ts.Node): number => node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line + 1;
const endLineOf = (node: ts.Node): number => node.getSourceFile().getLineAndCharacterOfPosition(node.getEnd()).line + 1;
const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------- reference

/**
 * Parse `path/to/file.ts#Name`, `path/to/file.ts#Class.method` or a bare
 * `Name`. A bare name searches the tier 1 export index, so an exploratory run
 * needs no path.
 */
export function parseRef(t1: Tier1, root: string, raw: string): SymbolRef {
	const hash = raw.lastIndexOf('#');
	if (hash === -1) {
		// A path with no name lists what that file exports.
		if (t1.files.has(raw) || fs.existsSync(path.join(root, raw))) {
			const file = normaliseFile(t1, root, raw);
			throw new SymbolNotFound(`${file} needs a symbol name`, exportsOf(t1, file).map((n) => `${file}#${n}`));
		}
		const hits = searchName(t1, raw);
		if (hits.length === 1) return hits[0];
		if (!hits.length) throw new SymbolNotFound(`no export named "${raw}" in the tree`, []);
		throw new SymbolNotFound(`"${raw}" is exported by ${hits.length} files`, hits.map((h) => `${h.file}#${h.name}`));
	}
	const file = normaliseFile(t1, root, raw.slice(0, hash));
	const rest = raw.slice(hash + 1);
	const dot = rest.indexOf('.');
	const name = dot === -1 ? rest : rest.slice(0, dot);
	const member = dot === -1 ? undefined : rest.slice(dot + 1);
	return { file, name, member, raw };
}

function normaliseFile(t1: Tier1, root: string, given: string): string {
	const candidates = [given, path.relative(root, path.resolve(given)), path.relative(root, path.resolve(process.cwd(), given))];
	for (const c of candidates) if (t1.files.has(c)) return c;
	for (const c of candidates) if (fs.existsSync(path.join(root, c))) return c;
	throw new SymbolNotFound(`no file ${given} in ${root}`, []);
}

function searchName(t1: Tier1, name: string): SymbolRef[] {
	const out: SymbolRef[] = [];
	for (const [rel, facts] of t1.files) {
		if (facts.exports.some((e) => e.name === name)) out.push({ file: rel, name, raw: `${rel}#${name}` });
	}
	return out;
}

/** Every export of one file, for a run that gives a path and no name. */
export function exportsOf(t1: Tier1, file: string): string[] {
	return (t1.files.get(file)?.exports ?? []).map((e) => e.name).sort();
}

// -------------------------------------------------------------- declaration

const DECL_KIND = (d: ts.Node): string => {
	if (ts.isFunctionDeclaration(d)) return 'function';
	if (ts.isArrowFunction(d)) return 'arrow';
	if (ts.isFunctionExpression(d)) return 'function expression';
	if (ts.isMethodDeclaration(d)) return 'method';
	if (ts.isConstructorDeclaration(d)) return 'constructor';
	if (ts.isGetAccessor(d)) return 'getter';
	if (ts.isSetAccessor(d)) return 'setter';
	if (ts.isClassDeclaration(d)) return 'class';
	if (ts.isInterfaceDeclaration(d)) return 'interface';
	if (ts.isTypeAliasDeclaration(d)) return 'type alias';
	if (ts.isEnumDeclaration(d)) return 'enum';
	if (ts.isVariableDeclaration(d)) return 'variable';
	if (ts.isPropertyDeclaration(d)) return 'property';
	if (ts.isPropertyAssignment(d)) return 'property assignment';
	return ts.SyntaxKind[d.kind];
};

/**
 * Find the declaration by name inside one file. `findDeclarations` in tier 2
 * calls `getExportedDeclarations`, which sees the boundary only. A symbol
 * reference must also reach an internal helper, so this walk looks at every
 * named declaration in the file.
 */
function findDeclarations(sf: ts.SourceFile, ref: SymbolRef): ts.Declaration[] {
	const named: ts.Declaration[] = [];
	const wanted = ref.name;

	(function visit(node: ts.Node): void {
		if (nameOfDecl(node) === wanted) named.push(node as ts.Declaration);
		if (wanted === 'default' && ts.isExportAssignment(node)) named.push(node as unknown as ts.Declaration);
		ts.forEachChild(node, visit);
	})(sf);

	if (!ref.member) return dedupe(named);
	const members: ts.Declaration[] = [];
	for (const holder of named) {
		if (ts.isClassDeclaration(holder) || ts.isInterfaceDeclaration(holder)) {
			for (const m of holder.members) if (memberName(m) === ref.member) members.push(m as ts.Declaration);
		}
		if (ts.isVariableDeclaration(holder) && holder.initializer && ts.isObjectLiteralExpression(holder.initializer)) {
			for (const p of holder.initializer.properties) if (memberName(p) === ref.member) members.push(p as ts.Declaration);
		}
	}
	return dedupe(members);
}

function nameOfDecl(node: ts.Node): string | undefined {
	if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node)) {
		return node.name?.text;
	}
	if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) return node.name.text;
	if (ts.isMethodDeclaration(node) || ts.isPropertyDeclaration(node)) return memberName(node);
	return undefined;
}

function memberName(m: ts.Node): string | undefined {
	const name = (m as { name?: ts.Node }).name;
	if (!name) return ts.isConstructorDeclaration(m as ts.Node) ? 'constructor' : undefined;
	if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
	return undefined;
}

function dedupe<T>(items: T[]): T[] {
	return [...new Set(items)];
}

/** The function-like nodes the walk starts from. A class seeds every member. */
function seedsOf(decls: ts.Declaration[]): FunctionLike[] {
	const out: FunctionLike[] = [];
	for (const d of decls) {
		if (isFunctionLike(d)) {
			out.push(d);
			continue;
		}
		if (ts.isExportAssignment(d as unknown as ts.Node)) {
			const expr = (d as unknown as ts.ExportAssignment).expression;
			if (isFunctionLike(expr)) out.push(expr);
			continue;
		}
		if (ts.isPropertyAssignment(d) && isFunctionLike(d.initializer)) {
			out.push(d.initializer);
			continue;
		}
		if (ts.isPropertyDeclaration(d) && d.initializer && isFunctionLike(d.initializer)) {
			out.push(d.initializer);
			continue;
		}
		out.push(...seedFunctions(d));
	}
	return dedupe(out);
}

function signatureOf(decl: ts.Declaration): string {
	const text = decl.getText();
	const body = (decl as { body?: ts.Node }).body;
	if (body) return oneLine(text.slice(0, body.getStart() - decl.getStart()));
	return oneLine(text.length > 200 ? `${text.slice(0, 200)} ...` : text);
}

function jsdocOf(decl: ts.Declaration): string | undefined {
	const docs = (decl as unknown as { jsDoc?: ts.JSDoc[] }).jsDoc;
	const first = docs?.[0];
	if (!first) return undefined;
	return oneLine(typeof first.comment === 'string' ? first.comment : first.getText());
}

function isExported(decl: ts.Declaration): boolean {
	let node: ts.Node | undefined = decl;
	while (node) {
		const mods = (node as { modifiers?: ts.NodeArray<ts.ModifierLike> }).modifiers;
		if (mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) return true;
		node = node.parent;
		if (node && ts.isSourceFile(node)) break;
	}
	return false;
}

// ------------------------------------------------------------------ program

/**
 * Two ways to build the program. `full` loads the whole tsconfig, as tier 2
 * does: 12s to 22s on apps/meteor. `lazy` loads the one file and the transitive
 * closure of its imports, which is what a single symbol needs.
 *
 * The prototype defaults to `lazy` and it reports both the file count and the
 * load time, so the cost of the choice is visible in every run.
 */
function loadProgram(root: string, file: string, mode: 'lazy' | 'full', from?: string): { project: Project; checker: ts.TypeChecker; tsconfig?: string; files: number; ms: number } {
	const t0 = Date.now();
	// `from` picks the tsconfig and seeds the program. The symbol's own file
	// joins it afterwards, so the walk still starts where the symbol is. (D18)
	const seedFile = from ?? file;
	const tsconfig = nearestTsconfig(root, path.dirname(seedFile));
	const project =
		mode === 'full' && tsconfig
			? new Project({ tsConfigFilePath: tsconfig, skipAddingFilesFromTsConfig: false })
			: new Project({ tsConfigFilePath: tsconfig, skipAddingFilesFromTsConfig: true });
	if (mode === 'lazy' || !tsconfig) {
		project.addSourceFileAtPath(path.join(root, seedFile));
		project.resolveSourceFileDependencies();
	}
	if (!project.getSourceFile(path.join(root, file))) {
		// The consumer resolves a sibling package to `dist/*.d.ts`, so the
		// symbol's source file is absent. Add it. (D15)
		project.addSourceFileAtPath(path.join(root, file));
		project.resolveSourceFileDependencies();
	}
	const checker = freshChecker(project);
	return { project, checker, tsconfig: tsconfig ? path.relative(root, tsconfig) : undefined, files: project.getSourceFiles().length, ms: Date.now() - t0 };
}

/**
 * A checker belongs to the program that made it. Any file added later leaves
 * the old one stale, and a stale checker crashes inside `getTypeOfSymbol`. So
 * every pass that may add a file takes a fresh one.
 */
function freshChecker(project: Project): ts.TypeChecker {
	return project.getTypeChecker().compilerObject as unknown as ts.TypeChecker;
}

/**
 * Map a path the checker resolved back onto the source tree. (D15)
 *
 * `remapDistToSrc` covers `node_modules/@rocket.chat/x` and `<pkg>/dist/**`.
 * pnpm produces a third shape that it does not cover, and the failure is
 * silent: an internal package reports as external.
 *
 *   apps/meteor/node_modules/@rocket.chat/apps
 *     /node_modules/@rocket.chat/core-typings/dist/IRoom.d.ts
 *
 * Its `node_modules/(.+)` match is not anchored, so it takes the FIRST
 * segment, resolves `@rocket.chat/apps`, and looks for
 * `packages/apps/node_modules/...`, which has no source. The last segment
 * names the real package. This path keeps the fix local: the module pipeline
 * still calls `remapDistToSrc` and its numbers do not move.
 */
function toSourcePath(root: string, ws: Workspace, abs: string): string | undefined {
	const direct = remapDistToSrc(root, ws, abs);
	// The wrong answer exists on disk, because the inner link points at the
	// real package. So a path that still holds `node_modules` is not an answer.
	if (direct && !direct.includes('node_modules/')) return direct;
	const parts = abs.split('node_modules/');
	if (parts.length < 2) return direct;
	// `<pkg>/dist/x.d.ts` and `<pkg>/x.d.ts` both name `<pkg>/src/x.ts`, and
	// `resolveSpec` already knows that the source tree wins over a built file.
	const spec = parts[parts.length - 1]
		.replace(/\.d\.ts$|\.(ts|tsx|js|jsx|mjs|cjs)$/, '')
		.replace(/\/dist\//, '/');
	const rel = resolveSpec(root, ws, '', spec);
	return rel ? path.join(root, rel) : undefined;
}

// --------------------------------------------------------------------- edge

interface EdgeTest {
	kind: EdgeKind;
	/** Repo-relative file, or undefined when the file is not in the tree. */
	rel(abs: string): string | undefined;
	inside(abs: string): boolean;
	label: string;
}

function makeEdge(kind: EdgeKind, root: string, ws: Workspace, config: Config, seedFile: string): EdgeTest {
	const seedModule = moduleForFile(seedFile, config);
	const seedPkg = packageDirOf(ws, seedFile);
	const rel = (abs: string): string | undefined => {
		const remapped = toSourcePath(root, ws, abs) ?? abs;
		const r = path.relative(root, remapped);
		return r.startsWith('..') || r.includes('node_modules') ? undefined : r;
	};
	const label =
		kind === 'file' ? seedFile : kind === 'module' ? (seedModule ?? `${seedFile} (no module matches the D1 patterns)`) : kind === 'package' ? (seedPkg ?? 'no package') : 'the whole repository';
	return {
		kind,
		rel,
		label,
		inside(abs: string): boolean {
			const r = rel(abs);
			if (r === undefined) return false;
			if (kind === 'repo') return true;
			if (kind === 'file') return r === seedFile;
			// Without a D1 match the module edge has nothing to test, so it
			// falls back to the file. Open question 11 lives here.
			if (kind === 'module') return seedModule === undefined ? r === seedFile : moduleForFile(r, config) === seedModule;
			return seedPkg === undefined ? r === seedFile : r === seedPkg || r.startsWith(`${seedPkg}/`);
		},
	};
}

/** The workspace directory that holds a file. The longest match wins. */
function packageDirOf(ws: Workspace, rel: string): string | undefined {
	let best: string | undefined;
	for (const dir of ws.dirOf.values()) {
		if ((rel === dir || rel.startsWith(`${dir}/`)) && (!best || dir.length > best.length)) best = dir;
	}
	return best;
}

function packageNameOf(ws: Workspace, dir: string): string | undefined {
	for (const [name, d] of ws.dirOf) if (d === dir) return name;
	return undefined;
}

// --------------------------------------------------------------------- walk

/**
 * The transitive walk of D6, with every by-product kept. The module pipeline
 * keeps the sum and the stop reasons. Here the walk also keeps the call edges,
 * the depth of each function, every crossing of the edge and the source text of
 * each stop, because the point of this mode is to look at the evidence.
 */
function walk(
	root: string,
	ws: Workspace,
	config: Config,
	checker: ts.TypeChecker,
	seeds: FunctionLike[],
	edge: EdgeTest,
	opts: { maxDepth: number; maxNodes: number; references: boolean; throughDist?: Redirect; closures?: boolean },
): WalkResult {
	const nodes = new Map<string, FnNode>();
	const calls: CallEdge[] = [];
	const crossings: Crossing[] = [];
	const stops: Stop[] = [];
	const resolved: Resolved[] = [];
	const seen = new Set<string>();
	const crossKey = new Map<string, Crossing>();
	let truncated = false;
	let maxDepth = 0;
	const pending = new Set<string>();

	const queue: { fn: FunctionLike; depth: number }[] = seeds.map((fn) => ({ fn, depth: 0 }));
	const seedIds = seeds.map((fn) => fnId(fn));

	while (queue.length) {
		const { fn, depth } = queue.shift()!;
		const id = fnId(fn);
		if (seen.has(id)) continue;
		if (nodes.size >= opts.maxNodes) {
			truncated = true;
			break;
		}
		seen.add(id);
		maxDepth = Math.max(maxDepth, depth);
		const node = describeNode(root, ws, config, fn, depth);
		nodes.set(id, node);

		const record = (target: ts.Node, kindOfUse: 'call' | 'reference', at: ts.Node, name: string, typeOnly: boolean): void => {
			const absFile = target.getSourceFile().fileName;
			const r = edge.rel(absFile);
			const external = r === undefined;
			const mod = r ? moduleForFile(r, config) : undefined;
			const pkgDir = r ? packageDirOf(ws, r) : undefined;
			const key = `${kindOfUse}|${name}|${r ?? absFile}`;
			const already = crossKey.get(key);
			if (already) {
				already.count++;
				return;
			}
			const entry: Crossing = {
				kind: kindOfUse,
				fromNode: id,
				fromFile: node.file,
				line: lineOf(at),
				name,
				file: r,
				module: mod,
				package: pkgDir ? (packageNameOf(ws, pkgDir) ?? pkgDir) : externalPackageOf(absFile),
				external,
				typeOnly,
				target: absFile.startsWith(root) ? path.relative(root, absFile) : absFile,
				lib: isLibFile(absFile),
				count: 1,
			};
			crossKey.set(key, entry);
			crossings.push(entry);
		};

		const visit = (n: ts.Node): void => {
			if (ts.isCallExpression(n) || ts.isNewExpression(n)) {
				const callText = oneLine(n.expression.getText()).slice(0, 80);
				const target = resolveCallee(checker, n);
				// A `function-type` callee is often a closure that one scope
				// holds in plain sight. Read that evidence before we call the
				// number a floor. (D17)
				const found = opts.closures !== false && target.reason === 'function-type' ? resolveLocalClosures(checker, n, target.reasonDecls) : undefined;
				let accounted = found?.complete ?? false;
				for (const closure of found?.decls ?? []) {
					if (!edge.inside(closure.getSourceFile().fileName)) continue; // the walk edge
					const unit = countingUnitOf(closure);
					if (unit !== closure) {
						// Its count already sits in the enclosing function
						// through `inline`, and that body is already walked.
						if (!seen.has(fnId(unit))) accounted = false;
						continue;
					}
					calls.push({ from: id, to: fnId(closure), line: lineOf(n), text: callText, via: 'closure' });
					if (!seen.has(fnId(closure))) queue.push({ fn: closure, depth: depth + 1 });
				}
				if (found && target.reason) {
					resolved.push({ reason: target.reason, fromNode: id, file: node.file, line: lineOf(n), text: callText, closures: found.decls.length, complete: accounted });
				}
				if (accounted) {
					/* the closures are resolved, so this call is not a stop */
				} else if (target.reason === 'unresolved' || target.reason === 'dynamic') {
					stops.push({ reason: target.reason, fromNode: id, file: node.file, line: lineOf(n), text: callText });
				} else if (target.reason && target.reasonDecls.some((d) => edge.inside(d.getSourceFile().fileName))) {
					stops.push({ reason: target.reason, fromNode: id, file: node.file, line: lineOf(n), text: callText });
				}
				for (const decl of [...target.decls, ...target.reasonDecls]) {
					if (!edge.inside(decl.getSourceFile().fileName)) {
						record(decl, 'call', n, callText, false);
						continue;
					}
					if (depth >= opts.maxDepth) {
						truncated = true;
						continue;
					}
					// A call into a sibling package lands on `dist/*.d.ts`, which
					// carries no body. D15 remaps the path for attribution; this
					// step remaps the declaration itself, so the walk can go on.
					const bodyless = isFunctionLike(decl) && !decl.body;
					const viaSource = (bodyless || !isFunctionLike(decl)) && opts.throughDist ? opts.throughDist(decl, pending) : [];
					const next = viaSource.length ? viaSource : isFunctionLike(decl) ? [decl] : seedFunctions(decl);
					for (const s of next) {
						calls.push({ from: id, to: fnId(s), line: lineOf(n), text: callText });
						if (!seen.has(fnId(s))) queue.push({ fn: s, depth: depth + 1 });
					}
				}
			} else if (opts.references && ts.isIdentifier(n) && !isPropertyName(n)) {
				for (const decl of declarationsOf(checker, n)) {
					if (edge.inside(decl.getSourceFile().fileName)) continue;
					if (decl.getSourceFile().isDeclarationFile && !edge.rel(decl.getSourceFile().fileName)) {
						record(decl, 'reference', n, n.text, true);
						continue;
					}
					record(decl, 'reference', n, n.text, !isValueDecl(decl));
				}
			}
			ts.forEachChild(n, visit);
		};

		// The signature carries type dependencies that the body never mentions.
		for (const p of fn.parameters) visit(p);
		if (fn.type) visit(fn.type);
		if (fn.body) visit(fn.body);
		else stops.push({ reason: 'interface', fromNode: id, file: node.file, line: node.start, text: `${node.name} has no body` });
	}

	return { nodes, calls, crossings, stops, resolved, seedIds, truncated, maxDepth, pending };
}

/**
 * Map a declaration in a built `.d.ts` onto the same declaration in the source
 * file. It returns the functions to walk, and it records a file the program
 * has not loaded yet, so the caller can add it and walk again.
 */
type Redirect = (decl: ts.Declaration, pending: Set<string>) => FunctionLike[];

function makeRedirect(root: string, ws: Workspace, project: Project): Redirect {
	return (decl, pending) => {
		const sf = decl.getSourceFile();
		if (!sf.isDeclarationFile) return [];
		const source = toSourcePath(root, ws, sf.fileName);
		if (!source || source === sf.fileName || /\.d\.ts$/.test(source)) return [];
		const loaded = project.getSourceFile(source);
		if (!loaded) {
			pending.add(source);
			return [];
		}
		const name = nameOfDecl(decl) ?? memberName(decl);
		if (!name) return [];
		const ref: SymbolRef = { file: path.relative(root, source), name, raw: name };
		const found = findDeclarations(loaded.compilerNode as ts.SourceFile, ref);
		return seedsOf(found);
	};
}

function isPropertyName(n: ts.Identifier): boolean {
	const p = n.parent;
	if (!p) return false;
	if (ts.isPropertyAccessExpression(p) && p.name === n) return false; // a member name still resolves
	if (ts.isQualifiedName(p) && p.right === n) return false;
	if (ts.isPropertyAssignment(p) && p.name === n) return true;
	if (ts.isPropertySignature(p) && p.name === n) return true;
	if (ts.isBindingElement(p) && p.propertyName === n) return true;
	if (ts.isParameter(p) && p.name === n) return true;
	return false;
}

function declarationsOf(checker: ts.TypeChecker, n: ts.Identifier): ts.Declaration[] {
	let sym: ts.Symbol | undefined;
	try {
		sym = checker.getSymbolAtLocation(n);
		if (sym && sym.flags & ts.SymbolFlags.Alias) sym = checker.getAliasedSymbol(sym);
	} catch {
		return [];
	}
	return sym?.declarations ?? [];
}

function isValueDecl(d: ts.Declaration): boolean {
	return !(ts.isInterfaceDeclaration(d) || ts.isTypeAliasDeclaration(d) || ts.isTypeParameterDeclaration(d));
}

/**
 * The package that holds an external target. pnpm nests the real package under
 * `.pnpm/<name>@<version>/node_modules/<name>`, so the last segment wins.
 */
function externalPackageOf(abs: string): string | undefined {
	if (isLibFile(abs)) return 'TypeScript standard library';
	const parts = abs.split('node_modules/');
	const tail = parts[parts.length - 1];
	if (parts.length < 2) return undefined;
	const m = tail.match(/^((?:@[^/]+\/)?[^/]+)/);
	return m ? m[1] : undefined;
}

/** `lib.es5.d.ts` and its siblings describe the language, not a dependency. */
function isLibFile(abs: string): boolean {
	return /\/lib\.[a-z0-9.]+\.d\.ts$/.test(abs) || abs.includes('/typescript/lib/lib.');
}

function describeNode(root: string, ws: Workspace, config: Config, fn: FunctionLike, depth: number): FnNode {
	const sf = fn.getSourceFile();
	const abs = toSourcePath(root, ws, sf.fileName) ?? sf.fileName;
	const rel = path.relative(root, abs);
	const count = countFunction(fn);
	return {
		id: fnId(fn),
		name: nameOfFunction(fn),
		kind: DECL_KIND(fn),
		file: rel.startsWith('..') ? sf.fileName : rel,
		start: lineOf(fn),
		end: endLineOf(fn),
		own: count.own,
		inline: count.inline,
		exported: isExported(fn as unknown as ts.Declaration),
		module: moduleForFile(rel, config),
		depth,
		async: !!fn.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword),
		coverage: null,
		effects: [],
	};
}

function nameOfFunction(fn: FunctionLike): string {
	const own = (fn as { name?: ts.Node }).name;
	if (own && (ts.isIdentifier(own) || ts.isStringLiteral(own))) {
		const cls = fn.parent && ts.isClassDeclaration(fn.parent) ? fn.parent.name?.text : undefined;
		return cls ? `${cls}.${own.text}` : own.text;
	}
	if (ts.isConstructorDeclaration(fn)) {
		const cls = fn.parent && ts.isClassDeclaration(fn.parent) ? fn.parent.name?.text : undefined;
		return `${cls ?? 'class'}.constructor`;
	}
	const p = fn.parent;
	if (p && ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text;
	if (p && (ts.isPropertyAssignment(p) || ts.isPropertyDeclaration(p)) && p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) return p.name.text;
	if (p && ts.isCallExpression(p)) return `callback of ${oneLine(p.expression.getText()).slice(0, 40)}`;
	return `anonymous@${lineOf(fn)}`;
}

// ----------------------------------------------------------------- the run

export function evaluateSymbol(input: SymbolInput): SymbolReport {
	const { root, config, log = () => {} } = input;
	const timings: Record<string, number> = {};
	const notes: string[] = [];
	let t = Date.now();

	const ws = readWorkspace(root);
	timings.workspace = Date.now() - t;

	t = Date.now();
	const t1 = runTier1(root, ws, config);
	timings.tier1 = t1.ms;
	t = Date.now();
	const graph = buildTier1Model(t1, config);
	timings.model = Date.now() - t;
	log(`  tier 1 ${t1.files.size} files ${t1.ms}ms, ${graph.modules.size} modules`);

	const ref = parseRef(t1, root, input.ref);
	const from = input.from ? normaliseFile(t1, root, input.from) : undefined;
	const prog = loadProgram(root, ref.file, input.program ?? 'lazy', from);
	timings.program = prog.ms;
	log(`  program ${input.program ?? 'lazy'} ${prog.files} files ${prog.ms}ms${from ? `, rooted at ${from}` : ''}`);
	if (from) {
		notes.push(`--from is on: the program is rooted at ${from}, so it spans that consumer. The walk still starts at the symbol. (D18)`);
		if (from === ref.file) notes.push('--from names the file the symbol is in, so it changed nothing.');
	}

	const sf = prog.project.getSourceFile(path.join(root, ref.file))?.compilerNode as ts.SourceFile | undefined;
	if (!sf) throw new SymbolNotFound(`${ref.file} is not in the program`, []);
	const decls = findDeclarations(sf, ref);
	if (!decls.length) {
		throw new SymbolNotFound(`no declaration named "${ref.member ? `${ref.name}.${ref.member}` : ref.name}" in ${ref.file}`, namedDeclarationsOf(sf));
	}
	const seeds = seedsOf(decls);
	const primary = decls[0];
	const typeOnly = decls.every((d) => !isValueDecl(d) || (ts.isVariableDeclaration(d) && !d.initializer));

	const edgeKind = input.edge ?? 'module';
	const edge = makeEdge(edgeKind, root, ws, config, ref.file);
	const maxDepth = input.maxDepth ?? 12;
	const maxNodes = input.maxNodes ?? 4000;
	const references = input.references !== false;

	t = Date.now();
	const followDist = input.followDist === true;
	const closures = input.closures !== false;
	let checker = prog.checker;
	let w = walk(root, ws, config, checker, seeds, edge, { maxDepth, maxNodes, references, closures, throughDist: followDist ? makeRedirect(root, ws, prog.project) : undefined });
	for (let round = 0; followDist && w.pending.size && round < 3; round++) {
		for (const file of w.pending) prog.project.addSourceFileAtPathIfExists(file);
		prog.project.resolveSourceFileDependencies();
		checker = freshChecker(prog.project);
		log(`  follow-dist round ${round + 1}: ${w.pending.size} source files added, ${prog.project.getSourceFiles().length} in the program`);
		w = walk(root, ws, config, checker, seeds, edge, { maxDepth, maxNodes, references, closures, throughDist: makeRedirect(root, ws, prog.project) });
	}
	timings.walk = Date.now() - t;
	if (followDist) notes.push('--follow-dist is on: the walk enters a sibling package through its source, not its built declaration. (D15)');
	if (!closures) notes.push('--no-closures is on: a call through a local closure stays a `function-type` stop. (D17)');
	const dropped = w.resolved.filter((r) => r.complete).length;
	if (dropped) notes.push(`the closure pass resolved ${dropped} call${dropped === 1 ? '' : 's'} that the checker left as a \`function-type\` stop. (D17)`);
	log(`  walk ${w.nodes.size} functions, ${w.crossings.length} crossings, ${w.stops.length} stops, ${timings.walk}ms`);
	if (w.truncated) notes.push(`the walk hit a limit: depth ${maxDepth}, nodes ${maxNodes}. The numbers are a floor.`);

	const moduleId = moduleForFile(ref.file, config);
	const shape = moduleId ? graph.modules.get(moduleId) : undefined;
	if (!moduleId) notes.push('no D1 module pattern matches this file, so the module edge falls back to the file. (open question 11)');

	// --- fact 5, effects. ast-grep runs over the files the walk reached. (D7)
	t = Date.now();
	const reachedFiles = [...new Set([...w.nodes.values()].map((n) => n.file))].filter((f) => fs.existsSync(path.join(root, f)));
	const scope = reachedFiles.length <= 200 ? reachedFiles : [...new Set(reachedFiles.map((f) => path.dirname(f)))];
	const astGrep = hasAstGrep();
	const effectMatches = astGrep ? findEffects(root, scope, config) : new Map<string, Match[]>();
	const effectHits: SymbolReport['facts']['effects']['hits'] = [];
	const effectSeen = new Set<string>();
	for (const [category, matches] of effectMatches) {
		for (const m of matches) {
			const host = innermost([...w.nodes.values()], m.file, m.line);
			if (!host) continue;
			const key = `${category}|${m.file}|${m.line}`;
			if (effectSeen.has(key)) continue;
			effectSeen.add(key);
			effectHits.push({ category, file: m.file, line: m.line, inFunction: host.name, depth: host.depth });
			if (!host.effects.includes(category)) host.effects.push(category);
		}
	}
	effectHits.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
	timings.effects = Date.now() - t;

	// A provider can put a symbol on the boundary without an `export`. (D3)
	const providers: SymbolReport['facts']['boundary']['providers'] = [];
	if (astGrep) {
		for (const p of config.providers) {
			for (const m of findProvided(root, scope, p)) {
				if (!innermost([...w.nodes.values()], m.file, m.line)) continue;
				providers.push({ provider: p.name, name: m.name!, file: m.file, line: m.line });
			}
		}
	}

	// --- fact 6, coverage over the reached function set, the D6 set. (D9)
	const coverage = input.coverage;
	const perFunction: SymbolReport['facts']['coverage']['perFunction'] = [];
	let coveredLines = 0;
	let knownLines = 0;
	if (coverage) {
		for (const n of w.nodes.values()) {
			n.coverage = coverageOf(coverage, [{ file: n.file, start: n.start, end: n.end }]);
			perFunction.push({ node: n.name, file: n.file, value: n.coverage });
			const map = coverage.lines.get(n.file);
			if (!map) continue;
			for (let l = n.start; l <= n.end; l++) {
				const hits = map.get(l);
				if (hits === undefined) continue;
				knownLines++;
				if (hits > 0) coveredLines++;
			}
		}
	}
	const allRanges = [...w.nodes.values()].map((n) => ({ file: n.file, start: n.start, end: n.end }));
	const coverageValue = coverage ? coverageOf(coverage, allRanges) : null;
	if (!coverage) notes.push('no coverage report was given, so fact 6 is unknown. (D9, open question 15)');

	// --- facts 3 and 4, the dependencies this symbol reaches.
	const byModule = new Map<ModuleId, { calls: number; references: number; typeOnly: boolean; names: Set<string> }>();
	const byPackage = new Map<string, { calls: number; references: number; names: Set<string> }>();
	const external = new Map<string, { references: number; names: Set<string>; typeOnly: boolean }>();
	for (const c of w.crossings) {
		if (c.module) {
			const e = byModule.get(c.module) ?? { calls: 0, references: 0, typeOnly: true, names: new Set<string>() };
			if (c.kind === 'call') e.calls += c.count;
			else e.references += c.count;
			e.typeOnly = e.typeOnly && c.typeOnly;
			e.names.add(c.name);
			byModule.set(c.module, e);
		}
		if (!c.external && c.package) {
			const e = byPackage.get(c.package) ?? { calls: 0, references: 0, names: new Set<string>() };
			if (c.kind === 'call') e.calls += c.count;
			else e.references += c.count;
			e.names.add(c.name);
			byPackage.set(c.package, e);
		}
		if (c.external) {
			const key = c.package ?? 'unknown';
			const e = external.get(key) ?? { references: 0, names: new Set<string>(), typeOnly: true };
			e.references += c.count;
			e.typeOnly = e.typeOnly && c.typeOnly;
			e.names.add(c.name);
			external.set(key, e);
		}
	}
	const directModules = [...byModule.entries()]
		.map(([module, e]) => ({ module, calls: e.calls, references: e.references, typeOnly: e.typeOnly, names: [...e.names].sort().slice(0, 12) }))
		.sort((a, b) => b.calls + b.references - (a.calls + a.references));
	const indirect = indirectFrom(graph, new Set(byModule.keys()), moduleId);

	// --- fact 1, the boundary status of this one symbol. (D2, D3)
	const importers = importersOf(t1, graph, config, ref);
	const reexportedBy = reexportersOf(t1, config, ref);
	const usedByModules = [...new Set(importers.map((i) => i.module).filter((m): m is ModuleId => !!m && m !== moduleId))].sort();
	const declared = shape?.declared.has(ref.name) ?? false;

	// --- the confidence of this symbol. (D14)
	const reasons = new Map<StopReason, number>();
	for (const s of w.stops) reasons.set(s.reason, (reasons.get(s.reason) ?? 0) + 1);
	const jsFiles = reachedFiles.filter((f) => /\.(js|jsx)$/.test(f)).length;
	if (jsFiles) reasons.set('javascript', jsFiles);
	const stoppedNodes = new Set(w.stops.map((s) => s.fromNode)).size;
	const stopFraction = w.nodes.size ? stoppedNodes / w.nodes.size : 0;
	const jsFraction = reachedFiles.length ? jsFiles / reachedFiles.length : 0;
	const confidenceValue = Math.round(Math.max(0, Math.min(1, 1 - 0.5 * stopFraction - 0.2 * jsFraction)) * 100) / 100;

	const nodes = [...w.nodes.values()].sort((a, b) => b.own + b.inline - (a.own + a.inline));
	const transitive = nodes.reduce((sum, n) => sum + n.own + n.inline, 0);
	const seedNodes = w.seedIds.map((id) => w.nodes.get(id)).filter((n): n is FnNode => !!n);

	const perFile = [...new Map(nodes.map((n) => [n.file, 0])).keys()]
		.map((file) => ({
			file,
			functions: nodes.filter((n) => n.file === file).length,
			complexity: nodes.filter((n) => n.file === file).reduce((s, n) => s + n.own + n.inline, 0),
		}))
		.sort((a, b) => b.complexity - a.complexity);

	t = Date.now();
	// An interface has no call site, so the scan has nothing to find.
	const callers = input.callers && seeds.length ? findCallers(root, prog.project, config, seeds, importers, shape, input.callersDeep === true) : { scanned: 0, sites: [], skipped: 0 };
	if (callers.skipped) notes.push(`the caller scan stopped at ${MAX_CALLER_FILES} files and skipped ${callers.skipped}. Fact 1 still lists every importer.`);
	timings.callers = Date.now() - t;

	const report: SymbolReport = {
		ref,
		edge: edgeKind,
		tree: { root, files: t1.files.size },
		identity: {
			kind: DECL_KIND(primary),
			signature: signatureOf(primary),
			jsdoc: jsdocOf(primary),
			file: ref.file,
			start: lineOf(primary),
			end: endLineOf(primary),
			exported: decls.some(isExported),
			defaultExport: decls.some((d) => (d as { modifiers?: ts.NodeArray<ts.ModifierLike> }).modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword) ?? false),
			typeOnly,
			overloads: decls.length,
			seeds: seeds.length,
			declarations: decls.map((d) => ({ file: path.relative(root, d.getSourceFile().fileName), start: lineOf(d), end: endLineOf(d), kind: DECL_KIND(d) })),
		},
		context: {
			module: moduleId,
			moduleFiles: shape?.files.length,
			moduleEntry: shape?.entry,
			moduleIsTypeOnly: shape ? shape.files.length > 0 && [...shape.declared.values()].every(Boolean) : undefined,
			package: packageDirOf(ws, ref.file) ? packageNameOf(ws, packageDirOf(ws, ref.file)!) : undefined,
			packageDir: packageDirOf(ws, ref.file),
			tsconfig: prog.tsconfig,
			programRoot: from,
			isTestFile: (shape?.testFiles ?? []).includes(ref.file),
		},
		facts: {
			boundary: {
				onDeclaredSurface: declared || !!providers.length,
				declaredInEntry: shape?.entry ? shape.declaredIn.get(ref.name) === shape.entry || (shape.declared.has(ref.name) && !shape.bypassed.has(ref.name)) : false,
				bypassed: shape?.bypassed.has(ref.name) ?? false,
				typeOnly: shape?.declared.get(ref.name) ?? typeOnly,
				unused: declared && !usedByModules.length,
				usedByModules,
				starImporters: [...(shape?.starImporters ?? [])].sort(),
				importers,
				reexportedBy,
				providers,
			},
			complexity: {
				own: seedNodes.reduce((s, n) => s + n.own, 0),
				ownPlusInline: seedNodes.reduce((s, n) => s + n.own + n.inline, 0),
				transitive,
				reach: w.nodes.size,
				depth: w.maxDepth,
				floor: w.stops.length > 0 || w.truncated,
				perFile,
				hotspots: nodes.slice(0, 15),
			},
			directDeps: {
				modules: directModules,
				packages: [...byPackage.entries()].map(([p, e]) => ({ package: p, calls: e.calls, references: e.references, names: [...e.names].sort().slice(0, 12) })).sort((a, b) => b.calls + b.references - (a.calls + a.references)),
				external: [...external.entries()].map(([name, e]) => ({ name, references: e.references, typeOnly: e.typeOnly, names: [...e.names].sort().slice(0, 12) })).sort((a, b) => b.references - a.references),
			},
			indirectDeps: indirect,
			effects: { categories: [...new Set(effectHits.map((h) => h.category))].sort(), hits: effectHits, astGrep },
			coverage: { source: coverage?.source ?? 'none', value: coverageValue, coveredLines, knownLines, perFunction },
		},
		confidence: { value: confidenceValue, reasons: [...reasons].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count) },
		stops: w.stops,
		resolved: w.resolved,
		crossings: w.crossings,
		callers,
		callTree: buildTree(w, input.treeLines ?? 80),
		callEdges: w.calls,
		nodes,
		timings,
		notes,
	};

	if (input.compareEdges) {
		const cmpChecker = freshChecker(prog.project);
		const redirect = followDist ? makeRedirect(root, ws, prog.project) : undefined;
		report.edgesCompared = EDGE_KINDS.map((kind) => {
			const t0 = Date.now();
			const e = makeEdge(kind, root, ws, config, ref.file);
			const r = walk(root, ws, config, cmpChecker, seeds, e, { maxDepth, maxNodes, references: false, closures, throughDist: redirect });
			return {
				edge: kind,
				reach: r.nodes.size,
				transitive: [...r.nodes.values()].reduce((s, n) => s + n.own + n.inline, 0),
				stops: r.stops.length,
				crossings: r.crossings.length,
				modules: new Set(r.crossings.map((c) => c.module).filter(Boolean)).size,
				ms: Date.now() - t0,
			};
		});
	}
	return report;
}

function namedDeclarationsOf(sf: ts.SourceFile): string[] {
	const out = new Set<string>();
	(function visit(node: ts.Node): void {
		const n = nameOfDecl(node);
		if (n) out.add(n);
		ts.forEachChild(node, visit);
	})(sf);
	return [...out].sort();
}

function innermost(nodes: FnNode[], file: string, line: number): FnNode | undefined {
	return nodes.filter((n) => n.file === file && n.start <= line && n.end >= line).sort((a, b) => a.end - a.start - (b.end - b.start))[0];
}

/** Breadth-first over the module graph, seeded from a set instead of one id. (D8) */
function indirectFrom(model: Tier1Model, direct: Set<ModuleId>, self: ModuleId | undefined, maxHops = 5): { module: ModuleId; hops: number }[] {
	const seen = new Set<ModuleId>([...direct]);
	if (self) seen.add(self);
	const out: { module: ModuleId; hops: number }[] = [];
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

/** Every file that imports this name, through a barrel or straight. (D2, D5) */
function importersOf(t1: Tier1, graph: Tier1Model, config: Config, ref: SymbolRef): Importer[] {
	const out: Importer[] = [];
	for (const facts of t1.files.values()) {
		if (facts.rel === ref.file) continue;
		for (const edge of facts.imports) {
			if (!edge.to) continue;
			for (const name of edge.names) {
				if (name === '*') continue;
				const origin = followReexport(t1, edge.to, name, config.reexportDepth);
				const landed = origin ?? { file: edge.to, name };
				if (landed.file !== ref.file || landed.name !== ref.name) continue;
				out.push({ file: facts.rel, module: graph.moduleOf.get(facts.rel), line: edge.line, spec: edge.spec, typeOnly: edge.typeOnly, as: name });
			}
		}
	}
	return out.sort((a, b) => a.file.localeCompare(b.file));
}

/** The barrels that carry this name outward. 17.5% of imports land on one. */
function reexportersOf(t1: Tier1, config: Config, ref: SymbolRef): string[] {
	const out: string[] = [];
	for (const facts of t1.files.values()) {
		if (facts.rel === ref.file) continue;
		for (const re of facts.reexports) {
			if (!re.to) continue;
			const wants = re.star ? [ref.name] : re.names.filter((n) => n.source === ref.name || n.exported === ref.name).map((n) => n.source);
			for (const want of wants) {
				const origin = followReexport(t1, re.to, want, config.reexportDepth);
				if (origin && origin.file === ref.file && origin.name === ref.name) out.push(facts.rel);
			}
		}
	}
	return [...new Set(out)].sort();
}

/**
 * The typed call sites of this symbol, which is the blast radius of D10 at the
 * symbol level. It scans the importer files and the module files that the
 * program already holds. A file outside the program is reported by tier 1 only.
 */
function findCallers(
	root: string,
	project: Project,
	config: Config,
	seeds: FunctionLike[],
	importers: Importer[],
	shape: ModuleShape | undefined,
	deep: boolean,
): { scanned: number; sites: CallerSite[]; skipped: number } {
	const wanted = new Set(seeds.map((s) => fnId(s)));
	// The importers come from tier 1 and they are exact. A module scan adds the
	// callers inside the module, and it costs about 15ms per file.
	const inModule = deep ? [...(shape?.files ?? []), ...(shape?.testFiles ?? [])] : (shape?.files ?? []).filter((f) => f === undefined);
	const all = [...new Set([...importers.map((i) => i.file), ...inModule, ...seeds.map((s) => path.relative(root, s.getSourceFile().fileName))])];
	const files = all.slice(0, MAX_CALLER_FILES);
	const skipped = all.length - files.length;
	// Add every file first, then take the checker: the program must not change
	// under it.
	for (const rel of files) {
		const abs = path.join(root, rel);
		if (!project.getSourceFile(abs)) project.addSourceFileAtPathIfExists(abs);
	}
	const checker = freshChecker(project);
	const sites: CallerSite[] = [];
	let scanned = 0;
	for (const rel of files) {
		const sf = project.getSourceFile(path.join(root, rel))?.compilerNode as ts.SourceFile | undefined;
		if (!sf) continue;
		scanned++;
		(function visit(node: ts.Node): void {
			if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
				const target = resolveCallee(checker, node);
				if ([...target.decls, ...target.reasonDecls].some((d) => wanted.has(fnId(d)))) {
					let host: ts.Node | undefined = node;
					while (host && !isFunctionLike(host)) host = host.parent;
					sites.push({
						file: rel,
						module: moduleForFile(rel, config),
						line: lineOf(node),
						inFunction: host ? nameOfFunction(host as FunctionLike) : '(top level)',
						text: oneLine(node.getText()).slice(0, 90),
					});
				}
			}
			ts.forEachChild(node, visit);
		})(sf);
	}
	return { scanned, sites, skipped };
}

/** A depth-first render order over the call edges, with repeats marked. */
function buildTree(w: WalkResult, limit: number): TreeLine[] {
	const children = new Map<string, CallEdge[]>();
	for (const c of w.calls) children.set(c.from, [...(children.get(c.from) ?? []), c]);
	const stopsBy = new Map<string, Stop[]>();
	for (const s of w.stops) stopsBy.set(s.fromNode, [...(stopsBy.get(s.fromNode) ?? []), s]);
	const out: TreeLine[] = [];
	const seen = new Set<string>();

	function emit(id: string, depth: number, line: number, via?: CallEdge['via']): void {
		if (out.length >= limit) return;
		const node = w.nodes.get(id);
		if (!node) return;
		const repeat = seen.has(id);
		out.push({ depth, node: id, name: node.name, file: node.file, line: line || node.start, own: node.own, inline: node.inline, repeat, via });
		if (repeat) return;
		seen.add(id);
		for (const s of stopsBy.get(id) ?? []) {
			if (out.length >= limit) return;
			out.push({ depth: depth + 1, node: `${id}!stop`, name: s.text, file: s.file, line: s.line, own: 0, inline: 0, repeat: false, stop: s.reason });
		}
		const kids = [...new Map((children.get(id) ?? []).map((c) => [c.to, c])).values()];
		for (const c of kids) emit(c.to, depth + 1, c.line, c.via);
	}
	for (const seed of w.seedIds) emit(seed, 0, 0);
	return out;
}
