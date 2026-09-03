import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loginView, evaluationView, answeredCount } from '../public/views.js';

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
