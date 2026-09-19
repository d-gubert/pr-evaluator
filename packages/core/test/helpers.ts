/** A file system that lives in a Map, so a test needs no disk. */
import * as ts from 'typescript';
import type { FileSystem } from '../src/ports.js';

export const tsApi = ts;

export function memoryFileSystem(files: Record<string, string>): FileSystem {
	const store = new Map(Object.entries(files));
	return {
		async readFile(file) {
			return store.get(file);
		},
		async exists(file) {
			return store.has(file);
		},
		async findFiles(glob) {
			const suffix = glob.replace(/^\*\*\//, '');
			return [...store.keys()].filter((file) => file.endsWith(suffix));
		},
	};
}
