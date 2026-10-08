import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { database, call } from './helpers.mjs';
import { fixture, fixtureAdmin } from './fixtures.mjs';

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

test('adding a question preserves earlier answers and reports participation per question', async () => {
  const db = await database();
  try {
    const admin = (await call(db, '/api/admin/login', fixtureAdmin)).data.session;
    const first = (await call(db, '/api/evaluate/login', { device: '1'.repeat(64) })).data.session;
    const initial = (await call(db, '/api/evaluate/session', {}, first)).data;
    await call(db, '/api/evaluate/acknowledge', { notice_version: initial.notice_version }, first);
    assert.equal(
      (
        await call(
          db,
          '/api/evaluate/submit',
          {
            epoch: initial.epoch,
            assessment_version: initial.assessment_version,
            answers: { 'question-a': 0, 'question-b': 1 },
          },
          first,
        )
      ).status,
      200,
    );
    const added = { id: 'question-new', text: '새 문항', options: ['예', '아니오'] };
    await db.query('update evaluate_private.settings set source=source||$1::jsonb where singleton', [
      JSON.stringify({
        revision: 'fixture-with-added-question',
        survey_version: 'fixture-survey-updated',
        questions: [...fixture.questions, added],
      }),
    ]);
    let dashboard = (await call(db, '/api/admin/dashboard', {}, admin)).data;
    assert.equal(dashboard.completed, 1);
    assert.equal(dashboard.question_count, 3);
    assert.deepEqual(
      dashboard.statistics.map((q) => q.answered),
      [1, 1, 0],
    );
    assert.deepEqual(dashboard.statistics[2].counts, [0, 0]);

    const second = (await call(db, '/api/evaluate/login', { device: '2'.repeat(64) })).data.session;
    const secondInitial = (await call(db, '/api/evaluate/session', {}, second)).data;
    const secondView = (
      await call(db, '/api/evaluate/acknowledge', { notice_version: secondInitial.notice_version }, second)
    ).data;
    assert.equal(
      (
        await call(
          db,
          '/api/evaluate/submit',
          {
            epoch: secondView.epoch,
            assessment_version: secondView.assessment_version,
            answers: { 'question-a': 1, 'question-b': 2, 'question-new': 0 },
          },
          second,
        )
      ).status,
      200,
    );
    dashboard = (await call(db, '/api/admin/dashboard', {}, admin)).data;
    assert.equal(dashboard.completed, 2);
    assert.deepEqual(
      dashboard.statistics.map((q) => q.answered),
      [2, 2, 1],
    );
    assert.deepEqual(dashboard.statistics[2].counts, [1, 0]);
  } finally {
    await db.close();
  }
});

test('optional free-text answers are trimmed, counted separately and excluded from scoring statistics', async () => {
  const db = await database();
  try {
    const admin = (await call(db, '/api/admin/login', fixtureAdmin)).data.session;
    const first = (await call(db, '/api/evaluate/login', { device: '3'.repeat(64) })).data.session;
    const firstView = (await call(db, '/api/evaluate/session', {}, first)).data;
    await call(db, '/api/evaluate/acknowledge', { notice_version: firstView.notice_version }, first);
    assert.equal(
      (
        await call(
          db,
          '/api/evaluate/submit',
          {
            epoch: firstView.epoch,
            assessment_version: firstView.assessment_version,
            answers: { 'question-a': 0, 'question-b': 1 },
          },
          first,
        )
      ).status,
      200,
    );

    const freeText = {
      id: 'question-opinion',
      text: '16. 자유 의견',
      type: 'text',
      required: false,
      max_length: 500,
    };
    await db.query('update evaluate_private.settings set source=source||$1::jsonb where singleton', [
      JSON.stringify({
        revision: 'fixture-with-opinion',
        survey_version: 'fixture-survey-with-opinion',
        questions: [...fixture.questions, freeText],
      }),
    ]);
    let dashboard = (await call(db, '/api/admin/dashboard', {}, admin)).data;
    assert.equal(dashboard.question_count, 3);
    assert.equal(dashboard.scored_question_count, 2);
    assert.equal(dashboard.statistics.length, 2);
    assert.deepEqual(
      dashboard.free_text_questions.map((question) => [question.written, question.unwritten]),
      [[0, 1]],
    );

    const second = (await call(db, '/api/evaluate/login', { device: '4'.repeat(64) })).data.session;
    const secondInitial = (await call(db, '/api/evaluate/session', {}, second)).data;
    const secondView = (
      await call(db, '/api/evaluate/acknowledge', { notice_version: secondInitial.notice_version }, second)
    ).data;
    assert.equal(
      (
        await call(
          db,
          '/api/evaluate/submit',
          {
            epoch: secondView.epoch,
            assessment_version: secondView.assessment_version,
            answers: {
              'question-a': 1,
              'question-b': 2,
              'question-opinion': '  익명 의견  ',
            },
          },
          second,
        )
      ).status,
      200,
    );
    dashboard = (await call(db, '/api/admin/export', {}, admin)).data;
    assert.deepEqual(
      dashboard.free_text_questions.map((question) => [question.written, question.unwritten]),
      [[1, 1]],
    );
    assert.ok(dashboard.responses.some((response) => response.answers['question-opinion'] === '익명 의견'));

    const third = (await call(db, '/api/evaluate/login', { device: '5'.repeat(64) })).data.session;
    const thirdInitial = (await call(db, '/api/evaluate/session', {}, third)).data;
    const thirdView = (
      await call(db, '/api/evaluate/acknowledge', { notice_version: thirdInitial.notice_version }, third)
    ).data;
    assert.equal(
      (
        await call(
          db,
          '/api/evaluate/submit',
          {
            epoch: thirdView.epoch,
            assessment_version: thirdView.assessment_version,
            answers: {
              'question-a': 0,
              'question-b': 0,
              'question-opinion': '가'.repeat(501),
            },
          },
          third,
        )
      ).status,
      400,
    );
  } finally {
    await db.close();
  }
});
