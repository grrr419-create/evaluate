import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { StatisticsExcel } from '../public/statistics-excel.js';
import { database, call } from './helpers.mjs';
import { fixtureAdmin } from './fixtures.mjs';
async function submit(db, n, answers) {
  const session = (await call(db, '/api/evaluate/login', { device: n.toString(16).padStart(64, '0') })).data
    .session;
  const initial = (await call(db, '/api/evaluate/session', {}, session)).data;
  const view = (
    await call(db, '/api/evaluate/acknowledge', { notice_version: initial.notice_version }, session)
  ).data;
  assert.equal(
    (
      await call(
        db,
        '/api/evaluate/submit',
        { answers, epoch: view.epoch, assessment_version: view.assessment_version },
        session,
      )
    ).status,
    200,
  );
  return session;
}
async function writer() {
  return StatisticsExcel.create;
}
function unzip(bytes) {
  const result = new Map(),
    data = Buffer.from(bytes);
  let at = 0;
  while (data.readUInt32LE(at) === 0x04034b50) {
    assert.equal(data.readUInt16LE(at + 8), 0);
    const size = data.readUInt32LE(at + 18),
      nameLength = data.readUInt16LE(at + 26),
      extraLength = data.readUInt16LE(at + 28);
    const name = data.subarray(at + 30, at + 30 + nameLength).toString(),
      start = at + 30 + nameLength + extraLength;
    result.set(name, data.subarray(start, start + size).toString());
    at = start + size;
  }
  return result;
}
test('Excel includes separate anonymous answers without names or technical identifiers', async () => {
  const db = await database();
  try {
    const admin = (await call(db, '/api/admin/login', fixtureAdmin)).data.session;
    const first = await submit(db, 1, { 'question-a': 0, 'question-b': 1 });
    await submit(db, 2, { 'question-a': 1, 'question-b': 2 });
    assert.equal((await call(db, '/api/admin/export', {}, first)).status, 401);
    const exported = (await call(db, '/api/admin/export', {}, admin)).data;
    assert.equal(exported.completed, 2);
    assert.equal(exported.response_count, 2);
    assert.equal(exported.unavailable_response_count, 0);
    assert.ok(exported.responses.some((x) => x.answers['question-a'] === 0 && x.answers['question-b'] === 1));
    assert.deepEqual((await call(db, '/api/admin/export', {}, admin)).data.responses, exported.responses);
    assert.equal(
      /nickname|device|employee|response_id|timestamp|session/.test(JSON.stringify(exported)),
      false,
    );
    const makeExcel = await writer(),
      bytes = makeExcel(exported),
      files = unzip(bytes);
    assert.equal(files.get('xl/workbook.xml').match(/<sheet /g).length, 3);
    assert.match(files.get('xl/workbook.xml'), /name="문항별 통계"/);
    assert.equal(/평가 현황|개별 응답 안내/.test(files.get('xl/workbook.xml')), false);
    assert.match(files.get('xl/worksheets/sheet1.xml'), /<c r="B3" s="5"><v>2<\/v>/);
    exported.responses.forEach((r, i) => {
      const xml = files.get('xl/worksheets/sheet' + (i + 2) + '.xml');
      assert.equal(xml.match(/<row /g).length, 4);
      assert.match(xml, /<c r="A2"[^>]*><is><t[^>]*>문항<\/t>/);
      assert.match(xml, /<c r="B2"[^>]*><is><t[^>]*>선택 답변<\/t>/);
      assert.equal(/문항 번호|업무환경 심리평가 ·/.test(xml), false);
      assert.equal(/바람|SUM|닉네임/.test(xml), false);
      assert.ok(xml.includes('응답 ' + String(i + 1).padStart(3, '0')));
      exported.statistics.forEach((q) => assert.ok(xml.includes(q.options[r.answers[q.id]])));
    });
    assert.equal(/<f[ >]/.test([...files.values()].join('')), false);
    assert.throws(() => makeExcel({ ...exported, response_count: 1 }));
    assert.throws(() => makeExcel({ ...exported, completed: 0 }));
    assert.throws(() =>
      makeExcel({
        ...exported,
        responses: [{ answers: { 'question-a': 7, 'question-b': 1 } }, exported.responses[1]],
      }),
    );
    assert.throws(() =>
      makeExcel({ ...exported, responses: [exported.responses[0], exported.responses[0]] }),
    );
    const output = new URL('../.private/test-output/', import.meta.url);
    await mkdir(output, { recursive: true });
    await writeFile(new URL('anonymous-statistics.xlsx', output), bytes);
  } finally {
    await db.close();
  }
});
test('Yes/No statistics use one row per question and correctly pair counts and percentages', async () => {
  const data = {
    name: '표시하지 않을 평가 이름',
    completed: 3,
    response_count: 3,
    unavailable_response_count: 0,
    statistics: [
      { id: 'a', text: '문항 A', options: ['아니오', '예'], counts: [1, 2] },
      { id: 'b', text: '문항 B', options: ['예', '아니오'], counts: [0, 3] },
    ],
    responses: [{ answers: { a: 0, b: 1 } }, { answers: { a: 1, b: 1 } }, { answers: { a: 1, b: 1 } }],
  };
  const files = unzip((await writer())(data)),
    xml = files.get('xl/worksheets/sheet1.xml');
  const cell = (ref) => xml.match(new RegExp('<c r="' + ref + '"[^>]*>(.*?)</c>'))?.[1];
  ['문항', '참여', '예', '아니오'].forEach((label, i) =>
    assert.ok(cell(String.fromCharCode(65 + i) + '2').includes('>' + label + '</t>')),
  );
  assert.equal(cell('B3'), '<v>3</v>');
  for (const [ref, value] of [
    ['C3', '2명 (66.7%)'],
    ['D3', '1명 (33.3%)'],
    ['C4', '0명 (0%)'],
    ['D4', '3명 (100%)'],
  ])
    assert.ok(cell(ref).includes(value));
  assert.equal(xml.match(/<row /g).length, 4);
  assert.match(xml, /<pane ySplit="2" topLeftCell="A3"/);
  assert.equal(files.get('xl/workbook.xml').match(/<sheet /g).length, 4);
  assert.equal(
    [...files.values()].some((value) => value.includes(data.name)),
    false,
  );
});
