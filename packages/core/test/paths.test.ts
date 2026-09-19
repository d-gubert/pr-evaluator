import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { basename, dirname, extname, join, matchesPathTail, normalize, relative, resolve, samePath, toPosix } from '../src/paths.js';

describe('paths', () => {
	it('turns a Windows path into a POSIX path', () => {
		assert.equal(toPosix('C:\\repo\\src\\a.ts'), 'C:/repo/src/a.ts');
	});

	it('resolves the dot segments', () => {
		assert.equal(normalize('/repo/src/../test/./a.ts'), '/repo/test/a.ts');
		assert.equal(normalize('C:\\repo\\src\\..\\a.ts'), 'C:/repo/a.ts');
	});

	it('joins and splits', () => {
		assert.equal(join('/repo', 'src', 'a.ts'), '/repo/src/a.ts');
		assert.equal(dirname('/repo/src/a.ts'), '/repo/src');
		assert.equal(basename('/repo/src/a.test.ts'), 'a.test.ts');
		assert.equal(extname('/repo/src/a.test.ts'), '.ts');
	});

	it('keeps an absolute path and grows a relative one', () => {
		assert.equal(resolve('/repo', 'src/a.ts'), '/repo/src/a.ts');
		assert.equal(resolve('/repo', '/other/a.ts'), '/other/a.ts');
	});

	it('reports a path as seen from a directory', () => {
		assert.equal(relative('/repo', '/repo/src/a.ts'), 'src/a.ts');
		assert.equal(relative('/repo/src', '/repo/test/a.ts'), '../test/a.ts');
	});

	it('matches a report path against an editor path', () => {
		assert.equal(samePath('/repo/src/a.ts', '/repo/src/A.ts'), true);
		assert.equal(matchesPathTail('src/a.ts', '/repo/src/a.ts'), true);
		assert.equal(matchesPathTail('lib/a.ts', '/repo/src/a.ts'), false);
	});
});
