/**
 * Path helpers.
 *
 * The core must run in a plain browser too, because VS Code has a web host and
 * because another editor may embed it. So it does not import `node:path`. The
 * helpers below work on POSIX and on Windows paths, and they always return a
 * path with `/` separators.
 */

/** Replace `\` with `/` and drop a trailing separator. */
export function toPosix(p: string): string {
	const slashed = p.replace(/\\/g, '/');
	return slashed.length > 1 && slashed.endsWith('/') ? slashed.slice(0, -1) : slashed;
}

/** Resolve `.` and `..` segments. The result keeps the leading `/` or the drive. */
export function normalize(p: string): string {
	const posix = toPosix(p);
	const absolute = posix.startsWith('/');
	const drive = /^[a-zA-Z]:\//.exec(posix)?.[0] ?? '';
	const body = drive ? posix.slice(drive.length) : absolute ? posix.slice(1) : posix;
	const out: string[] = [];
	for (const segment of body.split('/')) {
		if (segment === '' || segment === '.') continue;
		if (segment === '..' && out.length > 0 && out[out.length - 1] !== '..') {
			out.pop();
			continue;
		}
		if (segment === '..' && (absolute || drive)) continue;
		out.push(segment);
	}
	const joined = out.join('/');
	if (drive) return drive + joined;
	return absolute ? `/${joined}` : joined;
}

export function isAbsolute(p: string): boolean {
	const posix = toPosix(p);
	return posix.startsWith('/') || /^[a-zA-Z]:\//.test(posix);
}

export function join(...parts: string[]): string {
	return normalize(parts.filter((part) => part.length > 0).join('/'));
}

/** Make `p` absolute against `base` when it is relative. */
export function resolve(base: string, p: string): string {
	return isAbsolute(p) ? normalize(p) : join(base, p);
}

export function dirname(p: string): string {
	const posix = normalize(p);
	const cut = posix.lastIndexOf('/');
	if (cut < 0) return '.';
	if (cut === 0) return '/';
	return posix.slice(0, cut);
}

export function basename(p: string): string {
	const posix = normalize(p);
	const cut = posix.lastIndexOf('/');
	return cut < 0 ? posix : posix.slice(cut + 1);
}

/** The last extension, with the dot. `a.test.ts` gives `.ts`. */
export function extname(p: string): string {
	const name = basename(p);
	const cut = name.lastIndexOf('.');
	return cut <= 0 ? '' : name.slice(cut);
}

/** The path of `to` as seen from the directory `from`. */
export function relative(from: string, to: string): string {
	const fromParts = normalize(from).split('/').filter(Boolean);
	const toParts = normalize(to).split('/').filter(Boolean);
	let shared = 0;
	while (shared < fromParts.length && shared < toParts.length && equalSegment(fromParts[shared]!, toParts[shared]!)) shared++;
	const up = fromParts.length - shared;
	const down = toParts.slice(shared);
	return [...new Array<string>(up).fill('..'), ...down].join('/') || '.';
}

/**
 * Two paths that name the same file. A case difference is a match, because
 * macOS and Windows report the same file under either case.
 */
export function samePath(a: string, b: string): boolean {
	return normalize(a).toLowerCase() === normalize(b).toLowerCase();
}

/**
 * `candidate` names the same file as `target`, or the tail of it. A coverage
 * report may write `src/a.ts` where the editor holds `/repo/src/a.ts`, so a
 * tail match on a segment boundary is a match.
 */
export function matchesPathTail(candidate: string, target: string): boolean {
	if (samePath(candidate, target)) return true;
	const short = normalize(candidate).toLowerCase();
	const long = normalize(target).toLowerCase();
	const [tail, whole] = short.length <= long.length ? [short, long] : [long, short];
	return whole.endsWith(`/${tail}`);
}

function equalSegment(a: string, b: string): boolean {
	return a.toLowerCase() === b.toLowerCase();
}
