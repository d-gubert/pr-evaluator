/**
 * The name conventions that tie a source file to a test file.
 *
 * This is the last strategy of the test lookup, so it may guess. It offers
 * candidates in the order that a reader expects, and the caller keeps the ones
 * that exist.
 */
import { basename, dirname, extname, join, normalize, relative } from '../paths.js';

const MARKERS = ['.test', '.spec', '-test', '-spec', '_test', '_spec'];
const TEST_DIRECTORIES = ['__tests__', 'test', 'tests', 'spec'];
const SOURCE_DIRECTORIES = ['src', 'lib', 'source'];
const EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

/**
 * A test file, by its name or by the directory that holds it.
 *
 * Pass `root` whenever there is one. The path above the workspace root is not
 * the business of the workspace, and a checkout that lives under a directory
 * called `test` would otherwise turn every source file into a test file.
 */
export function isTestFile(file: string, root?: string): boolean {
	const name = basename(file);
	const stem = name.slice(0, name.length - extname(name).length);
	if (MARKERS.some((marker) => stem.endsWith(marker))) return true;
	const directory = root && isUnder(file, root) ? relative(root, dirname(file)) : dirname(file);
	return directory.split('/').some((segment) => TEST_DIRECTORIES.includes(segment.toLowerCase()));
}

export function isUnder(file: string, root: string): boolean {
	const normalizedRoot = normalize(root).toLowerCase();
	const normalizedFile = normalize(file).toLowerCase();
	return normalizedFile === normalizedRoot || normalizedFile.startsWith(`${normalizedRoot}/`);
}

/** The file name without its extension and without a test marker. */
export function stemOf(file: string): string {
	const name = basename(file);
	let stem = name.slice(0, name.length - extname(name).length);
	for (const marker of MARKERS) {
		if (stem.endsWith(marker)) {
			stem = stem.slice(0, stem.length - marker.length);
			break;
		}
	}
	return stem;
}

/** Where the tests of a source file may live, best guess first. */
export function testFileCandidates(sourceFile: string): string[] {
	const stem = stemOf(sourceFile);
	const directory = dirname(sourceFile);
	const own = extname(sourceFile);
	const extensions = [own, ...EXTENSIONS.filter((extension) => extension !== own)];
	const directories = [directory, ...TEST_DIRECTORIES.map((name) => join(directory, name)), ...mirrorDirectories(directory)];
	const out: string[] = [];
	for (const candidateDirectory of directories) {
		for (const marker of MARKERS) {
			for (const extension of extensions) out.push(join(candidateDirectory, `${stem}${marker}${extension}`));
		}
	}
	return unique(out);
}

/** Where the source of a test file may live, best guess first. */
export function sourceFileCandidates(testFile: string): string[] {
	const stem = stemOf(testFile);
	const directory = dirname(testFile);
	const own = extname(testFile);
	const extensions = [own, ...EXTENSIONS.filter((extension) => extension !== own)];
	const directories = [directory, dirname(directory), ...unmirrorDirectories(directory)];
	const out: string[] = [];
	for (const candidateDirectory of directories) {
		for (const extension of extensions) out.push(join(candidateDirectory, `${stem}${extension}`));
	}
	return unique(out);
}

/** A glob that matches every test file of the workspace. */
export function defaultTestGlob(): string {
	return '**/*.{test,spec}.{ts,tsx,mts,cts,js,jsx,mjs,cjs}';
}

/** `src/a/b` becomes `test/a/b` and `tests/a/b`. */
function mirrorDirectories(directory: string): string[] {
	const parts = directory.split('/');
	const index = lastIndexIn(parts, SOURCE_DIRECTORIES);
	if (index < 0) return [];
	return TEST_DIRECTORIES.map((name) => [...parts.slice(0, index), name, ...parts.slice(index + 1)].join('/'));
}

/** `test/a/b` becomes `src/a/b` and `lib/a/b`. */
function unmirrorDirectories(directory: string): string[] {
	const parts = directory.split('/');
	const index = lastIndexIn(parts, TEST_DIRECTORIES);
	if (index < 0) return [];
	const withoutTestDirectory = [...parts.slice(0, index), ...parts.slice(index + 1)].join('/');
	return [withoutTestDirectory, ...SOURCE_DIRECTORIES.map((name) => [...parts.slice(0, index), name, ...parts.slice(index + 1)].join('/'))];
}

/**
 * The *last* matching segment, not the first. `packages/core/test/src` has two
 * candidates, and the one nearest the file is the one that pairs with it.
 */
function lastIndexIn(parts: string[], names: string[]): number {
	for (let index = parts.length - 1; index >= 0; index--) {
		if (names.includes((parts[index] ?? '').toLowerCase())) return index;
	}
	return -1;
}

function unique(values: string[]): string[] {
	return [...new Set(values)];
}
