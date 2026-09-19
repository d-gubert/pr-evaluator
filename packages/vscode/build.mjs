/** The bundle. VS Code loads one CommonJS file, and `vscode` stays external. */
import { context, build } from 'esbuild';

const options = {
	entryPoints: ['src/extension.ts'],
	bundle: true,
	outfile: 'dist/extension.js',
	platform: 'node',
	target: 'node20',
	format: 'cjs',
	sourcemap: true,
	// The editor supplies `vscode`, and the loader supplies TypeScript at run
	// time, so neither belongs in the bundle.
	external: ['vscode'],
	logLevel: 'info',
};

if (process.argv.includes('--watch')) {
	const ctx = await context(options);
	await ctx.watch();
} else {
	await build({ ...options, minify: process.argv.includes('--minify') });
}
