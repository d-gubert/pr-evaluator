/**
 * The symbol report as one self-contained HTML file.
 *
 * It embeds the same JSON the `--json` flag writes, so the page is a view of
 * the contract and not a second source of truth. (D12) No network, no CDN, no
 * build step: the file opens from disk and it carries the report inside it.
 *
 * The page rebuilds the call tree from `nodes` and `callEdges`, so it shows the
 * whole tree. The text view stops at `--tree` lines.
 */
import type { SymbolReport } from './symbol.js';

export function renderHtml(r: SymbolReport): string {
	// `</script>` inside the data would close the tag, so `<` never survives.
	const data = JSON.stringify(r).replace(/</g, '\\u003c');
	const title = r.ref.member ? `${r.ref.name}.${r.ref.member}` : r.ref.name;
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${escapeHtml(title)} — pr-evaluator</title>
<style>${CSS}</style>
</head>
<body>
<div id="app"></div>
<script type="application/json" id="report">${data}</script>
<script>${CLIENT}</script>
</body>
</html>
`;
}

function escapeHtml(s: string): string {
	return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
}

const CSS = `
:root {
  color-scheme: light dark;
  --bg: #f7f7f5; --panel: #fff; --ink: #1a1a19; --dim: #6b6b66; --line: #e2e2dd;
  --accent: #3b6ea5; --warn: #b4531a; --bad: #a33; --good: #2f7d4f; --bar: #cfd9e6;
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
@media (prefers-color-scheme: dark) {
  :root { --bg: #16171a; --panel: #1e1f23; --ink: #e8e8e4; --dim: #94948d; --line: #303239;
          --accent: #7aa7d9; --warn: #d98a4f; --bad: #e07a7a; --good: #6dbd8c; --bar: #33415a; }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink);
       font: 14px/1.5 system-ui, -apple-system, Segoe UI, sans-serif;
       padding: env(safe-area-inset-top, 0px) 0 env(safe-area-inset-bottom, 0px); }
#app { max-width: 1180px; margin: 0 auto; padding: 24px 16px 64px; }
h1 { font-size: 20px; margin: 0 0 2px; font-family: var(--mono); word-break: break-all; }
h2 { font-size: 15px; margin: 0 0 12px; letter-spacing: .02em; text-transform: uppercase; color: var(--dim); }
a { color: var(--accent); }
.sub { color: var(--dim); font-family: var(--mono); font-size: 12.5px; word-break: break-all; }
.meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 8px 20px; margin: 16px 0; }
.meta div { font-size: 12.5px; }
.meta b { color: var(--dim); font-weight: 500; display: block; text-transform: uppercase; font-size: 11px; letter-spacing: .04em; }
.meta span { font-family: var(--mono); word-break: break-all; }
.note { background: var(--panel); border-left: 3px solid var(--warn); padding: 8px 12px; margin: 8px 0; font-size: 12.5px; }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin: 20px 0; }
.card { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 12px 14px; }
.card .n { font-size: 24px; font-family: var(--mono); line-height: 1.1; }
.card .k { color: var(--dim); font-size: 11px; text-transform: uppercase; letter-spacing: .04em; margin-bottom: 6px; }
.card .x { color: var(--dim); font-size: 11.5px; margin-top: 4px; }
nav { display: flex; flex-wrap: wrap; gap: 6px; margin: 24px 0 14px; }
nav button { background: var(--panel); border: 1px solid var(--line); color: var(--ink); border-radius: 999px;
             padding: 5px 13px; font-size: 12.5px; cursor: pointer; }
nav button[aria-selected="true"] { background: var(--accent); border-color: var(--accent); color: #fff; }
section { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 16px; }
table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
th { text-align: left; color: var(--dim); font-weight: 500; text-transform: uppercase; font-size: 11px;
     letter-spacing: .04em; border-bottom: 1px solid var(--line); padding: 6px 8px; position: sticky; top: 0; background: var(--panel); }
td { padding: 5px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
td.m, .loc { font-family: var(--mono); font-size: 12px; }
.loc { color: var(--dim); word-break: break-all; }
.num { text-align: right; font-family: var(--mono); }
.scroll { overflow-x: auto; max-height: 70vh; overflow-y: auto; }
.tag { display: inline-block; font-size: 10.5px; font-family: var(--mono); padding: 1px 6px; border-radius: 4px;
       background: var(--bar); color: var(--ink); margin-right: 4px; }
.tag.bad { background: var(--bad); color: #fff; }
.tag.good { background: var(--good); color: #fff; }
.tag.warn { background: var(--warn); color: #fff; }
input[type="search"] { width: 100%; padding: 7px 10px; border: 1px solid var(--line); border-radius: 6px;
                       background: var(--bg); color: var(--ink); margin-bottom: 12px; font: inherit; font-size: 13px; }
details { margin: 0; }
summary { cursor: pointer; list-style: none; padding: 3px 4px; border-radius: 5px; display: flex; gap: 8px; align-items: baseline; }
summary::-webkit-details-marker { display: none; }
details[open] > summary > .caret::after { content: "▾"; }
summary > .caret::after { content: "▸"; }
summary:hover { background: var(--bg); }
.tree ul { list-style: none; margin: 0; padding-left: 18px; border-left: 1px solid var(--line); }
.tree > ul { padding-left: 0; border-left: 0; }
.fn { font-family: var(--mono); font-size: 12.5px; }
.bar { display: inline-block; height: 8px; background: var(--bar); border-radius: 2px; vertical-align: middle; }
.leaf { padding: 3px 4px 3px 4px; display: flex; gap: 8px; align-items: baseline; }
.stop { color: var(--bad); font-family: var(--mono); font-size: 12px; padding: 2px 4px 2px 22px; }
.caret { color: var(--dim); width: 10px; display: inline-block; }
pre { font-family: var(--mono); font-size: 11.5px; overflow-x: auto; margin: 0; }
@media (max-width: 560px) { .meta { grid-template-columns: 1fr; } h1 { font-size: 17px; } }
`;

const CLIENT = `
const R = JSON.parse(document.getElementById('report').textContent);
const app = document.getElementById('app');
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const pct = (v) => v === null || v === undefined ? 'unknown' : Math.round(v * 100) + '%';
const byId = {}; R.nodes.forEach((n) => { byId[n.id] = n; });
const maxC = Math.max(1, ...R.nodes.map((n) => n.own + n.inline));
const kids = {}; R.callEdges.forEach((e) => { (kids[e.from] = kids[e.from] || []).push(e); });
const stopsBy = {}; R.stops.forEach((s) => { (stopsBy[s.fromNode] = stopsBy[s.fromNode] || []).push(s); });
const seeds = R.nodes.filter((n) => n.depth === 0).map((n) => n.id);
const f = R.facts;

function bar(v) { return '<span class="bar" style="width:' + Math.max(2, Math.round((v / maxC) * 70)) + 'px"></span>'; }
function badges(n) {
  let out = '';
  n.effects.forEach((e) => { out += '<span class="tag warn">' + esc(e) + '</span>'; });
  if (n.coverage !== null && n.coverage !== undefined) out += '<span class="tag ' + (n.coverage > 0.5 ? 'good' : 'bad') + '">' + pct(n.coverage) + '</span>';
  return out;
}
function nodeLine(n, edgeLine) {
  return '<span class="fn">' + esc(n.name) + '</span>' +
    '<span class="num" style="color:var(--dim)">+' + (n.own + n.inline) + '</span>' + bar(n.own + n.inline) +
    badges(n) + '<span class="loc">' + esc(n.file) + ':' + (edgeLine || n.start) + '</span>';
}
function treeNode(id, line, path) {
  const n = byId[id];
  if (!n) return '';
  if (path.indexOf(id) !== -1) return '<li><div class="leaf">' + nodeLine(n, line) + '<span class="tag">cycle</span></div></li>';
  const next = path.concat([id]);
  const cs = kids[id] || [];
  const seen = {}; const uniq = cs.filter((c) => seen[c.to] ? false : (seen[c.to] = true));
  const st = stopsBy[id] || [];
  let inner = '';
  st.forEach((s) => { inner += '<div class="stop">✗ ' + esc(s.reason) + ': ' + esc(s.text) + '  <span class="loc">' + esc(s.file) + ':' + s.line + '</span></div>'; });
  if (uniq.length) inner += '<ul>' + uniq.map((c) => treeNode(c.to, c.line, next)).join('') + '</ul>';
  if (!inner) return '<li><div class="leaf">' + nodeLine(n, line) + '</div></li>';
  const open = n.depth < 3 ? ' open' : '';
  return '<li><details' + open + '><summary><span class="caret">▸</span>' + nodeLine(n, line) + '</summary>' + inner + '</details></li>';
}

function table(cols, rows) {
  if (!rows.length) return '<p class="sub">none</p>';
  let h = '<div class="scroll"><table><thead><tr>';
  cols.forEach((c) => { h += '<th>' + esc(c.label) + '</th>'; });
  h += '</tr></thead><tbody>';
  rows.forEach((r0) => {
    h += '<tr>';
    cols.forEach((c) => { h += '<td class="' + (c.cls || '') + '">' + c.get(r0) + '</td>'; });
    h += '</tr>';
  });
  return h + '</tbody></table></div>';
}

const panels = {};
panels['call tree'] = () => '<h2>call tree — the set that facts 2, 5 and 6 measure</h2><div class="tree"><ul>' +
  seeds.map((id) => treeNode(id, 0, [])).join('') + '</ul></div>';

panels['hotspots'] = () => table([
  { label: 'function', get: (n) => '<span class="fn">' + esc(n.name) + '</span>' },
  { label: 'kind', get: (n) => esc(n.kind) },
  { label: 'cplx', cls: 'num', get: (n) => (n.own + n.inline) + ' ' + bar(n.own + n.inline) },
  { label: 'own', cls: 'num', get: (n) => n.own },
  { label: 'inline', cls: 'num', get: (n) => n.inline },
  { label: 'depth', cls: 'num', get: (n) => n.depth },
  { label: 'effects', get: (n) => badges(n) },
  { label: 'location', cls: 'loc', get: (n) => esc(n.file) + ':' + n.start },
], R.nodes);

panels['dependencies'] = () => '<h2>fact 3 — modules this symbol reaches</h2>' + table([
  { label: 'module', cls: 'm', get: (d) => esc(d.module) },
  { label: 'calls', cls: 'num', get: (d) => d.calls },
  { label: 'refs', cls: 'num', get: (d) => d.references },
  { label: 'kind', get: (d) => d.typeOnly ? '<span class="tag">type-only</span>' : '' },
  { label: 'names', cls: 'loc', get: (d) => esc(d.names.join(', ')) },
], f.directDeps.modules) +
  '<h2 style="margin-top:22px">packages</h2>' + table([
  { label: 'package', cls: 'm', get: (d) => esc(d.package) },
  { label: 'calls', cls: 'num', get: (d) => d.calls },
  { label: 'refs', cls: 'num', get: (d) => d.references },
  { label: 'names', cls: 'loc', get: (d) => esc(d.names.join(', ')) },
], f.directDeps.packages) +
  '<h2 style="margin-top:22px">outside the repository</h2>' + table([
  { label: 'package', cls: 'm', get: (d) => esc(d.name) },
  { label: 'refs', cls: 'num', get: (d) => d.references },
  { label: 'kind', get: (d) => d.typeOnly ? '<span class="tag">type-only</span>' : '' },
  { label: 'names', cls: 'loc', get: (d) => esc(d.names.join(', ')) },
], f.directDeps.external) +
  '<h2 style="margin-top:22px">fact 4 — indirect, with the hop count</h2>' + table([
  { label: 'module', cls: 'm', get: (d) => esc(d.module) },
  { label: 'hops', cls: 'num', get: (d) => d.hops },
], f.indirectDeps);

panels['boundary'] = () => {
  const b = f.boundary;
  const flags = [['on the declared surface', b.onDeclaredSurface], ['declared in the entry file', b.declaredInEntry],
    ['bypassed: imported past the entry', b.bypassed], ['declared and nobody imports it', b.unused], ['type-only', b.typeOnly]];
  let h = '<h2>fact 1 — boundary</h2><p>';
  flags.forEach((x) => { h += '<span class="tag ' + (x[1] ? 'good' : '') + '">' + esc(x[0]) + ': ' + (x[1] ? 'yes' : 'no') + '</span> '; });
  h += '</p>';
  if (R.ref.member) h += '<div class="note">The reference names a member, so fact 1 describes the holder "' + esc(R.ref.name) + '".</div>';
  h += '<p class="sub">used by ' + b.usedByModules.length + ' other modules: ' + esc(b.usedByModules.join(', ') || 'none') + '</p>';
  if (b.starImporters.length) h += '<p class="sub">reached by import * from: ' + esc(b.starImporters.join(', ')) + '</p>';
  if (b.reexportedBy.length) h += '<p class="sub">re-exported by: ' + esc(b.reexportedBy.join(', ')) + '</p>';
  h += table([
    { label: 'importer', cls: 'loc', get: (i) => esc(i.file) + ':' + i.line },
    { label: 'module', cls: 'm', get: (i) => esc(i.module || '') },
    { label: 'specifier', cls: 'm', get: (i) => esc(i.spec) },
    { label: 'kind', get: (i) => i.typeOnly ? '<span class="tag">type</span>' : '' },
  ], b.importers);
  if (b.providers.length) h += '<h2 style="margin-top:22px">providers</h2>' + table([
    { label: 'provider', get: (p) => esc(p.provider) },
    { label: 'name', cls: 'm', get: (p) => esc(p.name) },
    { label: 'location', cls: 'loc', get: (p) => esc(p.file) + ':' + p.line },
  ], b.providers);
  return h;
};

panels['effects'] = () => '<h2>fact 5 — side effects</h2>' + (f.effects.astGrep ? '' : '<div class="note">ast-grep is not on the PATH, so the catalog did not run.</div>') +
  table([
  { label: 'category', get: (h) => '<span class="tag warn">' + esc(h.category) + '</span>' },
  { label: 'in function', cls: 'm', get: (h) => esc(h.inFunction) },
  { label: 'depth', cls: 'num', get: (h) => h.depth },
  { label: 'location', cls: 'loc', get: (h) => esc(h.file) + ':' + h.line },
], f.effects.hits);

panels['coverage'] = () => '<h2>fact 6 — coverage, source ' + esc(f.coverage.source) + '</h2>' +
  '<p class="sub">' + pct(f.coverage.value) + ' over ' + f.coverage.knownLines + ' known lines</p>' +
  table([
  { label: 'function', cls: 'm', get: (c) => esc(c.node) },
  { label: 'coverage', cls: 'num', get: (c) => pct(c.value) },
  { label: 'file', cls: 'loc', get: (c) => esc(c.file) },
], f.coverage.perFunction);

panels['stops'] = () => '<h2>where the walk stopped — a marked number is a floor (D14)</h2>' + table([
  { label: 'reason', get: (s) => '<span class="tag bad">' + esc(s.reason) + '</span>' },
  { label: 'call', cls: 'm', get: (s) => esc(s.text) },
  { label: 'in', cls: 'm', get: (s) => esc((byId[s.fromNode] || {}).name || '') },
  { label: 'location', cls: 'loc', get: (s) => esc(s.file) + ':' + s.line },
], R.stops);

panels['crossings'] = () => '<h2>every crossing of the ' + esc(R.edge) + ' edge — the raw path is the D15 evidence</h2>' + table([
  { label: 'kind', get: (c) => '<span class="tag">' + esc(c.kind) + '</span>' },
  { label: 'name', cls: 'm', get: (c) => esc(c.name) },
  { label: 'n', cls: 'num', get: (c) => c.count },
  { label: 'module', cls: 'm', get: (c) => esc(c.module || (c.external ? '(outside)' : '')) },
  { label: 'package', cls: 'm', get: (c) => esc(c.package || '') },
  { label: 'resolved to', cls: 'loc', get: (c) => esc(c.target) },
], R.crossings);

panels['callers'] = () => '<h2>callers — the blast radius at the symbol level (D10)</h2>' +
  '<p class="sub">' + R.callers.sites.length + ' call sites in ' + R.callers.scanned + ' scanned files' +
  (R.callers.skipped ? ', ' + R.callers.skipped + ' files not scanned' : '') + '</p>' + table([
  { label: 'in function', cls: 'm', get: (s) => esc(s.inFunction) },
  { label: 'call', cls: 'm', get: (s) => esc(s.text) },
  { label: 'module', cls: 'm', get: (s) => esc(s.module || '') },
  { label: 'location', cls: 'loc', get: (s) => esc(s.file) + ':' + s.line },
], R.callers.sites);

if (R.edgesCompared) panels['edges'] = () => '<h2>what D6 would report at each stop rule</h2>' + table([
  { label: 'edge', get: (e) => '<span class="tag' + (e.edge === R.edge ? ' good' : '') + '">' + esc(e.edge) + '</span>' },
  { label: 'reach', cls: 'num', get: (e) => e.reach },
  { label: 'complexity', cls: 'num', get: (e) => e.transitive },
  { label: 'stops', cls: 'num', get: (e) => e.stops },
  { label: 'crossings', cls: 'num', get: (e) => e.crossings },
  { label: 'modules', cls: 'num', get: (e) => e.modules },
  { label: 'ms', cls: 'num', get: (e) => e.ms },
], R.edgesCompared);

panels['json'] = () => '<h2>the contract</h2><div class="scroll"><pre>' + esc(JSON.stringify(R, null, 2)) + '</pre></div>';

function head() {
  const id = R.identity, c = R.context;
  let h = '<h1>' + esc(R.ref.raw) + '</h1><div class="sub">' + esc(id.signature) + '</div>';
  if (id.jsdoc) h += '<div class="sub" style="margin-top:6px">' + esc(id.jsdoc) + '</div>';
  const meta = [['declared', id.kind + '  ' + id.file + ':' + id.start + '-' + id.end + (id.exported ? '  exported' : '  internal')],
    ['module', (c.module || 'none: no D1 pattern matches') + (c.moduleFiles ? '  (' + c.moduleFiles + ' files)' : '')],
    ['package', (c.package || 'none') + '  ' + (c.tsconfig || '')],
    ['walk edge', R.edge + '   depth ' + f.complexity.depth],
    ['tree', R.tree.files + ' files scanned by tier 1'],
    ['timings', Object.keys(R.timings).map((k) => k + ' ' + R.timings[k] + 'ms').join('   ')]];
  h += '<div class="meta">';
  meta.forEach((m) => { h += '<div><b>' + esc(m[0]) + '</b><span>' + esc(m[1]) + '</span></div>'; });
  h += '</div>';
  R.notes.forEach((n) => { h += '<div class="note">' + esc(n) + '</div>'; });
  const cards = [
    ['transitive complexity', f.complexity.transitive, f.complexity.reach + ' functions, own ' + f.complexity.own + (f.complexity.floor ? ' — floor' : '')],
    ['boundary', f.boundary.usedByModules.length, f.boundary.importers.length + ' importer files'],
    ['direct deps', f.directDeps.modules.length, f.directDeps.external.length + ' outside the repo'],
    ['indirect deps', f.indirectDeps.length, '2 hops or more'],
    ['effects', f.effects.categories.length, esc(f.effects.categories.join(', ') || 'none')],
    ['coverage', pct(f.coverage.value), f.coverage.source],
    ['confidence', R.confidence.value.toFixed(2), R.confidence.reasons.map((x) => x.reason + '=' + x.count).join(', ') || 'nothing lowered it']];
  h += '<div class="cards">';
  cards.forEach((c2) => { h += '<div class="card"><div class="k">' + esc(c2[0]) + '</div><div class="n">' + esc(c2[1]) + '</div><div class="x">' + c2[2] + '</div></div>'; });
  return h + '</div>';
}

const names = Object.keys(panels);
const fromHash = decodeURIComponent((location.hash || '').slice(1));
let current = names.indexOf(fromHash) === -1 ? names[0] : fromHash;
function draw() {
  let nav = '<nav>';
  names.forEach((n) => { nav += '<button aria-selected="' + (n === current) + '" data-p="' + n + '">' + esc(n) + '</button>'; });
  nav += '</nav>';
  const needsFilter = current !== 'call tree' && current !== 'json';
  app.innerHTML = head() + nav + '<section>' +
    (needsFilter ? '<input type="search" id="filter" placeholder="filter rows">' : '') + panels[current]() + '</section>';
  app.querySelectorAll('nav button').forEach((b) => {
    b.onclick = () => { current = b.dataset.p; location.hash = encodeURIComponent(current); draw(); window.scrollTo({ top: 0 }); };
  });
  const box = document.getElementById('filter');
  if (box) box.oninput = () => {
    const q = box.value.toLowerCase();
    app.querySelectorAll('tbody tr').forEach((tr) => { tr.hidden = q && tr.textContent.toLowerCase().indexOf(q) === -1; });
  };
}
draw();
`;
