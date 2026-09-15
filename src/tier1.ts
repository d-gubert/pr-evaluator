/**
 * Tier 1: a syntactic scan of the whole tree. It never leaves the git-tracked
 * source tree and it never follows a symlink into node_modules. (D5, D15)
 *
 * It costs about 2.6s for 9282 files, so two trees cost about 5s.
 */
import * as ts from 'typescript';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Config } from './config.js';
import { splitSpecifier, type Workspace } from './workspace.js';

const EXT = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.meteor', 'coverage', '.next', '.turbo']);

export interface ImportEdge {
	/** Repo-relative importer. */
	from: string;
	spec: string;
	/** Imported names, as written at the source. `default` and `*` are literal. */
	names: string[];
	typeOnly: boolean;
	line: number;
	/** Repo-relative target, or undefined when the specifier is external. */
	to?: string;
}

export interface ReexportEdge {
	from: string;
	spec: string;
	/** exported name -> name in the target. Empty when `export *`. */
	names: { exported: string; source: string }[];
	star: boolean;
	typeOnly: boolean;
	to?: string;
}

export interface ExportDecl {
	name: string;
	typeOnly: boolean;
	line: number;
}

export interface FileFacts {
	rel: string;
	imports: ImportEdge[];
	reexports: ReexportEdge[];
	exports: ExportDecl[];
	/** A file that only re-exports. 369 of them in Rocket.Chat. */
	isBarrel: boolean;
	/** True for .js and .jsx. `checkJs` is false, so tier 2 trusts these less. (OQ13) */
	isJs: boolean;
}

export interface Tier1 {
	root: string;
	files: Map<string, FileFacts>;
	ms: number;
}

export function walkTree(root: string, config: Config): string[] {
	const out: string[] = [];
	const excluded = new Set(config.exclude);
	(function rec(dir: string) {
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const e of entries) {
			if (e.name.startsWith('.')) continue;
			const full = path.join(dir, e.name);
			if (e.isDirectory()) {
				if (!SKIP.has(e.name) && !excluded.has(path.relative(root, full))) rec(full);
			} else if (EXT.includes(path.extname(e.name)) && !e.name.endsWith('.d.ts')) {
				out.push(full);
			}
		}
	})(root);
	return out;
}

function scanFile(root: string, abs: string): FileFacts | undefined {
	const rel = path.relative(root, abs);
	let text: string;
	try {
		text = fs.readFileSync(abs, 'utf8');
	} catch {
		return undefined; // A broken symlink, such as a storybook config.
	}
	const sf = ts.createSourceFile(abs, text, ts.ScriptTarget.Latest, false, ts.ScriptKind.TSX);
	const facts: FileFacts = { rel, imports: [], reexports: [], exports: [], isBarrel: false, isJs: /\.(js|jsx|mjs|cjs)$/.test(rel) };
	const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

	for (const st of sf.statements) {
		if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier)) {
			const clause = st.importClause;
			const names: string[] = [];
			if (clause?.name) names.push('default');
			const nb = clause?.namedBindings;
			if (nb && ts.isNamedImports(nb)) for (const el of nb.elements) names.push((el.propertyName ?? el.name).text);
			if (nb && ts.isNamespaceImport(nb)) names.push('*');
			facts.imports.push({ from: rel, spec: st.moduleSpecifier.text, names, typeOnly: !!clause?.isTypeOnly, line: lineOf(st) });
			continue;
		}
		if (ts.isExportDeclaration(st)) {
			if (st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier)) {
				const names: { exported: string; source: string }[] = [];
				if (st.exportClause && ts.isNamedExports(st.exportClause)) {
					for (const el of st.exportClause.elements) names.push({ exported: el.name.text, source: (el.propertyName ?? el.name).text });
				}
				facts.reexports.push({ from: rel, spec: st.moduleSpecifier.text, names, star: !st.exportClause, typeOnly: st.isTypeOnly });
			} else if (st.exportClause && ts.isNamedExports(st.exportClause)) {
				for (const el of st.exportClause.elements) facts.exports.push({ name: el.name.text, typeOnly: st.isTypeOnly || el.isTypeOnly, line: lineOf(el) });
			}
			continue;
		}
		const mods = ts.canHaveModifiers(st) ? ts.getModifiers(st) : undefined;
		if (!mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
		const isDefault = mods.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
		const typeOnly = ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st);
		const push = (name: string) => facts.exports.push({ name: isDefault ? 'default' : name, typeOnly, line: lineOf(st) });
		if (ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st) || ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st) || ts.isEnumDeclaration(st)) {
			push(st.name?.text ?? 'default');
		} else if (ts.isVariableStatement(st)) {
			for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name)) push(d.name.text);
		}
	}
	if (ts.isSourceFile(sf)) {
		const stmts = sf.statements.filter((s) => !ts.isImportDeclaration(s));
		facts.isBarrel = stmts.length > 0 && stmts.every((s) => ts.isExportDeclaration(s) && !!s.moduleSpecifier);
	}
	return facts;
}

/**
 * Resolve a specifier by convention. It stays inside the source tree: a bare
 * specifier goes through the workspace map, never through node_modules. (D15)
 */
export function resolveSpec(root: string, ws: Workspace, fromRel: string, spec: string): string | undefined {
	const bases: string[] = [];
	if (spec.startsWith('.')) {
		bases.push(path.join(path.dirname(fromRel), spec));
	} else {
		const found = splitSpecifier(ws, spec);
		if (!found) return undefined;
		// The source tree wins over a built file. `apps-engine` commits its
		// build at the package root, so `@rocket.chat/apps-engine/definition/users`
		// finds `definition/users/index.js` before `src/definition/users.ts`. (D15)
		bases.push(path.join(found.dir, 'src', found.rest));
		bases.push(path.join(found.dir, found.rest));
	}
	for (const baseRel of bases) {
		if (baseRel.startsWith('..')) continue;
		const stem = baseRel.replace(/\.(js|jsx|mjs|cjs)$/, '');
		const candidates = [...EXT.map((e) => stem + e), ...EXT.map((e) => path.join(baseRel, 'index' + e)), ...EXT.map((e) => path.join(baseRel, 'src', 'index' + e))];
		for (const c of candidates) {
			const abs = path.join(root, c);
			if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return c;
		}
	}
	return undefined;
}

export function runTier1(root: string, ws: Workspace, config: Config): Tier1 {
	const t0 = Date.now();
	const files = new Map<string, FileFacts>();
	for (const abs of walkTree(root, config)) {
		const f = scanFile(root, abs);
		if (f) files.set(f.rel, f);
	}
	for (const f of files.values()) {
		for (const e of f.imports) e.to = resolveSpec(root, ws, f.rel, e.spec);
		for (const e of f.reexports) e.to = resolveSpec(root, ws, f.rel, e.spec);
	}
	return { root, files, ms: Date.now() - t0 };
}

/**
 * Follow a re-export chain to the file that declares the name. 17.5% of imports
 * land on a barrel, and the deepest chain in Rocket.Chat is 4, so a depth limit
 * of 6 replaces a fixed-point algorithm. (D5)
 */
export function followReexport(t1: Tier1, fileRel: string, name: string, depth: number): { file: string; name: string } | undefined {
	const seen = new Set<string>();
	function step(file: string, want: string, left: number): { file: string; name: string } | undefined {
		const key = `${file}#${want}`;
		if (left < 0 || seen.has(key)) return undefined;
		seen.add(key);
		const facts = t1.files.get(file);
		if (!facts) return undefined;
		if (facts.exports.some((e) => e.name === want)) return { file, name: want };
		for (const re of facts.reexports) {
			if (!re.to) continue;
			const named = re.names.find((n) => n.exported === want);
			if (named) {
				const hit = step(re.to, named.source, left - 1);
				if (hit) return hit;
			}
		}
		for (const re of facts.reexports) {
			if (re.star && re.to) {
				const hit = step(re.to, want, left - 1);
				if (hit) return hit;
			}
		}
		// The name exists here, but the chain is longer than the limit or it
		// crosses a file we cannot read. Credit the file we stopped at.
		return undefined;
	}
	return step(fileRel, name, depth);
}
