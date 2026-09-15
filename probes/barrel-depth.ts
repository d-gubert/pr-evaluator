/**
 * Probe for open question 2: barrel files, and for D5: the cost of tier 1.
 *
 * Tier 1 is a syntactic scan of the whole repo. It must answer "who imports
 * what". A barrel (`export * from './x'`) hides the real source, so a naive
 * scan credits the barrel instead of the module. This probe measures how much
 * of the repo sits behind a barrel, how deep the chains go, and how long the
 * whole scan takes.
 *
 * Usage: tsx probes/barrel-depth.ts --repo <path>
 */
import * as ts from 'typescript';
import * as fs from 'node:fs';
import * as path from 'node:path';

const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.meteor', 'coverage', '.next', 'public']);
const EXT = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

function walk(dir: string, out: string[] = []): string[] {
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return out;
	}
	for (const e of entries) {
		if (e.name.startsWith('.') && e.name !== '.scripts') continue;
		const full = path.join(dir, e.name);
		if (e.isDirectory()) {
			if (!SKIP.has(e.name)) walk(full, out);
		} else if (EXT.includes(path.extname(e.name)) && !e.name.endsWith('.d.ts')) {
			out.push(full);
		}
	}
	return out;
}

/** Map every workspace package name to its directory. Needed for D8 too. */
function workspaceMap(repo: string): Map<string, string> {
	const map = new Map<string, string>();
	for (const root of ['packages', 'apps', 'ee/packages', 'ee/apps']) {
		const base = path.join(repo, root);
		if (!fs.existsSync(base)) continue;
		for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			const dir = path.join(base, entry.name);
			const pkgPath = path.join(dir, 'package.json');
			if (!fs.existsSync(pkgPath)) continue;
			try {
				const name = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).name;
				if (name) map.set(name, dir);
			} catch {
				/* a broken package.json is not this probe's problem */
			}
			// Nested workspaces, such as packages/apps/base-runtime.
			for (const nested of fs.readdirSync(dir, { withFileTypes: true })) {
				if (!nested.isDirectory() || SKIP.has(nested.name)) continue;
				const nestedPkg = path.join(dir, nested.name, 'package.json');
				if (!fs.existsSync(nestedPkg)) continue;
				try {
					const name = JSON.parse(fs.readFileSync(nestedPkg, 'utf8')).name;
					if (name) map.set(name, path.join(dir, nested.name));
				} catch {
					/* ignore */
				}
			}
		}
	}
	return map;
}

type Edge = { from: string; spec: string; kind: 'import' | 'reexport'; star: boolean; typeOnly: boolean; names: string[] };

function scan(file: string): Edge[] {
	const text = fs.readFileSync(file, 'utf8');
	const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, ts.ScriptKind.TSX);
	const edges: Edge[] = [];
	for (const st of sf.statements) {
		if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier)) {
			const clause = st.importClause;
			const names: string[] = [];
			if (clause?.name) names.push(clause.name.text);
			if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
				for (const el of clause.namedBindings.elements) names.push((el.propertyName ?? el.name).text);
			}
			const star = !!clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings);
			edges.push({ from: file, spec: st.moduleSpecifier.text, kind: 'import', star, typeOnly: !!clause?.isTypeOnly, names });
		} else if (ts.isExportDeclaration(st) && st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier)) {
			const names: string[] = [];
			if (st.exportClause && ts.isNamedExports(st.exportClause)) {
				for (const el of st.exportClause.elements) names.push((el.propertyName ?? el.name).text);
			}
			edges.push({ from: file, spec: st.moduleSpecifier.text, kind: 'reexport', star: !st.exportClause, typeOnly: st.isTypeOnly, names });
		}
	}
	return edges;
}

/** Resolve a specifier the way tier 1 would: by convention, with no checker. */
function resolveSpec(fromFile: string, spec: string, repo: string, ws: Map<string, string>): string | undefined {
	let base: string;
	if (spec.startsWith('.')) {
		base = path.resolve(path.dirname(fromFile), spec);
	} else {
		// Longest workspace-package prefix wins: @rocket.chat/apps/base-runtime.
		let match: string | undefined;
		for (const name of ws.keys()) {
			if ((spec === name || spec.startsWith(`${name}/`)) && (!match || name.length > match.length)) match = name;
		}
		if (!match) return undefined;
		const rest = spec.slice(match.length).replace(/^\//, '');
		base = path.join(ws.get(match)!, rest);
	}
	const candidates = [
		...EXT.map((e) => base + e),
		...EXT.map((e) => path.join(base, 'index' + e)),
		...EXT.map((e) => path.join(base, 'src', 'index' + e)),
	];
	return candidates.find((c) => fs.existsSync(c) && fs.statSync(c).isFile());
}

function run() {
	const repoArg = process.argv.indexOf('--repo');
	const repo = path.resolve(process.argv[repoArg + 1]);

	let t = Date.now();
	const files = walk(repo);
	const walkMs = Date.now() - t;

	const ws = workspaceMap(repo);

	t = Date.now();
	const edges: Edge[] = [];
	for (const f of files) edges.push(...scan(f));
	const parseMs = Date.now() - t;

	t = Date.now();
	const resolved = new Map<Edge, string | undefined>();
	for (const e of edges) resolved.set(e, resolveSpec(e.from, e.spec, repo, ws));
	const resolveMs = Date.now() - t;

	const imports = edges.filter((e) => e.kind === 'import');
	const reexports = edges.filter((e) => e.kind === 'reexport');
	const starReexports = reexports.filter((e) => e.star);

	// A file is a barrel when it only re-exports.
	const byFile = new Map<string, Edge[]>();
	for (const e of edges) byFile.set(e.from, [...(byFile.get(e.from) ?? []), e]);
	const barrels = new Set<string>();
	for (const [file, es] of byFile) {
		const text = fs.readFileSync(file, 'utf8');
		const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, ts.ScriptKind.TSX);
		const onlyReexports = sf.statements.length > 0 && sf.statements.every((s) => ts.isExportDeclaration(s) && !!s.moduleSpecifier);
		if (onlyReexports && es.some((e) => e.kind === 'reexport')) barrels.add(file);
	}

	// Depth of the re-export chain from each barrel.
	const reexportTargets = new Map<string, string[]>();
	for (const e of reexports) {
		const target = resolved.get(e);
		if (target) reexportTargets.set(e.from, [...(reexportTargets.get(e.from) ?? []), target]);
	}
	function depth(file: string, seen = new Set<string>()): number {
		if (seen.has(file)) return 0;
		seen.add(file);
		const next = reexportTargets.get(file) ?? [];
		if (next.length === 0) return 0;
		return 1 + Math.max(...next.map((n) => depth(n, seen)));
	}
	const depths = [...barrels].map((b) => ({ file: b, d: depth(b) })).sort((a, b) => b.d - a.d);

	const importsToBarrel = imports.filter((e) => {
		const target = resolved.get(e);
		return target && barrels.has(target);
	});
	const unresolvedImports = imports.filter((e) => !resolved.get(e));
	const bareUnresolved = unresolvedImports.filter((e) => !e.spec.startsWith('.'));

	console.log(`files scanned      ${files.length}`);
	console.log(`workspace packages ${ws.size}`);
	console.log(`walk               ${walkMs}ms`);
	console.log(`parse              ${parseMs}ms   (${(parseMs / files.length).toFixed(2)}ms/file)`);
	console.log(`resolve            ${resolveMs}ms`);
	console.log(`TIER 1 TOTAL       ${((walkMs + parseMs + resolveMs) / 1000).toFixed(1)}s`);
	console.log();
	console.log(`import statements  ${imports.length}`);
	console.log(`  type-only        ${imports.filter((e) => e.typeOnly).length}`);
	console.log(`  namespace (* as) ${imports.filter((e) => e.star).length}`);
	console.log(`  unresolved       ${unresolvedImports.length} (${((unresolvedImports.length / imports.length) * 100).toFixed(1)}%), of which bare/external ${bareUnresolved.length}`);
	console.log(`  land on a barrel ${importsToBarrel.length} (${((importsToBarrel.length / imports.length) * 100).toFixed(1)}%)  <- OQ2`);
	console.log();
	console.log(`re-export stmts    ${reexports.length}`);
	console.log(`  export *         ${starReexports.length} (${((starReexports.length / Math.max(reexports.length, 1)) * 100).toFixed(1)}%)`);
	console.log(`barrel files       ${barrels.size}`);
	console.log(`deepest chains:`);
	for (const { file, d } of depths.slice(0, 8)) console.log(`  depth ${d}  ${path.relative(repo, file)}`);
	const histogram = new Map<number, number>();
	for (const { d } of depths) histogram.set(d, (histogram.get(d) ?? 0) + 1);
	console.log(`chain depth histogram: ${[...histogram.entries()].sort((a, b) => a[0] - b[0]).map(([d, n]) => `${d}:${n}`).join(' ')}`);

	// Which unresolved bare specifiers are most common? These are the gaps a
	// tier 1 resolver must close.
	const bareCounts = new Map<string, number>();
	for (const e of bareUnresolved) {
		const root = e.spec.startsWith('@') ? e.spec.split('/').slice(0, 2).join('/') : e.spec.split('/')[0];
		bareCounts.set(root, (bareCounts.get(root) ?? 0) + 1);
	}
	console.log(`top unresolved bare specifiers: ${[...bareCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([s, n]) => `${s}=${n}`).join(' ')}`);
}

run();
