(() => {
  'use strict';
  const key = 'chronoblock:theme';
  const allowed = ['original', 'ocean', 'emerald', 'sunset', 'light-violet', 'light-ocean', 'light-emerald', 'light-sunset'];
  const menu = document.getElementById('themeMenu');
  const trigger = document.getElementById('themeMenuBtn');
  const panel = document.getElementById('themeMenuPanel');
  function closeMenu() {
    panel.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
  }
  trigger.addEventListener('click', () => {
    const opening = !panel.hidden;
    panel.hidden = opening;
    trigger.setAttribute('aria-expanded', String(!opening));
  });
  document.addEventListener('pointerdown', (event) => {
    if (!menu.contains(event.target)) closeMenu();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !panel.hidden) { closeMenu(); trigger.focus(); }
  });
  const buttons = Array.from(document.querySelectorAll('[data-theme-choice]'));
  function update(theme) {
    const next = allowed.includes(theme) ? theme : 'original';
    if (next === 'original') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = next;
    buttons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.themeChoice === next)));
  }
  let initial = 'original';
  try { initial = localStorage.getItem(key) || 'original'; } catch (_) {}
  update(initial);
  buttons.forEach(button => button.addEventListener('click', () => {
    const theme = button.dataset.themeChoice;
    const previous = document.documentElement.dataset.theme || 'original';
    if (theme === previous) return;
    update(theme);
    try { localStorage.setItem(key, theme); } catch (_) {}
    window.ChronoAnalytics?.goal('theme_change', { theme });
  }));
})();
