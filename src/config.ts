import * as fs from 'node:fs';
import * as path from 'node:path';

/** A boundary provider is a pattern in config, not code. (D3) */
export interface ProviderConfig {
	name: string;
	/** An ast-grep pattern. */
	pattern: string;
	/** Which metavariable holds the symbol name. */
	nameVar: string;
	/** Restrict the search to these repo-relative roots. */
	roots?: string[];
}

export interface Config {
	/** Glob-like patterns that select a module directory. (D1) */
	modules: string[];
	/** Path prefixes that never form a module. */
	exclude: string[];
	/** Effect category -> ast-grep patterns. (D7) */
	effects: Record<string, string[]>;
	providers: ProviderConfig[];
	/** File name patterns that mark a test file. (OQ7) */
	testFiles: string[];
	/** How far tier 1 follows a re-export chain. (D5) */
	reexportDepth: number;
}

export const DEFAULT_CONFIG: Config = {
	// Corrected against the checkout. Open question 11 still applies.
	modules: [
		'apps/meteor/server/*',
		'apps/meteor/server/services/*',
		'apps/meteor/client/*',
		'apps/meteor/app/*/*',
		'apps/meteor/ee/server/*',
		'packages/*/src',
		'packages/*/*/src',
		'ee/packages/*/src',
	],
	exclude: ['node_modules', 'dist', 'build', '.meteor', 'coverage', 'apps/meteor/tests'],
	effects: {
		db: ['Models.$MODEL.insert($$$A)', 'Models.$MODEL.update($$$A)', 'Models.$MODEL.remove($$$A)', '$M.insertOne($$$A)', '$M.updateOne($$$A)', '$M.deleteOne($$$A)', '$M.findOneAndUpdate($$$A)'],
		network: ['fetch($$$A)', 'axios($$$A)', 'axios.$M($$$A)', 'got($$$A)'],
		fs: ['fs.$M($$$A)', 'fs.promises.$M($$$A)', 'readFile($$$A)', 'writeFile($$$A)'],
		process: ['process.env', 'process.exit($$$A)'],
		timer: ['setTimeout($$$A)', 'setInterval($$$A)'],
		emit: ['api.broadcast($$$A)', 'Meteor.call($$$A)', 'Meteor.callAsync($$$A)'],
	},
	providers: [
		// exportProvider is built in; it needs no pattern.
		{ name: 'apiRouteProbe', pattern: `API.v1.addRoute($PATH, $$$ARGS)`, nameVar: 'PATH', roots: ['apps/meteor'] },
	],
	testFiles: ['.spec.ts', '.spec.tsx', '.test.ts', '.test.tsx', '/tests/', '/__tests__/'],
	reexportDepth: 6,
};

export function loadConfig(file?: string): Config {
	if (!file) return DEFAULT_CONFIG;
	const raw = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
	return { ...DEFAULT_CONFIG, ...raw };
}

/** Match a repo-relative directory against one module pattern. `*` is one segment. */
export function matchesPattern(dir: string, pattern: string): boolean {
	const d = dir.split('/');
	const p = pattern.split('/');
	if (d.length !== p.length) return false;
	return p.every((seg, i) => seg === '*' || seg === d[i]);
}

export function isTestFile(relPath: string, config: Config): boolean {
	return config.testFiles.some((t) => (t.startsWith('.') ? relPath.endsWith(t) : relPath.includes(t)));
}
