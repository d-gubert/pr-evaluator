import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

/** name -> repo-relative directory. (D15) */
export interface Workspace {
	dirOf: Map<string, string>;
	/** Longest name first, so `@rocket.chat/apps/base-runtime` beats `@rocket.chat/apps`. */
	names: string[];
}

/**
 * Read the workspace map from turbo. Rocket.Chat already runs turbo, so we do
 * not write a crawler. A package with no `build` task is missing from that
 * output, so a package.json crawl fills the gaps.
 */
export function readWorkspace(root: string): Workspace {
	const dirOf = new Map<string, string>();
	try {
		const bin = path.join(root, 'node_modules', '.bin', 'turbo');
		const raw = execFileSync(bin, ['build', '--dry=json'], { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
		const json = JSON.parse(raw.slice(raw.indexOf('{')));
		for (const task of json.tasks ?? []) {
			if (task.package && task.directory) dirOf.set(task.package, task.directory);
		}
	} catch {
		// turbo is absent or it failed. The crawl below still produces a map.
	}
	crawl(root, ['packages', 'apps', 'ee/packages', 'ee/apps'], dirOf);
	const names = [...dirOf.keys()].sort((a, b) => b.length - a.length);
	return { dirOf, names };
}

function crawl(root: string, roots: string[], out: Map<string, string>): void {
	for (const rel of roots) {
		const base = path.join(root, rel);
		if (!fs.existsSync(base)) continue;
		for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			const dir = path.join(rel, entry.name);
			readName(root, dir, out);
			for (const nested of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
				if (nested.isDirectory() && nested.name !== 'node_modules') readName(root, path.join(dir, nested.name), out);
			}
		}
	}
}

function readName(root: string, dir: string, out: Map<string, string>): void {
	const pkg = path.join(root, dir, 'package.json');
	if (!fs.existsSync(pkg)) return;
	try {
		const name = JSON.parse(fs.readFileSync(pkg, 'utf8')).name;
		if (name && !out.has(name)) out.set(name, dir);
	} catch {
		/* a broken package.json is not our problem */
	}
}

/** Split a bare specifier into its package and the rest of the path. */
export function splitSpecifier(ws: Workspace, spec: string): { pkg: string; dir: string; rest: string } | undefined {
	for (const name of ws.names) {
		if (spec === name || spec.startsWith(`${name}/`)) {
			return { pkg: name, dir: ws.dirOf.get(name)!, rest: spec.slice(name.length).replace(/^\//, '') };
		}
	}
	return undefined;
}

/**
 * Rewrite a resolved path that landed in a built package back onto the source.
 * Tier 2 needs this, because the type checker follows the workspace symlink
 * into `dist`. Returns undefined when no source file exists. (D15)
 */
export function remapDistToSrc(root: string, ws: Workspace, absPath: string): string | undefined {
	const rel = path.relative(root, absPath);
	const nm = rel.match(/^node_modules\/(.+)$/) ?? rel.match(/node_modules\/(.+)$/);
	let candidate = rel;
	if (nm) {
		const found = splitSpecifier(ws, nm[1]);
		if (!found) return undefined;
		candidate = path.join(found.dir, found.rest);
	}
	const m = candidate.match(/^(.*?)\/dist\/(.+)$/);
	if (!m) return path.join(root, candidate);
	const [, pkgDir, tail] = m;
	const stem = tail.replace(/\.d\.ts$/, '').replace(/\.js$/, '');
	for (const ext of ['.ts', '.tsx', '.js']) {
		for (const base of [path.join(pkgDir, 'src', stem + ext), path.join(pkgDir, 'src', stem, 'index' + ext)]) {
			if (fs.existsSync(path.join(root, base))) return path.join(root, base);
		}
	}
	return undefined;
}
