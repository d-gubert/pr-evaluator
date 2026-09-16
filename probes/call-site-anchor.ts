/**
 * Probe: does a call-site anchor make an abstract stop resolvable?
 *
 * `--symbol packages/apps/...#add` loads the tsconfig of `packages/apps`, so
 * the consumer that supplies the concrete storage class is not in the
 * program. An anchor in `apps/meteor` loads a program that reaches both
 * sides. This probe measures what that program then holds.
 *
 * It asks three questions about one abstract member:
 *   1. does the checker resolve the call any better?  (expected: no)
 *   2. class hierarchy analysis: which subclasses are in the program?
 *   3. construction-site binding: which concrete type does the field get?
 *
 * Usage:
 *   tsx probes/call-site-anchor.ts --repo <path> --anchor <file> [--full-program]
 */
import { Project } from 'ts-morph';
import * as ts from 'typescript';
import * as path from 'node:path';
import { nearestTsconfig, resolveCallee } from '../src/tier2.js';
import { readWorkspace, remapDistToSrc } from '../src/workspace.js';

function arg(name: string, fallback?: string): string | undefined {
	const i = process.argv.indexOf(`--${name}`);
	return i === -1 ? fallback : process.argv[i + 1];
}

const repo = path.resolve(arg('repo') ?? process.cwd());
const anchor = arg('anchor');
const full = process.argv.includes('--full-program');
if (!anchor) {
	console.error('probe: --anchor <repo-relative file> is required');
	process.exit(2);
}

const t0 = Date.now();
const ws = readWorkspace(repo);
const tsconfig = nearestTsconfig(repo, path.dirname(anchor));
const project = new Project({ tsConfigFilePath: tsconfig, skipAddingFilesFromTsConfig: !full });
if (!full) {
	project.addSourceFileAtPath(path.join(repo, anchor));
	project.resolveSourceFileDependencies();
}
// The consumer resolves `@rocket.chat/apps` to `dist/*.d.ts`, which carries no
// body. Pull the source of every sibling package the program landed in, the
// way `--follow-dist` does. (D15)
const before = project.getSourceFiles().length;
for (let round = 0; round < 3; round++) {
	const want = new Set<string>();
	for (const f of project.getProgram().compilerObject.getSourceFiles()) {
		const src = remapDistToSrc(repo, ws, f.fileName);
		if (src && src !== f.fileName && /\.ts$/.test(src) && !src.includes('node_modules')) want.add(src);
	}
	const n = project.getSourceFiles().length;
	for (const file of want) project.addSourceFileAtPathIfExists(file);
	project.resolveSourceFileDependencies();
	if (project.getSourceFiles().length === n) break;
}
const added = project.getSourceFiles().length - before;
const checker = project.getTypeChecker().compilerObject as unknown as ts.TypeChecker;
const loadMs = Date.now() - t0;
// ts-morph bundles its own copy of the compiler. Every node that crosses the
// boundary is cast once, here, so the rest of the file speaks one type.
/** The whole program, not only the files ts-morph tracks. */
const files = (project.getProgram().compilerObject.getSourceFiles() as unknown as ts.SourceFile[]).filter((f) => !f.fileName.includes('/node_modules/typescript/'));
const rel = (f: string) => (f.startsWith(repo) ? f.slice(repo.length + 1) : f);

console.log(`anchor      ${anchor}`);
console.log(`tsconfig    ${tsconfig ? rel(tsconfig) : 'none'}`);
console.log(`program     ${full ? 'full' : 'lazy'}  ${files.length} files  ${loadMs}ms  (${added} pulled from sibling src)\n`);

// ------------------------------------------------- 1. what the checker says
const sf = files.find((f) => rel(f.fileName).endsWith('packages/apps/src/server/AppManager.ts'));
if (!sf) {
	console.log('AppManager.ts (src) is not in the program. Nothing to measure.');
	process.exit(0);
}

const abstractCalls: { text: string; line: number; reason?: string; decls: ts.Declaration[] }[] = [];
(function visit(node: ts.Node) {
	if (ts.isCallExpression(node) && /this\.app(Source|Metadata)Storage\./.test(node.expression.getText(sf))) {
		const t = resolveCallee(checker, node);
		abstractCalls.push({
			text: node.expression.getText(sf),
			line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
			reason: t.reason,
			decls: [...t.decls, ...t.reasonDecls],
		});
	}
	ts.forEachChild(node, visit);
})(sf);

console.log(`1. the checker, on ${abstractCalls.length} storage calls in AppManager.ts`);
const byReason = new Map<string, number>();
for (const c of abstractCalls) byReason.set(c.reason ?? 'resolved', (byReason.get(c.reason ?? 'resolved') ?? 0) + 1);
for (const [r, n] of byReason) console.log(`   ${r.padEnd(16)}${n}`);
const sample = abstractCalls[0];
if (sample) console.log(`   sample: ${sample.text} at line ${sample.line} -> ${sample.decls.map((d) => rel(d.getSourceFile().fileName)).join(', ')}`);

// ------------------------------------------- 2. class hierarchy analysis
/** Every class in the program whose heritage chain reaches `baseName`. */
function subclassesOf(baseName: string): { name: string; file: string; instantiated: boolean }[] {
	const out: { name: string; file: string; instantiated: boolean }[] = [];
	const news = new Set<string>();
	for (const s of files) {
		if (s.isDeclarationFile) continue;
		(function visit(node: ts.Node) {
			if (ts.isNewExpression(node) && ts.isIdentifier(node.expression)) news.add(node.expression.text);
			ts.forEachChild(node, visit);
		})(s);
	}
	for (const s of files) {
		(function visit(node: ts.Node) {
			if (ts.isClassDeclaration(node) && node.name) {
				for (const h of node.heritageClauses ?? []) {
					for (const type of h.types) {
						if (type.expression.getText(s).split('.').pop() === baseName) {
							out.push({ name: node.name.text, file: rel(s.fileName), instantiated: news.has(node.name.text) });
						}
					}
				}
			}
			ts.forEachChild(node, visit);
		})(s);
	}
	return out;
}

for (const base of ['AppSourceStorage', 'AppMetadataStorage', 'AppBridges']) {
	const subs = subclassesOf(base);
	console.log(`\n2. class hierarchy analysis: ${base} -> ${subs.length} subclasses in the program`);
	for (const s of subs) console.log(`   ${s.instantiated ? 'new  ' : '     '}${s.name.padEnd(32)}${s.file}`);
}

// --------------------------------------- 3. construction-site binding
/**
 * Follow the field to the constructor parameter, the parameter to each
 * `new AppManager({...})` argument, and that argument to its declared type.
 */
function bindField(className: string, fieldName: string): void {
	console.log(`\n3. construction-site binding: ${className}.${fieldName}`);
	let target: ts.ClassDeclaration | undefined;
	for (const s of files) {
		(function visit(node: ts.Node) {
			if (ts.isClassDeclaration(node) && node.name?.text === className && !s.isDeclarationFile) target = node;
			ts.forEachChild(node, visit);
		})(s);
	}
	if (!target) return void console.log('   the class is not in the program');

	// The property the constructor assigns from, e.g. `sourceStorage`.
	const ctor = target.members.find((m) => ts.isConstructorDeclaration(m)) as ts.ConstructorDeclaration | undefined;
	let fromProperty: string | undefined;
	if (ctor?.body) {
		(function visit(node: ts.Node) {
			if (
				ts.isBinaryExpression(node) &&
				node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
				ts.isPropertyAccessExpression(node.left) &&
				node.left.name.text === fieldName &&
				ts.isIdentifier(node.right)
			) {
				fromProperty = node.right.text;
			}
			ts.forEachChild(node, visit);
		})(ctor.body);
	}
	console.log(`   the constructor assigns it from  ${fromProperty ?? '(not a plain identifier)'}`);
	if (!fromProperty) return;

	let sites = 0;
	for (const s of files) {
		(function visit(node: ts.Node) {
			if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === className) {
				sites++;
				const a0 = node.arguments?.[0];
				const line = s.getLineAndCharacterOfPosition(node.getStart(s)).line + 1;
				if (!a0 || !ts.isObjectLiteralExpression(a0)) return void console.log(`   ${rel(s.fileName)}:${line}  the argument is not an object literal`);
				const prop = a0.properties.find((p) => p.name && ts.isIdentifier(p.name) && p.name.text === fromProperty);
				if (!prop || !ts.isPropertyAssignment(prop)) return void console.log(`   ${rel(s.fileName)}:${line}  no ${fromProperty} property`);
				const type = checker.getTypeAtLocation(prop.initializer);
				console.log(`   ${rel(s.fileName)}:${line}  ${prop.initializer.getText(s)}  :  ${checker.typeToString(type)}`);
			}
			ts.forEachChild(node, visit);
		})(s);
	}
	if (!sites) console.log('   no construction site in the program');
}

bindField('AppManager', 'appSourceStorage');
bindField('AppManager', 'appMetadataStorage');
