export const ASSESSMENT_CRITERIA = [
  {
    key: 'good',
    label: '양호(우수)',
    sheetLabel: '양호',
    criterion: '12개 이상',
    titleCriterion: "'예' 응답 12개 이상",
    minimum: 12,
    state: '조직 내 심리적 안정감이 매우 높게 형성되어 있는 상태입니다.',
    description:
      '구성원들이 눈치를 보지 않고 자유롭게 문제를 제기하거나 의견을 내며, 서로의 역량을 존중하고 도움을 주고받는 이상적인 업무 환경입니다.',
  },
  {
    key: 'normal',
    label: '보통',
    sheetLabel: '보통',
    criterion: '9개~11개',
    titleCriterion: "'예' 응답 9개~11개",
    minimum: 9,
    state:
      '일반적이고 무난한 수준이나, 특정 영역에서 구성원들이 심리적 부담을 느끼고 있어 개선의 여지가 있는 상태입니다.',
    description:
      "기본적인 업무 소통은 이루어지고 있으나, '아니오'로 응답한 항목에 해당하는 부분에서 조직 내 보이지 않는 장벽이 존재할 수 있습니다.",
  },
  {
    key: 'poor',
    label: '미흡',
    sheetLabel: '미흡',
    criterion: '0개~8개',
    titleCriterion: "'예' 응답 0개~8개",
    minimum: 0,
    state: '심리적 안정감이 결여되어 있어 업무 환경 전반에 대한 즉각적이고 시급한 개선이 필요한 상태입니다.',
    description:
      '구성원들이 침묵하는 것을 최선이라 여기며, 동료의 노력에 흠집을 내려는 분위기가 있거나 자신의 역량을 인정받지 못한다고 느낄 가능성이 큽니다.',
  },
];

export function assessmentGrade(yesCount) {
  if (!Number.isFinite(yesCount) || yesCount < 0) return null;
  return ASSESSMENT_CRITERIA.find((grade) => yesCount >= grade.minimum) ?? null;
}

export function assessmentSummary(data) {
  if (!Number.isInteger(data?.completed) || data.completed < 1) return null;
  if (!Array.isArray(data.statistics) || !data.statistics.length || !Array.isArray(data.responses))
    return null;
  if (data.responses.length !== data.completed) return null;

  const scores = [];
  for (const response of data.responses) {
    if (!response?.answers || typeof response.answers !== 'object') return null;
    let yes = 0;
    for (const question of data.statistics) {
      const yesIndex = question.options?.indexOf('예');
      const answer = response.answers[question.id];
      if (yesIndex < 0 || !Number.isInteger(answer)) return null;
      if (answer === yesIndex) yes++;
    }
    scores.push(yes);
  }

  const totalYes = scores.reduce((sum, score) => sum + score, 0);
  const average = totalYes / scores.length;
  const distribution = Object.fromEntries(ASSESSMENT_CRITERIA.map((grade) => [grade.key, 0]));
  for (const score of scores) distribution[assessmentGrade(score).key]++;
  return { average, grade: assessmentGrade(average), distribution, scores };
}
