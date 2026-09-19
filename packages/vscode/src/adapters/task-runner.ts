/**
 * The command port, on the task system of VS Code.
 *
 * A mutation run takes minutes and it prints as it goes, so it belongs in a
 * terminal that the user can read and stop. A task gives both, and it ends
 * with an exit code that the command port returns.
 */
import * as vscode from 'vscode';
import type { CommandRunner, Logger } from '@complexity-lens/core';

export const TASK_TYPE = 'complexityLens';

export function createTaskRunner(logger: Logger): CommandRunner {
	return {
		run(command) {
			logger.info(`Run in ${command.cwd}: ${command.commandLine}`);
			const execution = new vscode.ShellExecution(command.commandLine, { cwd: command.cwd, ...(command.env ? { env: command.env } : {}) });
			const task = new vscode.Task({ type: TASK_TYPE }, vscode.TaskScope.Workspace, command.label, 'Complexity Lens', execution);
			task.presentationOptions = { reveal: vscode.TaskRevealKind.Always, panel: vscode.TaskPanelKind.Dedicated, clear: true, echo: true };

			return new Promise((resolve) => {
				let started: vscode.TaskExecution | undefined;
				const listener = vscode.tasks.onDidEndTaskProcess((event) => {
					if (event.execution.task !== task && event.execution !== started) return;
					listener.dispose();
					logger.info(`The task ended with exit code ${String(event.exitCode)}.`);
					resolve({ exitCode: event.exitCode });
				});
				vscode.tasks.executeTask(task).then(
					(value) => {
						started = value;
					},
					(error: unknown) => {
						listener.dispose();
						logger.error(`The task did not start: ${String(error)}`);
						resolve({ exitCode: undefined });
					},
				);
			});
		},
	};
}
