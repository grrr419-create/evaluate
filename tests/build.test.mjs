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
      assert.doesNotMatch(html, /{{[A-Z_]+}}/);
    }
    const evaluationHtml = await readFile(join(directory, 'index.html'), 'utf8');
    const adminHtml = await readFile(join(directory, 'admin.html'), 'utf8');
    assert.match(evaluationHtml, /<meta property="og:title" content="업무환경 심리평가"/);
    assert.match(
      evaluationHtml,
      /<meta property="og:url" content="https:\/\/grrr419-create\.github\.io\/evaluate\/"/,
    );
    assert.match(evaluationHtml, /login-reference\.jpg/);
    assert.doesNotMatch(evaluationHtml, /업무환경 심리평가 관리자/);
    assert.match(adminHtml, /<meta property="og:title" content="업무환경 심리평가 관리자"/);
    assert.match(adminHtml, /참여 현황과 평가 결과를 확인하는 관리자 페이지입니다\./);
    assert.match(
      adminHtml,
      /<meta property="og:url" content="https:\/\/grrr419-create\.github\.io\/evaluate\/admin\.html"/,
    );
    assert.match(adminHtml, /admin-og\.png/);
    assert.ok(result.files.includes('admin-og.png'));
    for (const name of result.files.filter((x) => x.endsWith('.js'))) {
      const source = await readFile(join(directory, name), 'utf8');
      for (const match of source.matchAll(/(?:from\s+|import\()['"]\.\/([^'"]+)['"]/g)) {
        const [file, query] = match[1].split('?');
        assert.ok(result.files.includes(file), file);
        assert.equal(query, `v=${result.version}`);
      }
    }
    const app = await readFile(join(directory, 'app.js'), 'utf8');
    assert.match(app, /link\.download = '업무환경 심리평가 결과\.xlsx'/);
  } finally {
    assert.ok(resolve(directory).startsWith(resolve(prefix)));
    await rm(directory, { recursive: true, force: true });
  }
});
