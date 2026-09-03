import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { database, call } from './helpers.mjs';
import { fixtureAdmin } from './fixtures.mjs';

test('current schema can be reapplied without losing answers, participation, notice or sessions', async () => {
  const db = await database();
  try {
    const admin = (await call(db, '/api/admin/login', fixtureAdmin)).data.session;
    const device = 'a'.repeat(64);
    const session = (await call(db, '/api/evaluate/login', { device })).data.session;
    const initial = (await call(db, '/api/evaluate/session', {}, session)).data;
    await call(db, '/api/evaluate/acknowledge', { notice_version: initial.notice_version }, session);
    await call(
      db,
      '/api/evaluate/submit',
      {
        epoch: initial.epoch,
        assessment_version: initial.assessment_version,
        answers: { 'question-a': 0, 'question-b': 1 },
      },
      session,
    );
    const before = (await call(db, '/api/admin/export', {}, admin)).data;
    const schema = await readFile(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
    await db.exec(schema);
    await db.exec(schema);
    assert.deepEqual((await call(db, '/api/admin/export', {}, admin)).data, before);
    assert.equal((await call(db, '/api/evaluate/session', {}, session)).data.complete, true);
    assert.equal((await call(db, '/api/evaluate/login', { device })).status, 409);
    assert.equal((await call(db, '/api/evaluate/session', {}, session)).data.notice, initial.notice);
    const columns = (
      await db.query(
        "select column_name from information_schema.columns where table_schema='evaluate_private'",
      )
    ).rows;
    assert.equal(
      columns.some((c) => /employee|nickname/.test(c.column_name)),
      false,
    );
  } finally {
    await db.close();
  }
});
