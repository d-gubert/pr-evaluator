/**
 * The effect catalog. (D7)
 *
 * `ast-grep` matches the catalog entries, the same engine as the boundary
 * providers of D3. A pattern therefore lives in config, not in code.
 * Semgrep OSS cannot do this job: its taint mode is intra-procedural.
 */
import { execFileSync } from 'node:child_process';
import type { Config, ProviderConfig } from './config.js';

export interface Match {
	/** Repo-relative file. */
	file: string;
	/** 1-based. ast-grep reports 0-based. */
	line: number;
	endLine: number;
	/** The first metavariable, when the caller asked for one. */
	name?: string;
}

function run(root: string, pattern: string, dirs: string[], nameVar?: string): Match[] {
	if (!dirs.length) return [];
	const out: Match[] = [];
	for (const lang of ['ts', 'tsx'] as const) {
		let raw: string;
		try {
			raw = execFileSync('ast-grep', ['run', '--lang', lang, '--pattern', pattern, '--json=compact', ...dirs], {
				cwd: root,
				encoding: 'utf8',
				maxBuffer: 512 * 1024 * 1024,
				stdio: ['ignore', 'pipe', 'ignore'],
			});
		} catch {
			continue; // ast-grep exits non-zero when it finds nothing.
		}
		if (!raw.trim()) continue;
		for (const m of JSON.parse(raw)) {
			out.push({
				file: m.file,
				line: m.range.start.line + 1,
				endLine: m.range.end.line + 1,
				name: nameVar ? stripQuotes(m.metaVariables?.single?.[nameVar]?.text) : undefined,
			});
		}
	}
	return out;
}

function stripQuotes(s?: string): string | undefined {
	return s?.replace(/^['"`]|['"`]$/g, '');
}

/** category -> matches, over the given repo-relative directories. */
export function findEffects(root: string, dirs: string[], config: Config): Map<string, Match[]> {
	const found = new Map<string, Match[]>();
	for (const [category, patterns] of Object.entries(config.effects)) {
		const all: Match[] = [];
		for (const p of patterns) all.push(...run(root, p, dirs));
		found.set(category, all);
	}
	return found;
}

/** A boundary provider that is not `export`. (D3) */
export function findProvided(root: string, dirs: string[], provider: ProviderConfig): Match[] {
	const scoped = provider.roots ? dirs.filter((d) => provider.roots!.some((r) => d.startsWith(r))) : dirs;
	return run(root, provider.pattern, scoped, provider.nameVar).filter((m) => !!m.name);
}

export function hasAstGrep(): boolean {
	try {
		execFileSync('ast-grep', ['--version'], { stdio: 'ignore' });
		return true;
	} catch {
		return false;
	}
}
