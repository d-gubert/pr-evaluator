import * as vscode from 'vscode';
import type { Logger } from '@complexity-lens/core';

export function createLogger(channel: vscode.OutputChannel): Logger {
	const write = (level: string, message: string): void => channel.appendLine(`[${new Date().toISOString()}] ${level} ${message}`);
	return {
		info: (message) => write('info ', message),
		warn: (message) => write('warn ', message),
		error: (message) => write('error', message),
	};
}
