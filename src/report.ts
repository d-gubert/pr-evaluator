/** The output is facts, not a score. JSON is the contract; the table is a view. (D12) */
import type { ModuleDelta, Report } from './delta.js';

const pct = (v: number | null) => (v === null ? 'unknown' : `${Math.round(v * 100)}%`);
const signed = (v: number | null) => (v === null ? '  ?' : v > 0 ? `+${v}` : `${v}`);

export function renderTable(report: Report, opts: { symbols: number } = { symbols: 6 }): string {
	const out: string[] = [];
	out.push(`base  ${report.base.ref}  ${report.base.commit.slice(0, 10)}`);
	out.push(`head  ${report.head.ref}  ${report.head.commit.slice(0, 10)}`);
	out.push(`coverage  base=${report.coverage.base}  head=${report.coverage.head}`);
	out.push('');
	if (report.renamed.length) {
		out.push('renamed modules (open question 3: the delta below treats these as add and remove)');
		for (const r of report.renamed) out.push(`  ${r.from}  ->  ${r.to}`);
		out.push('');
	}
	if (!report.modules.length) {
		out.push('No touched file belongs to a module. Check the module patterns of D1.');
		return out.join('\n');
	}

	out.push(`touched modules: ${report.modules.length}`);
	out.push('');
	out.push(pad('module', 46) + pad('files', 7) + pad('bound', 7) + pad('cplx', 9) + pad('direct', 8) + pad('indir', 8) + pad('conf', 6));
	out.push('-'.repeat(91));
	for (const m of report.modules) {
		out.push(
			pad(m.id, 46) +
				pad(`${m.fileCount.head} ${signed(m.fileCount.delta)}`, 7) +
				pad(`${m.boundary.head} ${signed(m.boundary.delta)}`, 7) +
				pad(m.totalComplexity.head === null ? 'unknown' : `${m.totalComplexity.head} ${signed(m.totalComplexity.delta)}`, 9) +
				pad(`${m.directDeps.head} ${signed(m.directDeps.delta)}`, 8) +
				pad(`${m.indirectDeps.head} ${signed(m.indirectDeps.delta)}`, 8) +
				pad(m.confidence.head.toFixed(2), 6),
		);
	}
	out.push('');

	for (const m of report.modules) out.push(...moduleDetail(m, opts.symbols));

	out.push('');
	out.push(`direct dependents of the touched modules (blast radius, D10): ${report.dependentsOfTouched.length}`);
	for (const d of report.dependentsOfTouched.slice(0, 20)) out.push(`  ${d}`);
	if (report.dependentsOfTouched.length > 20) out.push(`  ... and ${report.dependentsOfTouched.length - 20} more`);
	return out.join('\n');
}

function moduleDetail(m: ModuleDelta, limit: number): string[] {
	const out: string[] = ['', `### ${m.id}  [${m.status}]${m.typeOnly ? '  type-only module' : ''}`];
	if (m.confidence.reasons.length) {
		out.push(`  confidence ${m.confidence.head.toFixed(2)} — the walk stopped: ${m.confidence.reasons.map((r) => `${r.reason}=${r.count}`).join(', ')}`);
		out.push(`  A complexity number on a marked symbol is a floor, not a total. (D14)`);
	}
	const changed = m.boundary.symbols.filter((s) => s.status !== 'same');
	if (changed.length) {
		out.push(`  boundary symbols that changed: ${changed.length}`);
		out.push('  ' + pad('symbol', 40) + pad('state', 9) + pad('cplx', 14) + pad('used by', 10) + pad('cover', 12) + 'effects');
		for (const s of changed.slice(0, limit)) {
			out.push(
				'  ' +
					pad(s.name + (s.typeOnly ? ' (type)' : ''), 40) +
					pad(s.status, 9) +
					pad(s.complexity.head === null ? 'unknown' : `${s.complexity.head} ${signed(s.complexity.delta)}${s.complexityStops.length ? ' floor' : ''}`, 14) +
					pad(`${s.usedBy.head} ${signed(s.usedBy.delta)}`, 10) +
					pad(s.coverage.head === null ? 'unknown' : pct(s.coverage.head), 12) +
					(s.effects.head.join(',') || '-') +
					(s.effects.added.length ? `  (+${s.effects.added.join(',')})` : ''),
			);
		}
		if (changed.length > limit) out.push(`  ... and ${changed.length - limit} more`);
	}
	if (m.directDeps.added.length) out.push(`  direct dependencies added: ${m.directDeps.added.join(', ')}`);
	if (m.directDeps.removed.length) out.push(`  direct dependencies removed: ${m.directDeps.removed.join(', ')}`);
	if (m.indirectDeps.added.length) out.push(`  indirect dependencies added (${m.indirectDeps.added.length}): ${m.indirectDeps.added.slice(0, 8).join(', ')}${m.indirectDeps.added.length > 8 ? ', ...' : ''}`);
	if (m.unusedExports.length) out.push(`  declared but nobody imports (${m.unusedExports.length}): ${m.unusedExports.slice(0, 8).join(', ')}${m.unusedExports.length > 8 ? ', ...' : ''}`);
	return out;
}

function pad(s: string, n: number): string {
	return s.length >= n ? `${s.slice(0, n - 2)} ` : s + ' '.repeat(n - s.length);
}
