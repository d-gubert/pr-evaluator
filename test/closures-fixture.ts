/**
 * D17: synthetic fixtures for the local closure pass.
 *
 * Each case is one file. The harness builds a program, finds the call that
 * `call` names, and asks `resolveLocalClosures` about it. The expected
 * numbers are counted by hand.
 *
 * `undefined` for `closures` means the pattern does not match, so the walk
 * keeps the stop it already has.
 *
 * Usage: tsx test/closures-fixture.ts
 */
import * as ts from 'typescript';
import { resolveCallee } from '../src/tier2.js';
import { resolveLocalClosures } from '../src/closures.js';

interface Case {
	name: string;
	code: string;
	/** The callee text of the call under test. */
	call: string;
	/** How many bodies the pass finds. undefined = the pattern does not match. */
	closures?: number;
	/** True when the pass drops the stop. */
	complete?: boolean;
}

const cases: Case[] = [
	{
		name: 'the AppManager shape: a const array, two pushes, one map',
		code: `
			async function add() {
				const undo: Array<() => Promise<void>> = [];
				undo.push(() => remove(1));
				undo.push(async () => void cleanup());
				await Promise.all(undo.map((undoer) => undoer()));
			}
			async function remove(n: number) {}
			async function cleanup() {}`,
		call: 'undoer',
		closures: 2,
		complete: true,
	},
	{
		name: 'an element in the initializer counts',
		code: `
			function run() {
				const steps = [() => a(), () => b()];
				steps.forEach((step) => step());
			}
			function a() {}
			function b() {}`,
		call: 'step',
		closures: 2,
		complete: true,
	},
	{
		name: 'an empty array that nothing pushes resolves to nothing',
		code: `
			function run() {
				const steps: Array<() => void> = [];
				steps.forEach((step) => step());
			}`,
		call: 'step',
		closures: 0,
		complete: true,
	},
	{
		name: 'a named function as an element resolves through one const hop',
		code: `
			function run() {
				const steps: Array<() => void> = [];
				steps.push(a);
				steps.forEach((step) => step());
			}
			function a() {}`,
		call: 'step',
		closures: 1,
		complete: true,
	},
	{
		name: 'an array that escapes keeps the stop, and still names what it found',
		code: `
			function run() {
				const steps: Array<() => void> = [];
				steps.push(() => a());
				collect(steps);
				steps.forEach((step) => step());
			}
			function collect(xs: Array<() => void>) { xs.push(() => b()); }
			function a() {}
			function b() {}`,
		call: 'step',
		closures: 1,
		complete: false,
	},
	{
		name: 'a spread push hides a value, so the stop stays',
		code: `
			function run(more: Array<() => void>) {
				const steps: Array<() => void> = [];
				steps.push(...more);
				steps.forEach((step) => step());
			}`,
		call: 'step',
		closures: 0,
		complete: false,
	},
	{
		name: 'a let array is not a local const, so the pattern does not match',
		code: `
			function run() {
				let steps: Array<() => void> = [];
				steps.push(() => a());
				steps.forEach((step) => step());
			}
			function a() {}`,
		call: 'step',
	},
	{
		name: 'reduce does not pass an element first, so the pattern does not match',
		code: `
			function run() {
				const steps: Array<() => number> = [];
				steps.push(() => 1);
				steps.reduce((acc) => acc(), () => 0);
			}`,
		call: 'acc',
	},
	{
		name: 'a plain parameter is not an array element, so the pattern does not match',
		code: `
			function run(cb: () => void) {
				cb();
			}`,
		call: 'cb',
	},
];

const host = ts.createCompilerHost({});
let failed = 0;

for (const c of cases) {
	const file = 't.ts';
	const sf = ts.createSourceFile(file, c.code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
	const program = ts.createProgram({
		rootNames: [file],
		options: { noLib: true, noResolve: true },
		host: { ...host, getSourceFile: (n) => (n === file ? sf : undefined), fileExists: (n) => n === file, readFile: () => c.code },
	});
	const checker = program.getTypeChecker();

	let call: ts.CallExpression | undefined;
	(function visit(node: ts.Node) {
		if (ts.isCallExpression(node) && node.expression.getText(sf) === c.call) call = node;
		ts.forEachChild(node, visit);
	})(sf);
	if (!call) {
		console.log(`FAIL  ${c.name}: no call to ${c.call}()`);
		failed++;
		continue;
	}

	const target = resolveCallee(checker, call);
	const got = resolveLocalClosures(checker, call, target.reasonDecls);
	const ok = c.closures === undefined ? got === undefined : !!got && got.decls.length === c.closures && got.complete === c.complete;
	if (!ok) failed++;
	const shown = got ? `${got.decls.length} closures, complete=${got.complete}` : 'no match';
	const want = c.closures === undefined ? 'no match' : `${c.closures} closures, complete=${c.complete}`;
	console.log(`${ok ? 'ok  ' : 'FAIL'}  ${c.name}\n        got ${shown}   want ${want}`);
}

console.log(`\n${cases.length - failed} of ${cases.length} pass`);
process.exit(failed === 0 ? 0 : 1);
