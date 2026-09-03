const TITLE = '업무환경 심리평가';
const LOGO = `<span class="logo-mark" aria-hidden="true">H</span><div class="logo-text">HANSHIN<small>${TITLE}</small></div>`;
export function escapeHtml(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character],
  );
}
export function answeredCount(view, answers) {
  return (view?.questions ?? []).filter((question) => Number.isInteger(answers[question.id])).length;
}
function button(label, action, className = 'secondary-button', disabled = false) {
  return `<button class="${className}" data-action="${action}" ${disabled ? 'disabled' : ''}>${label}</button>`;
}
function alert(state) {
  if (state.error) return `<div class="alert error" role="alert">${escapeHtml(state.error)}</div>`;
  if (state.notice) return `<div class="alert success" role="status">${escapeHtml(state.notice)}</div>`;
  return '';
}
function footer(admin = false) {
  return `<footer>HANSHIN <span>${TITLE}${admin ? ' 관리' : ''}</span></footer>`;
}

export function loginView(state, role) {
  const admin = role === 'admin';
  const fields = admin
    ? `
    <label class="login-field"><span>ID</span><input name="id" aria-label="ID" placeholder="관리자 ID" autocomplete="username" autocapitalize="none" spellcheck="false" required maxlength="80"></label>
    <label class="login-field"><span>PW</span><input name="password" aria-label="PW" type="password" placeholder="관리자 비밀번호" autocomplete="current-password" required maxlength="160"></label>`
    : '';
  return `<main class="login-shell">
    <section class="brand-panel" aria-label="HANSHIN ${TITLE}"></section>
    <section class="login-panel">
      <form class="login-form ${admin ? '' : 'participation-form'}" id="login-form">
        ${admin ? '<h1>관리자 로그인</h1>' : ''}${alert(state)}${fields}
        <button class="primary-button" type="submit" ${state.busy ? 'disabled' : ''}>${state.busy ? '접속 중…' : admin ? '로그인 →' : '평가 참여하기'}</button>
        ${admin ? '<p class="login-hint">관리자 전용 계정으로 로그인해 주세요.</p>' : ''}
      </form>${footer()}
    </section>
  </main>`;
}
function header() {
  return `<header class="topbar"><a class="brand-link" href="./index.html">${LOGO}</a><div class="topbar-right">${button('나가기', 'logout', 'text-button')}</div></header>`;
}
function questionCard(question, index, state) {
  const options = question.options
    .map(
      (option, choice) => `
    <label class="choice"><input type="radio" name="${escapeHtml(question.id)}" value="${choice}" ${state.answers[question.id] === choice ? 'checked' : ''} required><span class="radio-dot"></span><span>${escapeHtml(option)}</span></label>`,
    )
    .join('');
  return `<fieldset class="question-card" id="question-${index}" ${state.busy || state.stale ? 'disabled' : ''}>
    <legend><span class="question-number">${String(index + 1).padStart(2, '0')}</span><span>${escapeHtml(question.text.replace(/^\s*\d+[.)]\s*/, ''))}</span></legend>
    <div class="choices">${options}</div>
  </fieldset>`;
}
export function evaluationView(state) {
  const view = state.view;
  if (!view)
    return `${header()}<main class="center-page">${alert(state)}${button('다시 불러오기', 'refresh')}</main>`;
  if (view.complete)
    return `${header()}<main class="center-page">
    <div class="completion-icon" aria-hidden="true">✓</div><p class="eyebrow">ASSESSMENT COMPLETED</p>
    <h1>평가 제출이 완료되었습니다.</h1><p class="subtle">소중한 의견을 남겨주셔서 감사합니다.<br>더 나은 근무환경을 만드는 데 활용하겠습니다.</p>
    <div class="completion-note">평가는 1회 참여할 수 있습니다.</div>${button('로그아웃', 'logout', 'primary-button')}
  </main>`;
  if (!view.accepted)
    return `${header()}<main class="notice-page" aria-label="평가 안내">
    ${alert(state)}<article class="notice-card"><div class="notice-content">${escapeHtml(view.notice || '등록된 안내 문구가 없습니다.')}</div></article>
    ${button('평가 시작하기', 'acknowledge', 'primary-button', state.busy)}
  </main>`;
  const unavailable =
    state.busy || state.stale || answeredCount(view, state.answers) !== view.questions.length;
  return `${header()}<main class="survey-layout"><section><h1>${escapeHtml(view.name || TITLE)}</h1>${alert(state)}
    ${state.stale ? `<div class="alert warning" role="alert">평가 상태가 변경되었습니다. 새 평가를 불러온 후 작성해 주세요. ${button('새 평가 불러오기', 'reload-assessment')}</div>` : ''}
    <form id="survey-form">${view.questions.map((question, index) => questionCard(question, index, state)).join('')}
      <div class="submit-area"><button class="primary-button" type="submit" id="submit-assessment" ${unavailable ? 'disabled' : ''}>${state.busy ? '제출 중…' : '제출하기'}</button></div>
    </form>
  </section></main>`;
}
function statistics(data) {
  if (!data.completed)
    return '<div class="empty-results"><h3>아직 제출된 평가가 없습니다.</h3><p>평가가 제출되면 문항별 통계를 확인할 수 있습니다.</p></div>';
  return `<div class="results-list">${data.statistics
    .map((question, index) => {
      const answered = Number.isInteger(question.answered) ? question.answered : data.completed;
      return `<article class="result-question">
    <h3><span>${String(index + 1).padStart(2, '0')}</span>${escapeHtml(question.text.replace(/^\s*\d+[.)]\s*/, ''))}</h3>
    <div class="stacked-bar" aria-hidden="true">${question.counts.map((count, choice) => `<span class="bar-color-${choice % 5}" style="width:${answered ? (count / answered) * 100 : 0}%"></span>`).join('')}</div>
    <div class="result-options">${question.options.map((option, choice) => `<span><i class="bar-color-${choice % 5}"></i>${escapeHtml(option)} <strong>${question.counts[choice]}명</strong> <em>${(answered ? (question.counts[choice] / answered) * 100 : 0).toFixed(1)}%</em></span>`).join('')}</div>
  </article>`;
    })
    .join('')}</div>`;
}
export function adminView(state) {
  const data = state.data;
  return `<div class="admin-layout"><div class="admin-main">
    <header class="admin-topbar"><span>${TITLE} <b>관리자</b></span><div><span class="live-dot"></span><small>자동 갱신</small>${button('로그아웃', 'logout', 'text-button')}</div></header>
    <main class="dashboard">
      <div class="dashboard-heading"><h1>평가 현황</h1><div class="dashboard-actions">${button('↻ 새로고침', 'refresh')}${button('결과 초기화', 'reset-open', 'danger-button')}</div></div>
      ${alert(state)}${
        data
          ? `<section class="round-summary" aria-label="현재 평가">
        <div><span>현재 평가</span><h2>${escapeHtml(data.name)}</h2><p>마지막 초기화 이후 제출된 평가를 집계합니다.</p></div>
        <div class="submitted-count"><span>참여 완료</span><strong>${data.completed}<small>명</small></strong></div>
      </section><section class="panel" id="statistics"><div class="section-heading"><h2>문항별 응답 통계</h2>${button(state.exporting ? '엑셀 생성 중…' : '↓ 통계·개별 응답 엑셀 다운로드', 'export-results', 'secondary-button', !data.completed || state.exporting)}</div>${statistics(data)}</section>`
          : ''
      }
      ${footer(true)}
    </main>
  </div></div>`;
}
