/**
 * D13: synthetic fixtures with known-correct expected numbers.
 *
 * The cross-check proves the two implementations agree. It cannot prove the
 * pinned definition is the one we implemented. These cases do that, and each
 * expected number is counted by hand.
 *
 * Usage: tsx test/complexity-fixture.ts
 */
import * as ts from 'typescript';
import { countFunction, isFunctionLike } from '../src/complexity.js';

interface Case {
	name: string;
	code: string;
	own: number;
	inline: number;
}

const cases: Case[] = [
	{ name: 'a straight line', code: `function f() { return 1; }`, own: 1, inline: 0 },
	{ name: 'one if', code: `function f(a) { if (a) return 1; return 2; }`, own: 2, inline: 0 },
	{ name: 'else if is two ifs', code: `function f(a) { if (a) {} else if (a) {} }`, own: 3, inline: 0 },
	{ name: 'every loop form', code: `function f(a) { for (;;) {} for (const x in a) {} for (const y of a) {} while (a) {} do {} while (a); }`, own: 6, inline: 0 },
	{ name: 'switch counts a case, not a default', code: `function f(a) { switch (a) { case 1: break; case 2: break; default: break; } }`, own: 3, inline: 0 },
	{ name: 'catch counts, try does not', code: `function f() { try {} catch (e) {} finally {} }`, own: 2, inline: 0 },
	{ name: 'ternary', code: `function f(a) { return a ? 1 : 2; }`, own: 2, inline: 0 },
	{ name: 'the three logical operators', code: `function f(a, b, c) { return a && b || c ?? a; }`, own: 4, inline: 0 },
	{ name: 'optional chaining does not count', code: `function f(a) { return a?.b?.c?.(); }`, own: 1, inline: 0 },
	{ name: 'an optional parameter does not count', code: `function f(a?: number, b?: string) { return a; }`, own: 1, inline: 0 },
	{ name: 'a default parameter does not count, its operators do', code: `function f(a = 1, b = a ?? 2) { return b; }`, own: 2, inline: 0 },
	{ name: 'a logical assignment does not count', code: `function f(a) { a ||= 1; a &&= 2; a ??= 3; return a; }`, own: 1, inline: 0 },
	{ name: 'an expression body counts', code: `const f = (a, b) => a || b;`, own: 2, inline: 0 },
	{ name: 'a nested named function is its own unit', code: `function f(a) { if (a) {} function g(b) { if (b) {} } return g; }`, own: 2, inline: 0 },
	{ name: 'an inline callback rolls up', code: `function f(a) { return a.map((x) => (x ? 1 : 2)); }`, own: 1, inline: 1 },
	{ name: 'a curried arrow rolls up, not absorbs', code: `const f = (a) => (b) => (a && b ? 1 : 2);`, own: 1, inline: 2 },
	{ name: 'an assigned arrow is a named unit', code: `function f(a) { const g = (x) => (x ? 1 : 2); return g; }`, own: 1, inline: 0 },
];

let failed = 0;
for (const c of cases) {
	const sf = ts.createSourceFile('t.ts', c.code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
	let first: ts.Node | undefined;
	(function visit(node: ts.Node) {
		if (!first && isFunctionLike(node)) first = node;
		if (!first) ts.forEachChild(node, visit);
	})(sf);
	if (!first) {
		console.log(`FAIL  ${c.name}: no function found`);
		failed++;
		continue;
	}
	const got = countFunction(first as never);
	const ok = got.own === c.own && got.inline === c.inline;
	if (!ok) failed++;
	console.log(`${ok ? 'ok  ' : 'FAIL'}  ${c.name}  own=${got.own} (want ${c.own})  inline=${got.inline} (want ${c.inline})`);
}
console.log(`\n${cases.length - failed} of ${cases.length} pass`);
process.exit(failed === 0 ? 0 : 1);
