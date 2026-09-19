/**
 * What to mutate for a given test file.
 *
 * The import list of the test file is the strongest signal: a unit test
 * imports the unit it tests. The name convention is the second signal. The
 * union of both, in that order, is the mutation scope.
 */
import type { FileSystem, TypeScriptApi } from '../ports.js';
import { dirname, extname, join, resolve } from '../paths.js';
import { parseSource } from '../syntax.js';
import { isTestFile, sourceFileCandidates } from '../tests/naming.js';

export interface MutationScope {
	/** Absolute paths, best candidate first. */
	files: string[];
	reason: string;
}

export interface MutationScopeDeps {
	ts: TypeScriptApi;
	fs: FileSystem;
	/** The workspace root, so a `test` directory above it means nothing. */
	workspaceRoot?: string;
}

const RESOLVED_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

export async function resolveMutationScope(deps: MutationScopeDeps, testFile: string, testText: string): Promise<MutationScope> {
	const paired = await firstExisting(deps.fs, sourceFileCandidates(testFile));
	const imported = await importedSourceFiles(deps, testFile, testText);
	const files = unique([...(paired ? [paired] : []), ...imported]);
	if (files.length === 0) return { files, reason: 'no source file was found for this test' };
	if (paired && imported.length > 0) return { files, reason: 'the paired source file and the local imports of the test' };
	if (paired) return { files, reason: 'the source file that the name convention pairs with the test' };
	return { files, reason: 'the local imports of the test' };
}

/** Every relative import of the test file that resolves to a source file. */
export async function importedSourceFiles(deps: MutationScopeDeps, testFile: string, testText: string): Promise<string[]> {
	const sf = parseSource(deps.ts, testFile, testText);
	const directory = dirname(testFile);
	const out: string[] = [];
	for (const specifier of importSpecifiers(deps.ts, sf)) {
		if (!specifier.startsWith('.')) continue;
		const resolved = await resolveSpecifier(deps.fs, resolve(directory, specifier));
		if (resolved && !isTestFile(resolved, deps.workspaceRoot)) out.push(resolved);
	}
	return unique(out);
}

function importSpecifiers(ts: TypeScriptApi, sf: import('typescript').SourceFile): string[] {
	const out: string[] = [];
	const read = (node: import('typescript').Node): void => {
		if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
			const specifier = node.moduleSpecifier;
			if (specifier && ts.isStringLiteral(specifier)) out.push(specifier.text);
		} else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText(sf) === 'require')) {
			const first = node.arguments[0];
			if (first && ts.isStringLiteral(first)) out.push(first.text);
		}
		ts.forEachChild(node, read);
	};
	read(sf);
	return out;
}

/** Apply the TypeScript rules: an explicit file, then the extensions, then `index`. */
async function resolveSpecifier(fs: FileSystem, path: string): Promise<string | undefined> {
	const extension = extname(path);
	if (extension !== '') {
		// `./a.js` in ESM TypeScript names `./a.ts` on disk.
		const withoutExtension = path.slice(0, path.length - extension.length);
		const candidates = [path, ...RESOLVED_EXTENSIONS.map((candidate) => withoutExtension + candidate)];
		return firstExisting(fs, candidates);
	}
	return firstExisting(fs, [...RESOLVED_EXTENSIONS.map((candidate) => path + candidate), ...RESOLVED_EXTENSIONS.map((candidate) => join(path, `index${candidate}`))]);
}

async function firstExisting(fs: FileSystem, candidates: string[]): Promise<string | undefined> {
	for (const candidate of candidates) {
		if (await fs.exists(candidate)) return candidate;
	}
	return undefined;
}

function unique(values: string[]): string[] {
	return [...new Set(values)];
}
