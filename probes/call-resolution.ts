/**
 * Probe for open question 1: call resolution rate.
 *
 * D6 (transitive complexity) and D7 (effect propagation) both need an
 * intra-module call graph. This probe measures how many call sites we can
 * follow to an implementation, and where the rest fail.
 *
 * Usage:
 *   tsx probes/call-resolution.ts --repo <path> --tsconfig <path> --module <dir> [--module <dir>]...
 */
import { Project, SyntaxKind, Node, ts } from 'ts-morph';
import * as path from 'node:path';

type Bucket =
	| 'body:module'      // implementation inside the module — D6 follows this
	| 'body:repo'        // implementation elsewhere in the repo — D6 stops, D8 counts it
	| 'body:external'    // implementation in node_modules — D6 stops
	| 'param'            // callee is a parameter: higher-order, not statically followable
	| 'no-body:repo'     // resolved to a declaration with no body, inside the repo
	| 'no-body:external' // interface or ambient declaration from a package
	| 'unresolved';      // no symbol, no signature

type Sample = { bucket: Bucket; text: string; file: string; line: number; calleeKind: string; decl: string };

/** Where the resolved declaration lives, in terms a reviewer can act on. */
function declOrigin(decl: ts.Node | undefined, repo: string): string {
	if (!decl) return '-';
	const file = decl.getSourceFile().fileName;
	const rel = file.startsWith(repo) ? file.slice(repo.length + 1) : file;
	const kind = ts.SyntaxKind[decl.kind];
	const abstract = ts.canHaveModifiers(decl) && ts.getModifiers(decl)?.some((m) => m.kind === ts.SyntaxKind.AbstractKeyword);
	return `${kind}${abstract ? '(abstract)' : ''} @ ${rel.replace(/^.*node_modules\//, 'node_modules/')}`;
}

function parseArgs(argv: string[]) {
	const out: { repo?: string; tsconfig?: string; modules: string[]; samples: number } = { modules: [], samples: 6 };
	for (let i = 0; i < argv.length; i += 2) {
		const [flag, value] = [argv[i], argv[i + 1]];
		if (flag === '--repo') out.repo = value;
		else if (flag === '--tsconfig') out.tsconfig = value;
		else if (flag === '--module') out.modules.push(value);
		else if (flag === '--samples') out.samples = Number(value);
	}
	if (!out.repo || !out.tsconfig || out.modules.length === 0) {
		throw new Error('need --repo, --tsconfig and at least one --module');
	}
	return out as Required<typeof out>;
}

/** A declaration carries a body when the call graph can continue through it. */
function bodyOf(decl: ts.Node): ts.Node | undefined {
	const anyDecl = decl as unknown as { body?: ts.Node; initializer?: ts.Node };
	if (anyDecl.body) return anyDecl.body;
	// `const f = () => {}` resolves to the variable declaration in some paths.
	const init = anyDecl.initializer;
	if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) return (init as ts.ArrowFunction).body;
	return undefined;
}

function classify(decl: ts.Node | undefined, repo: string, moduleDir: string): Bucket {
	if (!decl) return 'unresolved';
	if (ts.isParameter(decl)) return 'param';

	const file = decl.getSourceFile().fileName;
	const external = file.includes('node_modules') || !file.startsWith(repo);
	const inModule = !external && file.startsWith(moduleDir);

	if (!bodyOf(decl)) return external ? 'no-body:external' : 'no-body:repo';
	if (external) return 'body:external';
	return inModule ? 'body:module' : 'body:repo';
}

/**
 * Two resolution strategies. The signature strategy handles method calls and
 * overloads; the symbol strategy handles plain identifiers that the signature
 * strategy misses. We take the first that lands and we record the disagreement.
 */
function resolve(call: Node, checker: ts.TypeChecker) {
	const compilerCall = call.compilerNode as ts.CallLikeExpression;

	let viaSignature: ts.Node | undefined;
	try {
		viaSignature = checker.getResolvedSignature(compilerCall)?.declaration;
	} catch {
		viaSignature = undefined;
	}

	let viaSymbol: ts.Node | undefined;
	try {
		const callee = Node.isCallExpression(call) || Node.isNewExpression(call) ? call.getExpression() : undefined;
		const symbol = callee?.getSymbol();
		const target = symbol?.getAliasedSymbol() ?? symbol;
		const decls = target?.getDeclarations() ?? [];
		// Prefer a declaration that carries a body over an overload signature.
		const withBody = decls.find((d) => bodyOf(d.compilerNode));
		viaSymbol = (withBody ?? decls[0])?.compilerNode;
	} catch {
		viaSymbol = undefined;
	}

	return { viaSignature, viaSymbol };
}

function calleeKind(call: Node): string {
	if (!Node.isCallExpression(call) && !Node.isNewExpression(call)) return 'other';
	const callee = call.getExpression();
	if (Node.isIdentifier(callee)) return 'identifier';
	if (Node.isPropertyAccessExpression(callee)) return 'property-access';
	if (Node.isElementAccessExpression(callee)) return 'element-access';
	if (Node.isCallExpression(callee)) return 'call-of-call';
	if (Node.isParenthesizedExpression(callee)) return 'parenthesized';
	if (Node.isThisExpression(callee)) return 'this';
	return callee.getKindName();
}

function run() {
	const args = parseArgs(process.argv.slice(2));
	const repo = path.resolve(args.repo);
	const started = Date.now();

	const project = new Project({ tsConfigFilePath: path.resolve(args.tsconfig) });
	const checker = project.getTypeChecker().compilerObject;
	const loadMs = Date.now() - started;
	console.log(`loaded ${project.getSourceFiles().length} source files in ${(loadMs / 1000).toFixed(1)}s\n`);

	for (const mod of args.modules) {
		const moduleDir = path.resolve(repo, mod);
		const files = project.getSourceFiles().filter((sf) => {
			const p = sf.getFilePath() as string;
			return p.startsWith(moduleDir) && !p.includes('node_modules');
		});

		const counts = new Map<Bucket, number>();
		const kinds = new Map<string, number>();
		const samples: Sample[] = [];
		const perBucketSamples = new Map<Bucket, Sample[]>();
		let calls = 0;
		let disagreements = 0;
		let signatureOnly = 0;
		let symbolOnly = 0;

		const t0 = Date.now();
		for (const sf of files) {
			for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
				calls += 1;
				const { viaSignature, viaSymbol } = resolve(call, checker);
				if (viaSignature && !viaSymbol) signatureOnly += 1;
				if (!viaSignature && viaSymbol) symbolOnly += 1;

				const sigBucket = classify(viaSignature, repo, moduleDir);
				const symBucket = classify(viaSymbol, repo, moduleDir);
				// Prefer whichever strategy found an implementation.
				const bucket = sigBucket.startsWith('body') ? sigBucket : symBucket.startsWith('body') ? symBucket : sigBucket !== 'unresolved' ? sigBucket : symBucket;
				if (sigBucket !== symBucket) disagreements += 1;

				counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
				const kind = calleeKind(call);
				kinds.set(kind, (kinds.get(kind) ?? 0) + 1);

				if (bucket.startsWith('no-body') || bucket === 'unresolved' || bucket === 'param') {
					const key = bucket;
					perBucketSamples.set(key, [...(perBucketSamples.get(key) ?? [])].slice(0, args.samples));
				}
				if ((bucket === 'unresolved' || bucket.startsWith('no-body') || bucket === 'param') && (perBucketSamples.get(bucket)?.length ?? 0) < args.samples) {
					const sample: Sample = {
						bucket,
						text: call.getText().split('\n')[0].slice(0, 60),
						file: path.relative(repo, sf.getFilePath() as string),
						line: call.getStartLineNumber(),
						calleeKind: kind,
						decl: declOrigin(viaSignature ?? viaSymbol, repo),
					};
					samples.push(sample);
					perBucketSamples.set(bucket, [...(perBucketSamples.get(bucket) ?? []), sample]);
				}
			}
		}

		const pct = (n: number) => `${((n / Math.max(calls, 1)) * 100).toFixed(1)}%`;
		const get = (b: Bucket) => counts.get(b) ?? 0;

		console.log(`## ${mod}`);
		console.log(`   ${files.length} files, ${calls} call sites, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
		if (calls === 0) {
			console.log('   no call sites — check the path\n');
			continue;
		}
		const order: Bucket[] = ['body:module', 'body:repo', 'body:external', 'param', 'no-body:repo', 'no-body:external', 'unresolved'];
		for (const b of order) console.log(`   ${b.padEnd(18)} ${String(get(b)).padStart(5)}  ${pct(get(b)).padStart(6)}`);

		// The number that decides D6: of the calls we must follow inside the
		// module, how many can we follow?
		const followable = get('body:module');
		const shouldFollow = followable + get('unresolved') + get('param') + get('no-body:repo');
		console.log(`   -> intra-module followability: ${followable}/${shouldFollow} = ${((followable / Math.max(shouldFollow, 1)) * 100).toFixed(1)}%`);
		console.log(`   -> strategy disagreement: ${disagreements} (${pct(disagreements)}), signature-only ${signatureOnly}, symbol-only ${symbolOnly}`);
		console.log(`   callee syntax: ${[...kinds.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}=${n}`).join(' ')}`);

		for (const [bucket, list] of perBucketSamples) {
			console.log(`   samples — ${bucket}:`);
			for (const s of list.slice(0, args.samples)) {
				console.log(`     ${s.file}:${s.line} ${s.text}`);
				console.log(`       -> ${s.decl}`);
			}
		}
		console.log();
	}
}

run();
