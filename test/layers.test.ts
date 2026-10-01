// The layer rules of docs/plan.md, checked on the imports of the source files:
//
//   cli      -> sources, formats, view, render
//   sources  -> node built-ins only
//   formats  -> model (types and brand constructors)
//   view     -> model (types and brand constructors)
//   render   -> node built-ins only (it gets a View; it imports the View type)
//
// Only src/cli/run.ts imports more than one layer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { ROOT, SRC_DIR } from './support/paths.js';

type Import = { readonly from: string; readonly specifier: string; readonly typeOnly: boolean };

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? sourceFiles(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : []));
}

function importsOf(file: string): Import[] {
  const text = readFileSync(file, 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const out: Import[] = [];
  for (const m of text.matchAll(/^\s*(?:import|export)\s+(type\s+)?([^;'"]*?)\s*from\s+'([^']+)'/gm)) {
    out.push({ from: file, specifier: m[3] ?? '', typeOnly: m[1] !== undefined });
  }
  for (const m of text.matchAll(/^\s*import\s+'([^']+)'/gm)) out.push({ from: file, specifier: m[1] ?? '', typeOnly: false });
  return out;
}

/** "cli", "sources", ... for a file of src/; "model" for src/model.ts; "node" for a built-in; "bin" for bin/. */
function layerOf(path: string): string {
  const rel = relative(SRC_DIR, path).split(sep);
  if (rel[0] === '..') return 'bin';
  return rel.length === 1 ? (rel[0] ?? '').replace(/\.(ts|js)$/, '') : (rel[0] ?? '');
}

const ALLOWED: Readonly<Record<string, readonly string[]>> = {
  cli: ['cli', 'sources', 'formats', 'view', 'render', 'model'],
  sources: ['sources'],
  formats: ['formats', 'model'],
  view: ['view', 'model'],
  render: ['render'],
  model: ['model'],
  bin: ['cli'],
};

const files = sourceFiles(SRC_DIR);

test('the source files are found', () => {
  assert.ok(files.length >= 10, files.join('\n'));
  assert.deepEqual(readdirSync(SRC_DIR, { withFileTypes: true }).filter((e) => e.name.endsWith('.js')), []);
});

test('every import follows the layer table of docs/plan.md', () => {
  const problems: string[] = [];
  for (const file of [...files, join(ROOT, 'bin', 'session-trace.ts')]) {
    const layer = layerOf(file);
    for (const imp of importsOf(file)) {
      if (imp.specifier.startsWith('node:')) continue;
      assert.ok(imp.specifier.startsWith('.'), `${relative(ROOT, file)}: runtime dependency "${imp.specifier}"`);
      const target = layerOf(resolve(dirname(file), imp.specifier));
      // render gets a View: it may import the View type, and nothing else of the view layer.
      const viewTypeInRender = layer === 'render' && target === 'view' && imp.typeOnly;
      if (!(ALLOWED[layer] ?? []).includes(target) && !viewTypeInRender) problems.push(`${relative(ROOT, file)} (${layer}) imports ${imp.specifier} (${target})`);
    }
  }
  assert.deepEqual(problems, []);
});

test('only src/cli/run.ts imports more than one other layer', () => {
  const joiners: string[] = [];
  for (const file of files) {
    const layer = layerOf(file);
    const foreign = new Set(importsOf(file).filter((i) => i.specifier.startsWith('.')).map((i) => layerOf(resolve(dirname(file), i.specifier))).filter((l) => l !== layer && l !== 'model'));
    if (foreign.size > 1) joiners.push(relative(ROOT, file));
  }
  assert.deepEqual(joiners, [join('src', 'cli', 'run.ts')]);
});

test('the model imports nothing', () => {
  const model = importsOf(join(SRC_DIR, 'model.ts'));
  assert.deepEqual(model, []);
});

test('the sources and the renderer use node built-ins only', () => {
  for (const file of files.filter((f) => ['sources', 'render'].includes(layerOf(f)))) {
    for (const imp of importsOf(file)) {
      if (imp.specifier.startsWith('node:')) continue;
      assert.ok(layerOf(resolve(dirname(file), imp.specifier)) === layerOf(file) || imp.typeOnly, `${relative(ROOT, file)} imports ${imp.specifier}`);
    }
  }
});
