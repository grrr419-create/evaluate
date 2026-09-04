import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loginView, evaluationView, adminView, answeredCount } from '../public/views.js';

test('participation has no identity fields, while admin still has its credential fields', () => {
  const state = { error: '', notice: '', busy: false };
  assert.equal(/<input/.test(loginView(state, 'evaluate')), false);
  assert.match(loginView(state, 'evaluate'), /평가 참여하기/);
  assert.equal((loginView(state, 'admin').match(/<input/g) || []).length, 2);
});

test('survey rendering escapes source text and disables incomplete or stale submissions', () => {
  const view = {
    accepted: true,
    complete: false,
    name: '평가',
    questions: [{ id: 'a', text: '<script>alert(1)</script>', options: ['<img src=x>', '아니오'] }],
  };
  const state = { view, answers: {}, error: '', notice: '', busy: false, stale: false };
  const empty = evaluationView(state);
  assert.equal(/<script>|<img src=x>/.test(empty), false);
  assert.match(empty, /&lt;script&gt;/);
  assert.match(empty, /id="submit-assessment" disabled/);
  state.answers = { a: 0, unknown: 1 };
  assert.equal(answeredCount(view, state.answers), 1);
  assert.doesNotMatch(evaluationView(state), /id="submit-assessment" disabled/);
  state.stale = true;
  assert.match(evaluationView(state), /id="submit-assessment" disabled/);
});

test('admin places criteria between the current round and the overall assessment', () => {
  const questions = Array.from({ length: 14 }, (_, index) => ({
    id: `q${index + 1}`,
    text: `문항 ${index + 1}`,
    options: ['예', '아니오'],
    counts: [0, 0],
    answered: 5,
  }));
  const scores = [13, 12, 10, 9, 7];
  const responses = scores.map((score) => ({
    answers: Object.fromEntries(questions.map((question, index) => [question.id, index < score ? 0 : 1])),
  }));
  questions.forEach((question) => {
    question.counts[0] = responses.filter((response) => response.answers[question.id] === 0).length;
    question.counts[1] = 5 - question.counts[0];
  });
  const html = adminView({
    data: { name: '업무환경 심리평가', completed: 5, statistics: questions, responses },
    error: '',
    notice: '',
    exporting: false,
  });
  const current = html.indexOf('현재 평가'),
    criteria = html.indexOf('평가 기준'),
    overall = html.indexOf('현장 종합평가');
  assert.ok(current < criteria && criteria < overall);
  assert.match(html, /12개 이상/);
  assert.match(html, /9개~11개/);
  assert.match(html, /0개~8개/);
  assert.match(html, /10\.2<small>개 \/ 14개/);
  assert.match(html, /2명 <small>\(40%\)/);
});
