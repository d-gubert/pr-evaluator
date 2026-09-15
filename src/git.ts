/** The two trees of D4. The base tree is a worktree with a symlinked node_modules. */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export function git(repo: string, args: string[]): string {
	return execFileSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }).trim();
}

export function resolveCommit(repo: string, ref: string): string {
	return git(repo, ['rev-parse', ref]);
}

export interface ChangeSet {
	changed: string[];
	renames: { from: string; to: string }[];
}

/** `git diff --name-status -M` so a rename stays one record. (OQ3) */
export function changeSet(repo: string, base: string, head: string): ChangeSet {
	const raw = git(repo, ['diff', '--name-status', '-M', base, head]);
	const changed: string[] = [];
	const renames: { from: string; to: string }[] = [];
	for (const line of raw.split('\n').filter(Boolean)) {
		const cols = line.split('\t');
		if (cols[0].startsWith('R')) {
			renames.push({ from: cols[1], to: cols[2] });
			changed.push(cols[1], cols[2]);
		} else {
			changed.push(cols[cols.length - 1]);
		}
	}
	return { changed, renames };
}

/**
 * A detached worktree at `commit`. It reuses the node_modules of the head
 * checkout through a symlink, so no install runs. (D4)
 */
export function makeWorktree(repo: string, commit: string): { dir: string; cleanup: () => void } {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-evaluator-'));
	git(repo, ['worktree', 'add', '--detach', '--force', dir, commit]);
	linkNodeModules(repo, dir);
	return {
		dir,
		cleanup: () => {
			try {
				git(repo, ['worktree', 'remove', '--force', dir]);
			} catch {
				fs.rmSync(dir, { recursive: true, force: true });
			}
		},
	};
}

/** pnpm puts a node_modules in several workspace packages, not only at the root. */
export function linkNodeModules(repo: string, dir: string): string[] {
	const linked: string[] = [];
	(function rec(rel: string, depth: number) {
		if (depth > 4) return;
		const abs = path.join(repo, rel);
		for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
			if (e.name === 'node_modules') {
				const target = path.join(dir, rel, 'node_modules');
				if (fs.existsSync(target)) continue;
				fs.mkdirSync(path.dirname(target), { recursive: true });
				fs.symlinkSync(path.join(abs, 'node_modules'), target, 'dir');
				linked.push(path.join(rel, 'node_modules'));
				continue;
			}
			if (e.isDirectory() && !e.name.startsWith('.')) rec(path.join(rel, e.name), depth + 1);
		}
	})('.', 0);
	return linked;
}
