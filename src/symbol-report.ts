/**
 * The symbol view. JSON stays the contract; this is a view of it. (D12)
 *
 * It prints every fact the engine produced, plus the evidence behind each
 * number: the call tree, the stop sites, the edge crossings and the importers.
 * The prototype exists to look at real numbers, so the view hides nothing by
 * default. `--brief` drops the evidence sections.
 */
import type { SymbolReport } from './symbol.js';

const pct = (v: number | null) => (v === null ? 'unknown' : `${Math.round(v * 100)}%`);
const yn = (b: boolean) => (b ? 'yes' : 'no');

function pad(s: string, n: number): string {
	return s.length >= n ? `${s.slice(0, n - 2)} ` : s + ' '.repeat(n - s.length);
}

function rule(title: string): string[] {
	return ['', `${title}`, '-'.repeat(Math.max(20, title.length))];
}

export interface ViewOptions {
	brief?: boolean;
	/** How many rows each evidence list prints. */
	rows?: number;
}

export function renderSymbol(r: SymbolReport, opts: ViewOptions = {}): string {
	const rows = opts.rows ?? 20;
	const out: string[] = [];
	const id = r.identity;

	out.push(`symbol     ${r.ref.raw}`);
	out.push(`resolved   ${id.kind}  ${id.file}:${id.start}-${id.end}${id.exported ? '  exported' : '  internal'}${id.defaultExport ? '  default' : ''}`);
	out.push(`signature  ${id.signature}`);
	if (id.jsdoc) out.push(`doc        ${id.jsdoc}`);
	if (id.overloads > 1) out.push(`declarations ${id.overloads} (overloads or a merged declaration)`);
	out.push(`module     ${r.context.module ?? '(none: no D1 pattern matches)'}${r.context.moduleFiles === undefined ? '' : `  ${r.context.moduleFiles} files`}${r.context.moduleEntry ? `  entry ${r.context.moduleEntry}` : '  no entry file'}`);
	out.push(`package    ${r.context.package ?? '(none)'}${r.context.packageDir ? `  ${r.context.packageDir}` : ''}  tsconfig ${r.context.tsconfig ?? '(none)'}`);
	out.push(`edge       ${r.edge}   walk depth ${r.facts.complexity.depth}   reach ${r.facts.complexity.reach} functions`);
	out.push(`tree       ${r.tree.files} files scanned by tier 1`);
	out.push(`timings    ${Object.entries(r.timings).map(([k, v]) => `${k} ${v}ms`).join('   ')}`);
	for (const n of r.notes) out.push(`note       ${n}`);

	// ------------------------------------------------------------- fact 1
	const b = r.facts.boundary;
	out.push(...rule('FACT 1 — boundary (D2, D3)'));
	if (r.ref.member) out.push(`  the reference names a member, so fact 1 describes the holder "${r.ref.name}".`);
	out.push(`  on the declared surface   ${yn(b.onDeclaredSurface)}${b.typeOnly ? '   type-only symbol' : ''}`);
	out.push(`  declared in the entry     ${yn(b.declaredInEntry)}`);
	out.push(`  bypassed (imported deep)  ${yn(b.bypassed)}`);
	out.push(`  declared and unused       ${yn(b.unused)}`);
	out.push(`  used by ${b.usedByModules.length} other modules${b.usedByModules.length ? `: ${b.usedByModules.slice(0, 10).join(', ')}${b.usedByModules.length > 10 ? ', ...' : ''}` : ''}`);
	out.push(`  imported by ${b.importers.length} files`);
	if (!opts.brief) {
		for (const i of b.importers.slice(0, rows)) {
			out.push(`    ${pad(i.typeOnly ? 'type' : 'value', 7)}${pad(i.spec, 44)}${i.file}:${i.line}${i.as !== r.ref.name ? `  as ${i.as}` : ''}`);
		}
		if (b.importers.length > rows) out.push(`    ... and ${b.importers.length - rows} more`);
	}
	if (b.reexportedBy.length) out.push(`  re-exported by ${b.reexportedBy.length}: ${b.reexportedBy.slice(0, 6).join(', ')}${b.reexportedBy.length > 6 ? ', ...' : ''}`);
	if (b.starImporters.length) out.push(`  reached by import * from: ${b.starImporters.join(', ')}`);
	for (const p of b.providers) out.push(`  provider ${p.provider}: ${p.name}  ${p.file}:${p.line}`);

	// ------------------------------------------------------------- fact 2
	const c = r.facts.complexity;
	out.push(...rule('FACT 2 — cyclomatic complexity (D6)'));
	out.push(`  own (the symbol alone)          ${c.own}`);
	out.push(`  own + inline callbacks          ${c.ownPlusInline}`);
	out.push(`  transitive inside the ${pad(`${r.edge} edge`, 14)}${c.transitive}${c.floor ? '   FLOOR: the walk stopped, see below (D14)' : ''}`);
	out.push(`  functions reached               ${c.reach} in ${c.perFile.length} files, depth ${c.depth}`);
	if (c.hotspots.length > 1) {
		out.push('');
		out.push('  ' + pad('hotspot', 44) + pad('cplx', 7) + pad('depth', 7) + 'location');
		for (const h of c.hotspots.slice(0, rows)) {
			out.push('  ' + pad(h.name, 44) + pad(String(h.own + h.inline), 7) + pad(String(h.depth), 7) + `${h.file}:${h.start}`);
		}
	}
	if (!opts.brief && c.perFile.length > 1) {
		out.push('');
		for (const f of c.perFile.slice(0, rows)) out.push(`  ${pad(f.file, 60)}${pad(`${f.functions} fn`, 8)}${f.complexity}`);
	}

	// ------------------------------------------------------- facts 3 and 4
	const d = r.facts.directDeps;
	out.push(...rule('FACT 3 — direct dependencies this symbol reaches (D8)'));
	if (!d.modules.length && !d.external.length) out.push('  none');
	for (const m of d.modules.slice(0, rows)) {
		out.push(`  ${pad(m.module, 52)}${pad(`${m.calls} calls`, 11)}${pad(`${m.references} refs`, 10)}${m.typeOnly ? 'type-only  ' : '           '}${m.names.slice(0, 5).join(', ')}`);
	}
	if (d.external.length) {
		out.push('  external:');
		for (const e of d.external.slice(0, rows)) out.push(`    ${pad(e.name, 40)}${pad(`${e.references} refs`, 10)}${pad(e.typeOnly ? 'type-only' : 'value', 11)}${e.names.slice(0, 6).join(', ')}`);
	}
	out.push(...rule('FACT 4 — indirect dependencies, with the hop count (D8)'));
	if (!r.facts.indirectDeps.length) out.push('  none');
	for (const i of r.facts.indirectDeps.slice(0, rows)) out.push(`  ${pad(i.module, 60)}${i.hops} hops`);
	if (r.facts.indirectDeps.length > rows) out.push(`  ... and ${r.facts.indirectDeps.length - rows} more`);

	// ------------------------------------------------------------- fact 5
	const e = r.facts.effects;
	out.push(...rule('FACT 5 — side effects (D7)'));
	if (!e.astGrep) out.push('  ast-grep is not on the PATH, so the catalog did not run.');
	out.push(`  categories: ${e.categories.join(', ') || 'none'}`);
	if (!opts.brief) {
		for (const h of e.hits.slice(0, rows)) out.push(`    ${pad(h.category, 10)}${pad(`in ${h.inFunction}`, 44)}depth ${h.depth}   ${h.file}:${h.line}`);
		if (e.hits.length > rows) out.push(`    ... and ${e.hits.length - rows} more`);
	}

	// ------------------------------------------------------------- fact 6
	const cov = r.facts.coverage;
	out.push(...rule('FACT 6 — test coverage (D9)'));
	out.push(`  source ${cov.source}   value ${pct(cov.value)}   ${cov.coveredLines}/${cov.knownLines} known lines`);
	if (!opts.brief && cov.perFunction.length) {
		for (const f of cov.perFunction.filter((x) => x.value !== null).slice(0, rows)) out.push(`    ${pad(f.node, 44)}${pad(pct(f.value), 8)}${f.file}`);
	}

	// --------------------------------------------------------- confidence
	out.push(...rule('CONFIDENCE (D14)'));
	out.push(`  value ${r.confidence.value.toFixed(2)}${r.confidence.reasons.length ? `   ${r.confidence.reasons.map((x) => `${x.reason}=${x.count}`).join(', ')}` : '   nothing lowered it'}`);
	if (r.facts.complexity.floor) out.push('  A marked number is a floor, not a total.');
	if (!opts.brief && r.stops.length) {
		out.push('  where the walk stopped:');
		for (const s of r.stops.slice(0, rows)) out.push(`    ${pad(s.reason, 14)}${pad(s.text, 44)}${s.file}:${s.line}`);
		if (r.stops.length > rows) out.push(`    ... and ${r.stops.length - rows} more`);
	}

	// ---------------------------------------------------------- call tree
	if (!opts.brief && r.callTree.length) {
		out.push(...rule('CALL TREE (D6, the set that facts 2, 5 and 6 measure)'));
		for (const t of r.callTree) {
			const indent = '  ' + '   '.repeat(Math.max(0, t.depth));
			if (t.stop) out.push(`${indent}✗ ${t.stop}: ${t.name}  (${t.file}:${t.line})`);
			else out.push(`${indent}${t.depth ? '└─ ' : ''}${pad(t.name, 46 - Math.min(40, 3 * t.depth))}+${pad(String(t.own + t.inline), 5)}${t.file}:${t.line}${t.repeat ? '  (seen)' : ''}`);
		}
	}

	// ------------------------------------------------------------ callers
	if (r.callers.scanned) {
		out.push(...rule('CALLERS (D10 at the symbol level)'));
		out.push(`  ${r.callers.sites.length} call sites in ${r.callers.scanned} scanned files${r.callers.skipped ? `, ${r.callers.skipped} files not scanned` : ''}`);
		for (const s of r.callers.sites.slice(0, rows)) out.push(`    ${pad(s.inFunction, 32)}${pad(s.text, 46)}${s.file}:${s.line}`);
		if (r.callers.sites.length > rows) out.push(`    ... and ${r.callers.sites.length - rows} more`);
	}

	// ---------------------------------------------------- edge comparison
	if (r.edgesCompared) {
		out.push(...rule('EDGE COMPARISON (what D6 would report at each stop rule)'));
		out.push('  ' + pad('edge', 10) + pad('reach', 8) + pad('cplx', 8) + pad('stops', 8) + pad('crossings', 11) + pad('modules', 9) + 'ms');
		for (const x of r.edgesCompared) {
			out.push('  ' + pad(x.edge, 10) + pad(String(x.reach), 8) + pad(String(x.transitive), 8) + pad(String(x.stops), 8) + pad(String(x.crossings), 11) + pad(String(x.modules), 9) + String(x.ms));
		}
	}
	return out.join('\n');
}

/** A Graphviz view of the same call tree, for a picture instead of a list. */
export function renderDot(r: SymbolReport): string {
	const lines = ['digraph symbol {', '  rankdir=LR;', '  node [shape=box, fontname="monospace", fontsize=10];'];
	const seedSet = new Set(r.nodes.filter((n) => n.depth === 0).map((n) => n.id));
	for (const n of r.nodes) {
		const label = `${n.name}\\n${n.file.split('/').pop()}:${n.start}\\ncplx ${n.own + n.inline}${n.effects.length ? `\\n${n.effects.join(',')}` : ''}`;
		const fill = seedSet.has(n.id) ? 'lightblue' : n.effects.length ? 'lightyellow' : 'white';
		lines.push(`  "${n.id}" [label="${label}", style=filled, fillcolor=${fill}];`);
	}
	const seen = new Set<string>(r.nodes.map((n) => n.id));
	for (const c of r.crossings.filter((x) => x.kind === 'call').slice(0, 60)) {
		const id = `out:${x0(c.module ?? c.package ?? 'external')}`;
		if (!seen.has(id)) {
			seen.add(id);
			lines.push(`  "${id}" [label="${c.module ?? c.package ?? 'external'}", shape=ellipse, style=dashed];`);
		}
		lines.push(`  "${c.fromNode}" -> "${id}" [style=dashed, label="${c.name.slice(0, 20)}"];`);
	}
	for (const e of dedupeEdges(r)) lines.push(`  "${e.from}" -> "${e.to}" [label="${e.line}"];`);
	lines.push('}');
	return lines.join('\n');
}

const x0 = (s: string) => s.replace(/"/g, '');

function dedupeEdges(r: SymbolReport): { from: string; to: string; line: number }[] {
	const seen = new Set<string>();
	const out: { from: string; to: string; line: number }[] = [];
	for (const c of r.callEdges) {
		const key = `${c.from}->${c.to}`;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push({ from: c.from, to: c.to, line: c.line });
	}
	return out;
}
