import { escapeHtml } from './views.js';
export function createConfirmation(dialog) {
  let pending = false;
  dialog.addEventListener('cancel', (event) => {
    if (pending) event.preventDefault();
  });
  return {
    get open() {
      return dialog.open;
    },
    show({ kind, title, description, label, busyLabel, onConfirm }) {
      if (dialog.open) return;
      dialog.dataset.kind = kind;
      dialog.innerHTML = `<div class="modal-content">
        ${kind === 'reset' ? '<span class="reset-icon" aria-hidden="true">↺</span>' : ''}
        <h2 id="confirmation-title">${escapeHtml(title)}</h2><p id="confirmation-description">${description}</p>
        <div class="modal-actions"><button type="button" class="secondary-button" data-cancel autofocus>취소</button><button type="button" class="${kind === 'reset' ? 'danger-solid' : 'primary-button'}" data-confirm>${escapeHtml(label)}</button></div>
        <p id="confirmation-error" role="alert"></p>
      </div>`;
      const confirm = dialog.querySelector('[data-confirm]');
      const cancel = dialog.querySelector('[data-cancel]');
      cancel.onclick = () => dialog.close();
      confirm.onclick = async () => {
        if (pending) return;
        pending = true;
        confirm.disabled = cancel.disabled = true;
        confirm.textContent = busyLabel;
        dialog.querySelector('#confirmation-error').textContent = '';
        try {
          await onConfirm();
          dialog.close();
        } catch (error) {
          dialog.querySelector('#confirmation-error').textContent = error.message;
        } finally {
          pending = false;
          confirm.disabled = cancel.disabled = false;
          confirm.textContent = label;
        }
      };
      dialog.showModal();
    },
  };
}
