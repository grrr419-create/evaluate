import { createApi } from './api.js?v=2.3.1';
import { loginView, evaluationView, adminView, answeredCount } from './views.js?v=2.3.1';
import { createConfirmation } from './confirmation.js?v=2.3.1';

const root = document.getElementById('app');
const role = document.documentElement.dataset.role || 'evaluate';
const api = createApi();
const confirmation = createConfirmation(document.getElementById('confirmation-dialog'));
const state = {
  view: null,
  data: null,
  logged: false,
  answers: {},
  error: '',
  notice: '',
  busy: false,
  stale: false,
  exporting: false,
};
const route = (action) => `/api/${role}/${action}`;

function render() {
  document.title =
    role === 'admin'
      ? state.logged
        ? '관리자 | 업무환경 심리평가'
        : '관리자 로그인 | HANSHIN'
      : '업무환경 심리평가 | HANSHIN';
  root.innerHTML = !state.logged
    ? loginView(state, role)
    : role === 'admin'
      ? adminView(state)
      : evaluationView(state);
}

function fail(error, { stale = false } = {}) {
  state.error = error.message;
  if (error.status === 401) {
    state.logged = false;
    state.answers = {};
  } else if (stale) state.stale = true;
}

async function load({ poll = false } = {}) {
  try {
    const next = await api.request(route(role === 'admin' ? 'dashboard' : 'session'));
    if (role === 'admin') {
      if (poll && !state.error && JSON.stringify(next) === JSON.stringify(state.data)) return;
      state.data = next;
    } else {
      const old = state.view;
      const changed = old && (old.epoch !== next.epoch || old.assessment_version !== next.assessment_version);
      if (poll && changed && Object.keys(state.answers).length) {
        state.stale = true;
        render();
        return;
      }
      if (poll && !state.error && JSON.stringify(next) === JSON.stringify(old)) return;
      if (changed || next.complete) state.answers = {};
      state.view = next;
      state.stale = false;
    }
    state.logged = true;
    state.error = '';
  } catch (error) {
    if (error.status === 401 && !state.logged) state.error = '';
    else fail(error, { stale: poll && role === 'evaluate' });
    if (error.status !== 401) {
      state.logged = true;
      state.data = null;
    }
  }
  render();
}

async function login(form) {
  if (state.busy) return;
  const data = new FormData(form);
  const id = String(data.get('id') || '').trim();
  state.busy = true;
  render();
  try {
    await api.request(route('login'), role === 'admin' ? { id, password: String(data.get('password')) } : {});
    state.logged = true;
    state.answers = {};
    state.error = '';
    state.stale = false;
    await load();
  } catch (error) {
    fail(error);
    state.logged = false;
  } finally {
    state.busy = false;
    render();
    const input = root.querySelector('[name=id]');
    if (input) input.value = id;
  }
}

function canSubmit(view = state.view) {
  return (
    state.logged &&
    !state.busy &&
    !state.stale &&
    view?.accepted &&
    !view.complete &&
    answeredCount(view, state.answers) === view.questions.length
  );
}

function confirmSubmission() {
  const view = state.view;
  if (!canSubmit(view)) return;
  confirmation.show({
    kind: 'submit',
    title: '평가를 제출하시겠습니까?',
    description: '제출 후에는 답변을 변경할 수 없습니다.',
    label: '제출하기',
    busyLabel: '제출 중…',
    async onConfirm() {
      if (
        !canSubmit() ||
        state.view.epoch !== view.epoch ||
        state.view.assessment_version !== view.assessment_version
      )
        return;
      state.busy = true;
      render();
      try {
        await api.request('/api/evaluate/submit', {
          answers: state.answers,
          assessment_version: view.assessment_version,
          epoch: view.epoch,
        });
        state.answers = {};
        await load();
        window.scrollTo(0, 0);
      } catch (error) {
        fail(error, { stale: error.status === 409 });
        throw error;
      } finally {
        state.busy = false;
        render();
      }
    },
  });
}

async function confirmReset() {
  const preview = await api.request('/api/admin/reset-preview');
  confirmation.show({
    kind: 'reset',
    title: '정말로 초기화 하시겠습니까?',
    description: '현재 평가의 답변과 참여 기록이 삭제됩니다.<br>필요한 결과는 먼저 엑셀로 내려받아 주세요.',
    label: '결과 초기화',
    busyLabel: '초기화 중…',
    async onConfirm() {
      await api.request('/api/admin/reset', {
        token: preview.token,
        confirmation: '정말로 초기화 하시겠습니까?',
      });
      state.notice = '초기화되었습니다. 새 평가에 참여할 수 있습니다.';
      await load();
    },
  });
}

async function download() {
  if (state.exporting) return;
  state.exporting = true;
  state.error = state.notice = '';
  render();
  try {
    const [{ StatisticsExcel }, data] = await Promise.all([
      import('./statistics-excel.js?v=2.3.1'),
      api.request('/api/admin/export', {}),
    ]);
    const blob = new Blob([StatisticsExcel.create(data)], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `업무환경_심리평가_${data.name.replace(/[\\/:*?"<>|]/g, '_')}.xlsx`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    state.notice =
      `통계와 개별 응답 ${data.response_count}건을 내려받았습니다.` +
      (data.unavailable_response_count
        ? ` 기존 제출 ${data.unavailable_response_count}건은 개별 답변이 보관되어 있지 않아 취합 통계에만 포함됩니다.`
        : '');
  } catch (error) {
    fail(error);
  } finally {
    state.exporting = false;
    render();
  }
}

const actions = {
  async logout() {
    await api.request(route('logout'), {});
    Object.assign(state, {
      logged: false,
      view: null,
      data: null,
      answers: {},
      error: '',
      notice: '',
      stale: false,
    });
    render();
  },
  refresh: () => load(),
  async 'reload-assessment'() {
    state.answers = {};
    state.stale = false;
    await load();
    window.scrollTo(0, 0);
  },
  async acknowledge() {
    state.busy = true;
    state.error = '';
    render();
    try {
      state.view = await api.request('/api/evaluate/acknowledge', {
        notice_version: state.view.notice_version,
      });
      window.scrollTo(0, 0);
    } finally {
      state.busy = false;
      render();
    }
  },
  'reset-open': confirmReset,
  'export-results': download,
};

root.addEventListener('submit', (event) => {
  event.preventDefault();
  const formId = event.target.getAttribute('id');
  if (formId === 'login-form') void login(event.target);
  if (formId === 'survey-form') confirmSubmission();
});
root.addEventListener('change', (event) => {
  if (event.target.type !== 'radio' || !state.view || state.busy || state.stale) return;
  state.answers[event.target.name] = Number(event.target.value);
  root.querySelector('#submit-assessment').disabled = !canSubmit();
});
root.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled || state.busy) return;
  try {
    await actions[button.dataset.action]?.();
  } catch (error) {
    fail(error);
    render();
  }
});
window.addEventListener('beforeunload', (event) => {
  if (role === 'evaluate' && Object.keys(state.answers).length && !state.view?.complete) {
    event.preventDefault();
    event.returnValue = '';
  }
});

try {
  await api.init(role);
  await load();
} catch (error) {
  state.error = error.message;
  render();
}
setInterval(() => {
  if (!document.hidden && state.logged && !state.busy && !state.exporting && !confirmation.open)
    void load({ poll: true });
}, 30000);
