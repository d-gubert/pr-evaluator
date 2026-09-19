/**
 * The TypeScript that the extension reads with.
 *
 * The extension bundles no compiler. It loads the copy that VS Code already
 * runs, so the hover reads the same syntax as the editor, the version follows
 * the editor, and the bundle stays small. The order below is the order that
 * the built-in TypeScript extension itself uses.
 *
 *   1. The `typescript.tsdk` setting, which a workspace sets to pin a version.
 *   2. The copy inside VS Code.
 *   3. `node_modules/typescript` of an open workspace folder.
 */
import { createRequire } from 'node:module';
import * as vscode from 'vscode';
import { paths, type Logger, type TypeScriptApi } from '@complexity-lens/core';

const nodeRequire = createRequire(__filename);

export class TypeScriptNotFoundError extends Error {
	constructor(tried: string[]) {
		super(`Complexity Lens found no TypeScript to read with. Tried:\n${tried.join('\n')}`);
		this.name = 'TypeScriptNotFoundError';
	}
}

let loaded: TypeScriptApi | undefined;

/** The TypeScript API. The first call loads it, and the rest reuse it. */
export function loadTypeScript(logger: Logger): TypeScriptApi {
	if (loaded) return loaded;
	const tried: string[] = [];
	for (const candidate of candidates()) {
		tried.push(`${candidate.label}: ${candidate.path}`);
		const api = tryRequire(candidate.path);
		if (!api) continue;
		logger.info(`TypeScript ${api.version} from ${candidate.label} (${candidate.path})`);
		loaded = api;
		return api;
	}
	throw new TypeScriptNotFoundError(tried);
}

/** Drop the loaded copy, so a changed `typescript.tsdk` takes effect. */
export function resetTypeScript(): void {
	loaded = undefined;
}

function candidates(): { label: string; path: string }[] {
	const out: { label: string; path: string }[] = [];
	for (const folder of vscode.workspace.workspaceFolders ?? []) {
		const root = paths.toPosix(folder.uri.fsPath);
		const tsdk = vscode.workspace.getConfiguration('typescript', folder.uri).get<string>('tsdk');
		if (tsdk) out.push({ label: 'the typescript.tsdk setting', path: paths.join(paths.resolve(root, paths.toPosix(tsdk)), 'typescript.js') });
	}
	out.push({ label: 'the TypeScript of VS Code', path: paths.join(paths.toPosix(vscode.env.appRoot), 'extensions/node_modules/typescript/lib/typescript.js') });
	for (const folder of vscode.workspace.workspaceFolders ?? []) {
		out.push({ label: `node_modules of ${folder.name}`, path: paths.join(paths.toPosix(folder.uri.fsPath), 'node_modules/typescript/lib/typescript.js') });
	}
	return out;
}

function tryRequire(path: string): TypeScriptApi | undefined {
	try {
		const api = nodeRequire(path) as Partial<TypeScriptApi>;
		return typeof api.createSourceFile === 'function' ? (api as TypeScriptApi) : undefined;
	} catch {
		return undefined;
	}
}
