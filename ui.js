(function () {
  'use strict';
  let toastTimer;
  let activeDialog = null;
  const region = document.createElement('div');
  region.className = 'cb-toast-region';
  region.setAttribute('aria-live', 'polite');
  region.setAttribute('aria-atomic', 'true');
  document.body.appendChild(region);

  function toast(message, kind = 'info') {
    clearTimeout(toastTimer);
    region.replaceChildren();
    const item = document.createElement('div');
    item.className = 'cb-toast cb-toast-' + (kind === 'error' ? 'error' : 'info');
    const symbol = document.createElement('span');
    symbol.className = 'cb-toast-icon';
    symbol.textContent = kind === 'error' ? '!' : '✓';
    const content = document.createElement('span');
    content.textContent = message;
    item.append(symbol, content);
    region.append(item);
    toastTimer = setTimeout(() => { item.classList.add('cb-toast-out'); setTimeout(() => item.remove(), 220); }, 3500);
  }

  function closeExisting() {
    if (activeDialog) activeDialog.close();
  }

  function modal({ title, message, confirmText = 'Подтвердить', cancelText = 'Отмена', inputValue = null, keyboardHelp = false }) {
    closeExisting();
    return new Promise(resolve => {
      const previousFocus = document.activeElement;
      const dialog = document.createElement('dialog');
      dialog.className = 'cb-dialog';
      dialog.setAttribute('aria-labelledby', 'cb-dialog-title');
      const icon = document.createElement('div');
      icon.className = 'cb-dialog-icon';
      if (keyboardHelp) {
        icon.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M6 9h1m3 0h1m3 0h1m3 0h1M6 12h1m3 0h1m3 0h1m3 0h1M8 16h8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
      } else {
        icon.textContent = inputValue === null ? '↺' : '↗';
      }
      const heading = document.createElement('h2');
      heading.id = 'cb-dialog-title';
      heading.textContent = title;
      const description = document.createElement('p');
      description.textContent = message;
      if (keyboardHelp) description.hidden = true;
      const shortcuts = keyboardHelp ? document.createElement('table') : null;
      if (shortcuts) {
        shortcuts.className = 'cb-shortcuts-table';
        const entries = [['Пробел', 'Старт / пауза'], ['→', 'Следующая задача'], ['R', 'Рестарт всей встречи'], ['?', 'Открыть справку'], ['Esc', 'Закрыть окно']];
        for (const [key, action] of entries) {
          const tr = document.createElement('tr');
          const th = document.createElement('th'); th.scope = 'row';
          const kbd = document.createElement('kbd'); kbd.textContent = key; th.append(kbd);
          const td = document.createElement('td'); td.textContent = action;
          tr.append(th, td); shortcuts.append(tr);
        }
      }
      const field = inputValue === null ? null : document.createElement('textarea');
      if (field) {
        field.className = 'cb-dialog-field';
        field.value = inputValue;
        field.readOnly = true;
        field.setAttribute('aria-label', 'Ссылка для копирования');
        field.rows = 3;
      }
      const actions = document.createElement('div');
      actions.className = 'cb-dialog-actions';
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'cb-dialog-cancel';
      cancel.textContent = cancelText;
      const confirm = document.createElement('button');
      confirm.type = 'button';
      confirm.className = 'cb-dialog-confirm';
      confirm.textContent = confirmText;
      if (!keyboardHelp) actions.append(cancel);
      actions.append(confirm);
      dialog.append(icon, heading, description);
      if (shortcuts) dialog.append(shortcuts);
      if (field) dialog.append(field);
      dialog.append(actions);
      document.body.append(dialog);
      activeDialog = dialog;
      let result = false;
      cancel.addEventListener('click', () => dialog.close());
      confirm.addEventListener('click', () => { result = true; dialog.close(); });
      dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
      dialog.addEventListener('close', () => {
        dialog.remove();
        if (activeDialog === dialog) activeDialog = null;
        // После справки возвращаем горячие клавиши странице, а не кнопке вызова.
        // Для остальных диалогов сохраняем стандартное восстановление фокуса.
        if (keyboardHelp) {
          if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
          if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.blur();
        } else if (previousFocus && previousFocus.isConnected) {
          previousFocus.focus();
        }
        resolve(result);
      }, { once: true });
      dialog.showModal();
      if (field) { field.focus(); field.select(); } else (keyboardHelp ? confirm : cancel).focus();
    });
  }

  window.ChronoUI = { toast, modal };
})();
