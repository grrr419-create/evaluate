import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from '../tools/build.mjs';

test('both published entry points and every module use the same release version', async () => {
  const prefix = join(tmpdir(), 'evaluate-build-');
  const directory = await mkdtemp(prefix);
  try {
    await writeFile(join(directory, 'cloud-api.js'), 'obsolete');
    const result = await build(pathToFileURL(directory + sep));
    assert.equal((await readdir(directory)).includes('cloud-api.js'), false);
    for (const [name, role] of [
      ['index.html', 'evaluate'],
      ['admin.html', 'admin'],
    ]) {
      const html = await readFile(join(directory, name), 'utf8');
      assert.ok(html.includes(`data-role="${role}"`));
      assert.ok(html.includes(`app.js?v=${result.version}`));
      assert.equal((html.match(/<dialog/g) || []).length, 1);
      assert.equal(/cloud-api|statistics-excel/.test(html), false);
    }
    for (const name of result.files.filter((x) => x.endsWith('.js'))) {
      const source = await readFile(join(directory, name), 'utf8');
      for (const match of source.matchAll(/(?:from\s+|import\()['"]\.\/([^'"]+)['"]/g)) {
        const [file, query] = match[1].split('?');
        assert.ok(result.files.includes(file), file);
        assert.equal(query, `v=${result.version}`);
      }
    }
  } finally {
    assert.ok(resolve(directory).startsWith(resolve(prefix)));
    await rm(directory, { recursive: true, force: true });
  }
});
