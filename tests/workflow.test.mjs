import { test } from 'node:test';
import assert from 'node:assert/strict';
import { database, call, handler } from './helpers.mjs';
import { fixture, fixtureAdmin } from './fixtures.mjs';
const device = (n) => n.toString(16).padStart(64, '0');
async function admit(db, n = 1) {
  const r = await call(db, '/api/evaluate/login', { device: device(n) });
  assert.equal(r.status, 200, JSON.stringify(r));
  return r.data.session;
}
async function accepted(db, session) {
  const view = (await call(db, '/api/evaluate/session', {}, session)).data;
  const r = await call(db, '/api/evaluate/acknowledge', { notice_version: view.notice_version }, session);
  assert.equal(r.status, 200);
  return r.data;
}
test('button-only admission, same-IP colleagues, atomic submissions and reset epochs', async () => {
  const db = await database();
  try {
    const admin = (await call(db, '/api/admin/login', fixtureAdmin)).data.session;
    assert.equal((await call(db, '/api/admin/export', {}, admin)).status, 403);
    assert.equal((await call(db, '/api/evaluate/login', { id: 'TEST-A1', password: 'TEST-A1' })).status, 400);
    assert.equal((await call(db, '/api/evaluate/login', { device: 'bad' })).status, 400);
    const first = await admit(db);
    assert.equal((await call(db, '/api/admin/dashboard', {}, first)).status, 401);
    assert.equal((await call(db, '/api/evaluate/session', {}, admin)).status, 401);
    assert.equal((await call(db, '/api/admin/dashboard', {}, admin)).data.completed, 0);
    const resumed = await admit(db);
    assert.equal((await call(db, '/api/evaluate/session', {}, first)).status, 401);
    assert.equal((await call(db, '/api/evaluate/submit', {}, resumed)).status, 409);
    const view = await accepted(db, resumed);
    assert.equal('nickname' in view, false);
    assert.equal((await db.query('select count(*)::int n from evaluate_private.admissions')).rows[0].n, 1);
    const body = {
      assessment_version: view.assessment_version,
      epoch: view.epoch,
      answers: { 'question-a': 0, 'question-b': 1 },
    };
    for (const answers of [
      {},
      { ...body.answers, extra: 1 },
      { 'question-a': true, 'question-b': 1 },
      { 'question-a': 0.5, 'question-b': 1 },
      { 'question-a': 2, 'question-b': 1 },
    ])
      assert.equal((await call(db, '/api/evaluate/submit', { ...body, answers }, resumed)).status, 400);
    const duplicate = await Promise.all([
      call(db, '/api/evaluate/submit', body, resumed),
      call(db, '/api/evaluate/submit', body, resumed),
    ]);
    assert.deepEqual(duplicate.map((r) => r.status).sort(), [200, 409]);
    const second = await admit(db, 2);
    await accepted(db, second);
    assert.equal(
      (
        await call(
          db,
          '/api/evaluate/submit',
          { ...body, answers: { 'question-a': 1, 'question-b': 2 } },
          second,
        )
      ).status,
      200,
    );
    const dashboard = (await call(db, '/api/admin/dashboard', {}, admin)).data;
    assert.equal(dashboard.completed, 2);
    assert.deepEqual(
      dashboard.statistics.map((q) => q.counts),
      [
        [1, 1],
        [0, 1, 1],
      ],
    );
    assert.equal(
      /participants|departments|people|nickname|pending|total/.test(JSON.stringify(dashboard)),
      false,
    );
    const completeSession = resumed;
    const blocked = await call(db, '/api/evaluate/login', { device: device(1) });
    assert.equal(blocked.status, 409);
    assert.equal(blocked.data.error, '평가는 1회 참여할 수 있습니다.');
    assert.equal(duplicate.find((r) => r.status === 409).data.error, blocked.data.error);
    assert.equal((await call(db, '/api/evaluate/session', {}, completeSession)).data.complete, true);
    await accepted(db, completeSession);
    assert.equal((await call(db, '/api/evaluate/submit', body, completeSession)).status, 409);
    const nonce = (await call(db, '/api/admin/reset-preview', {}, admin)).data.token;
    assert.equal(
      (await call(db, '/api/admin/reset', { token: nonce, confirmation: 'wrong' }, admin)).status,
      400,
    );
    assert.equal(
      (
        await call(
          db,
          '/api/admin/reset',
          { token: nonce, confirmation: '정말로 초기화 하시겠습니까?' },
          admin,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await call(
          db,
          '/api/admin/reset',
          { token: nonce, confirmation: '정말로 초기화 하시겠습니까?' },
          admin,
        )
      ).status,
      400,
    );
    assert.equal((await call(db, '/api/evaluate/session', {}, completeSession)).status, 401);
    const cleared = (await call(db, '/api/admin/dashboard', {}, admin)).data;
    assert.equal(cleared.completed, 0);
    assert.equal(cleared.name, '업무환경 심리평가');
    assert.notEqual(cleared.epoch, view.epoch);
    for (const table of ['admissions', 'round_responses', 'legacy_counts'])
      assert.equal((await db.query('select count(*)::int n from evaluate_private.' + table)).rows[0].n, 0);
    const next = await admit(db);
    const nextView = await accepted(db, next);
    assert.equal((await call(db, '/api/evaluate/submit', body, next)).status, 409);
    assert.equal(
      (await call(db, '/api/evaluate/submit', { ...body, epoch: nextView.epoch }, next)).status,
      200,
    );
    assert.equal((await call(db, '/api/admin/dashboard', {}, admin)).data.completed, 1);
  } finally {
    await db.close();
  }
});
test('public roles cannot read answers; limits expire and allow shared-IP colleagues', async () => {
  const db = await database();
  try {
    for (const role of ['anon', 'authenticated']) {
      await db.exec('set role ' + role);
      for (const table of ['settings', 'round_responses', 'admissions'])
        await assert.rejects(db.query('select * from evaluate_private.' + table), /permission denied/);
      await assert.rejects(
        db.query("select public.evaluate_api('/api/admin/dashboard')"),
        /permission denied/,
      );
      await db.exec('reset role');
    }
    for (let n = 1; n <= 35; n++) await admit(db, n);
    for (let n = 0; n < 15; n++)
      assert.equal(
        (await call(db, '/api/admin/login', { id: fixtureAdmin.id, password: 'wrong' }, '', String(n)))
          .status,
        401,
      );
    assert.equal((await call(db, '/api/admin/login', fixtureAdmin, '', 'another-ip')).status, 429);
    await db.exec("update evaluate_private.login_limits set window_start=now()-interval '16 minutes'");
    const admin = (await call(db, '/api/admin/login', fixtureAdmin)).data.session;
    await db.exec("update evaluate_private.sessions set expires_at=now()-interval '1 second'");
    assert.equal((await call(db, '/api/admin/dashboard', {}, admin)).status, 401);
    await admit(db, 1);
    await assert.rejects(
      db.query('select evaluate_private.install($1::jsonb,$2,$3)', [
        JSON.stringify({ ...fixture, revision: 'changed' }),
        fixtureAdmin.id,
        fixtureAdmin.password,
      ]),
      /already exists/,
    );
  } finally {
    await db.close();
  }
});
test('Edge gateway checks origins, size, routes and private role authentication', async () => {
  const db = await database();
  try {
    const createHandler = await handler();
    let calls = 0;
    const handle = createHandler(
      {
        ALLOWED_ORIGINS: 'https://example.github.io',
        SUPABASE_URL: 'https://project.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'fixture-only',
      },
      async (url, opts) => {
        calls++;
        assert.equal(url, 'https://project.supabase.co/rest/v1/rpc/evaluate_api');
        const input = JSON.parse(opts.body);
        return Response.json(await call(db, input.p_route, input.p_body, input.p_session, input.p_client));
      },
    );
    const request = (input, origin = 'https://example.github.io') =>
      new Request('https://project.supabase.co/functions/v1/evaluate', {
        method: 'POST',
        headers: { Origin: origin, 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
    assert.equal(
      (
        await handle(
          request({ route: '/api/admin/dashboard', session: '', body: {} }, 'https://attacker.example'),
        )
      ).status,
      403,
    );
    assert.equal(calls, 0);
    assert.equal(
      (await handle(request({ route: '/api/admin/dashboard', session: '', body: {} }))).status,
      401,
    );
    assert.equal(
      (await handle(request({ route: '/api/admin/login', session: '', body: fixtureAdmin }))).status,
      200,
    );
    assert.equal(
      (await handle(request({ route: '/api/admin/login', session: '', body: { value: 'x'.repeat(65536) } })))
        .status,
      413,
    );
    assert.equal((await handle(request({ route: '/api/admin/upload', session: '', body: {} }))).status, 400);
  } finally {
    await db.close();
  }
});
