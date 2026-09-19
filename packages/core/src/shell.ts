/**
 * Command line text. The mutation plan nests a command inside a command, so
 * the quoting must be right on both shells.
 */
import type { Platform } from './ports.js';

/**
 * One argument, safe for the shell.
 *
 * POSIX shells take a single quoted string, and `'` inside it ends the string,
 * so it becomes `'\''`. The Windows shells take a double quoted string, and
 * `"` inside it doubles. Both `cmd.exe` and PowerShell read a doubled quote
 * the same way.
 */
export function quote(value: string, platform: Platform): string {
	if (platform === 'win32') return `"${value.replace(/"/g, '""')}"`;
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Quote an argument only when it holds a character that the shell reads. */
export function quoteIfNeeded(value: string, platform: Platform): string {
	return /^[A-Za-z0-9_@%+=:,./-]+$/.test(value) ? value : quote(value, platform);
}

export function buildCommandLine(executable: string, args: string[], platform: Platform): string {
	return [quoteIfNeeded(executable, platform), ...args.map((arg) => quoteIfNeeded(arg, platform))].join(' ');
}

/** Replace every `${name}` with the value under `name`. */
export function applyTemplate(template: string, values: Record<string, string>): string {
	return template.replace(/\$\{(\w+)\}/g, (match, name: string) => values[name] ?? match);
}
