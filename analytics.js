/* Яндекс Метрика: счётчик загружается только после согласия. */
(function () {
  'use strict';
  const ID = 114508897;
  const KEY = 'chronoblock:analytics-consent:v1';
  const banner = document.getElementById('analyticsConsent');
  const accept = document.getElementById('analyticsAccept');
  const decline = document.getElementById('analyticsDecline');
  let enabled = false;
  const pending = [];
  const validGoals = new Set(['meeting_start','meeting_pause','meeting_resume','meeting_complete','meeting_restart','block_skip','block_add','block_delete','config_import','config_export','config_reset','share_create']);
  function send(name, params) {
    if (!enabled || !validGoals.has(name)) return;
    const safe = {};
    for (const key of ['duration_seconds','planned_seconds','blocks_count']) {
      if (Number.isFinite(params?.[key])) safe[key] = Math.max(0, Math.min(86400, Math.round(params[key])));
    }
    if (typeof window.ym === 'function') window.ym(ID, 'reachGoal', name, safe);
  }
  window.ChronoAnalytics = { goal: send };
  function activate() {
    if (enabled) return;
    enabled = true;
    // Яндекс Метрика: отложенный просмотр, без записи экрана и кликов.
    (function(m,e,t,r,i,k,a){
      m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};
      m[i].l=Date.now();
      k=e.createElement(t);a=e.getElementsByTagName(t)[0];k.async=1;k.src=r;a.parentNode.insertBefore(k,a);
    })(window,document,'script','https://mc.yandex.ru/metrika/tag.js','ym');
    window.ym(ID, 'init', { defer: true, clickmap: false, trackLinks: false, accurateTrackBounce: false, webvisor: false });
    // URL без query и hash: конфигурации по ссылке не передаются в Метрику.
    window.ym(ID, 'hit', window.location.origin + window.location.pathname, { title: 'Хроноблок' });
  }
  let consent = null;
  try { consent = localStorage.getItem(KEY); } catch (_) {}
  if (consent === 'yes') activate();
  else if (consent !== 'no' && banner) banner.hidden = false;
  if (accept) accept.addEventListener('click', () => {
    try { localStorage.setItem(KEY, 'yes'); } catch (_) {}
    banner.hidden = true;
    activate();
  });
  if (decline) decline.addEventListener('click', () => {
    try { localStorage.setItem(KEY, 'no'); } catch (_) {}
    banner.hidden = true;
  });
})();
