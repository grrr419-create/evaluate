export const fixture = {
  mode: 'device',
  revision: 'fixture-v2',
  survey_version: 'fixture-survey',
  notice_version: 'fixture-notice',
  notice: '검증용 안내입니다.',
  questions: [
    { id: 'question-a', text: '검증용 문항 A', options: ['예', '아니오'] },
    { id: 'question-b', text: '검증용 문항 B', options: ['동의', '보통', '비동의'] },
  ],
};
export const fixtureAdmin = { id: 'fixture-admin', password: 'fixture-admin-only' };
