#!/usr/bin/env node
// @ts-check
import { homedir } from 'node:os';
import { run } from '../src/cli/run.js';

try {
  process.exitCode = await run(process.argv.slice(2), {
    env: process.env,
    home: homedir(),
    cwd: process.cwd(),
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
    interactive: Boolean(process.stdin.isTTY && process.stderr.isTTY),
    columns: process.stdout.columns ?? process.stderr.columns,
  });
} catch (e) {
  process.stderr.write(`session-trace: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exitCode = 1;
}
