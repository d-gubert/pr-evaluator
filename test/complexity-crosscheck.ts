/**
 * D13: cross-check the cyclomatic counter against a second implementation.
 *
 * `countFunction` walks statements and scopes the count to one function.
 * `countFileTokens` counts decision tokens over a subtree and it knows nothing
 * about that scoping. The invariant below ties them together:
 *
 *   sum over every function of (own - 1)  +  the points outside all functions
 *   ==  the decision tokens of the whole file
 *
 * The research agent's counter undercounted apps/meteor/server by 23% through
 * an evaluation-order bug in exactly that scoping. A wrong number looks
 * exactly like a right one, so this check runs on real files.
 *
 * Usage: tsx test/complexity-crosscheck.ts <repo> <dir>
 */
import * as ts from 'typescript';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { countFileTokens, countFunction, isFunctionLike } from '../src/complexity.js';

const repo = process.argv[2];
const dir = process.argv[3] ?? '';
const onlyTs = process.argv.includes('--no-js');
const noTests = process.argv.includes('--no-tests');
const root = path.join(repo, dir);

const files: string[] = [];
(function walk(d: string) {
	for (const e of fs.readdirSync(d, { withFileTypes: true })) {
		if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'dist') continue;
		const full = path.join(d, e.name);
		if (e.isDirectory()) walk(full);
		else if (/\.(ts|tsx|js|jsx)$/.test(e.name) && !e.name.endsWith('.d.ts')) files.push(full);
	}
})(root);

let sumOwn = 0;
let sumInline = 0;
let functions = 0;
let astTotal = 0;
let tokenTotal = 0;
const disagree: { file: string; ast: number; tokens: number }[] = [];
const t0 = Date.now();

for (const file of files) {
	if (onlyTs && /\.(js|jsx)$/.test(file)) continue;
	if (noTests && /\.(spec|test)\.tsx?$/.test(file)) continue;
	const text = fs.readFileSync(file, 'utf8');
	const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

	const all: ts.Node[] = [];
	(function visit(node: ts.Node) {
		if (isFunctionLike(node)) all.push(node);
		ts.forEachChild(node, visit);
	})(sf);

	let fileAst = 0;
	for (const fn of all) {
		const c = countFunction(fn as never);
		sumOwn += c.own;
		sumInline += c.inline;
		functions++;
		fileAst += c.own - 1; // `inline` is a duplicate roll-up, so it is excluded.
	}

	const fileTokens = countFileTokens(sf);
	const topLevel = all.filter((fn) => !all.some((other) => other !== fn && fn.getStart() >= other.getStart() && fn.getEnd() <= other.getEnd()));
	const insideFunctions = topLevel.reduce((n, fn) => n + countFileTokens(sf, fn), 0);
	const outsideFunctions = fileTokens - insideFunctions;

	astTotal += fileAst + outsideFunctions;
	tokenTotal += fileTokens;
	if (fileAst + outsideFunctions !== fileTokens) disagree.push({ file: path.relative(repo, file), ast: fileAst + outsideFunctions, tokens: fileTokens });
}

console.log(`dir              ${dir}${onlyTs ? '  (--no-js)' : ''}${noTests ? '  (--no-tests)' : ''}`);
console.log(`files            ${files.length}`);
console.log(`functions        ${functions}`);
console.log(`SUM own          ${sumOwn}`);
console.log(`SUM inline       ${sumInline}`);
console.log(`time             ${Date.now() - t0}ms`);
console.log();
console.log(`statement walk   ${astTotal}`);
console.log(`token walk       ${tokenTotal}`);
console.log(`files that disagree ${disagree.length} of ${files.length}`);
for (const d of disagree.slice(0, 10)) console.log(`  DISAGREE: ${d.file}  walk=${d.ast} tokens=${d.tokens}`);
process.exit(disagree.length === 0 ? 0 : 1);
