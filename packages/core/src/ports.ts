/**
 * The ports. The core calls these, and the editor adapter implements them.
 *
 * The rule of this package: no import of `vscode`, and no import of a Node
 * built-in module. Everything that touches the world arrives through a port.
 */
import type * as tsApi from 'typescript';
import type { FileLocation, FileRange } from './model.js';

/**
 * The TypeScript API itself is a port. The VS Code adapter passes the copy of
 * TypeScript that VS Code ships, so the extension reads the same syntax that
 * the editor reads. The core only imports the *types* of TypeScript.
 */
export type TypeScriptApi = typeof tsApi;

export interface FileSystem {
	/** The text of a file, or undefined when it does not exist. */
	readFile(file: string): Promise<string | undefined>;
	exists(file: string): Promise<boolean>;
	/** Absolute paths that match a glob, relative to the workspace root. */
	findFiles(glob: string, exclude?: string): Promise<string[]>;
}

export interface CommandSpec {
	/** A label for the terminal or the task that runs the command. */
	label: string;
	/** The command line, already quoted for the target shell. */
	commandLine: string;
	cwd: string;
	env?: Record<string, string>;
}

export interface CommandResult {
	exitCode: number | undefined;
	/** A runner that streams to a terminal reports no output here. */
	output?: string;
}

export interface CommandRunner {
	run(command: CommandSpec): Promise<CommandResult>;
}

/**
 * The reference search of the editor. The VS Code adapter forwards it to the
 * TypeScript language server, so the answer follows imports, re-exports and
 * types. A port with no language server can return an empty list.
 */
export interface ReferenceFinder {
	findReferences(location: FileLocation): Promise<FileRange[]>;
}

export interface Logger {
	info(message: string): void;
	warn(message: string): void;
	error(message: string): void;
}

export const SILENT_LOGGER: Logger = {
	info: () => undefined,
	warn: () => undefined,
	error: () => undefined,
};

/** The shell family that a command string must suit. */
export type Platform = 'posix' | 'win32';
