(function () {
  'use strict';

  const RING_CIRCUMFERENCE = 2 * Math.PI * 95;
  const LEGACY_STORAGE_KEY = 'timeblocks_state_v3';
  const DEFAULT_STORAGE_KEY = 'chronoblock:default';
  let storageKey = DEFAULT_STORAGE_KEY;
  let initialConfig = null;

  const ICONS = {
    play:  '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>',
    pause: '<svg viewBox="0 0 24 24"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>',
  };

  // ---- Состояние ----
  let activeBlocks = [];
  let completedBlocks = [];
  let settings = { overtimeSeconds: 30 };
  let nextId = 1;

  let remainingSec = 0;
  let overtimeRemainingSec = 0;
  let isOvertime = false;
  let timerId = null;
  let isPaused = false;
  let isRunning = false;
  let wasStarted = false;         // NEW: была ли сессия запущена
  let draggedIndex = -1;
  let meetingElapsedSec = 0;
  let meetingPlannedSec = 0;
  let lastTickAt = null;
  let currentBtnState = null;     // кеш состояния кнопки-переключателя

  const justCompletedIds = new Set();
  let lastDisplayedTask = null;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  // ---- DOM ----
  const $ = (id) => document.getElementById(id);
  const blocksListEl = $('blocksList');
  const blockNameInput = $('blockName');
  const blockDurationInput = $('blockDuration');
  const addBtn = $('addBtn');
  const overtimeInput = $('overtimeInput');
  const exportBtn = $('exportBtn');
  const importBtn = $('importBtn');
  const importFile = $('importFile');
  const shareBtn = $('shareBtn');
  const clearBtn = $('clearBtn');
  const keyboardHelpBtn = $('keyboardHelpBtn');
  const meetingProgressFill = $('meetingProgressFill');
  const meetingProgressTrack = $('meetingProgressTrack');
  const meetingProgressPercent = $('meetingProgressPercent');
  const meetingElapsed = $('meetingElapsed');
  const meetingPlanned = $('meetingPlanned');
  const startBtn = $('startBtn');
  const skipBtn = $('skipBtn');
  const resetBtn = $('resetBtn');
  const currentBlockNameEl = $('currentBlockName');
  const timerDisplayEl = $('timerDisplay');
  const timerRingEl = $('timerRing');
  const timerCircleEl = document.querySelector('.timer-circle');

  const required = {
    blocksListEl, blockNameInput, blockDurationInput, addBtn,
    startBtn, skipBtn, resetBtn,
    currentBlockNameEl, timerDisplayEl, timerRingEl, timerCircleEl,
  };
  for (const [name, el] of Object.entries(required)) {
    if (!el) { console.error(`[chronoblock] Не найден DOM: ${name}`); return; }
  }

  // ---- Фабрика / нормализация ----
  function makeBlock(name, durationMin) {
    return { id: nextId++, name, durationMin, durationSec: durationMin * 60 };
  }
  function normalizeBlocks(arr) {
    if (!Array.isArray(arr)) return [];
    return arr
      .filter(b => b && typeof b.name === 'string' && Number.isFinite(b.durationMin))
      .map(b => {
        const m = Math.max(1, Math.round(b.durationMin));
        const id = Number.isFinite(b.id) ? b.id : nextId++;
        if (id >= nextId) nextId = id + 1;
        return { id, name: b.name, durationMin: m, durationSec: m * 60 };
      });
  }

  // ---- Storage ----
  function saveState() {
    try {
      localStorage.setItem(storageKey, JSON.stringify({
        activeBlocks, completedBlocks, settings, nextId, wasStarted,
        meetingElapsedSec, meetingPlannedSec, remainingSec,
        overtimeRemainingSec, isOvertime,
      }));
    } catch (_) {}
  }
  function loadState() {
    let loaded = false;
    try {
      // Миграция прежнего состояния только для обычной страницы.
      if (storageKey === DEFAULT_STORAGE_KEY &&
          localStorage.getItem(DEFAULT_STORAGE_KEY) === null) {
        const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
        if (legacy !== null) localStorage.setItem(DEFAULT_STORAGE_KEY, legacy);
      }
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.activeBlocks)) {
          activeBlocks = normalizeBlocks(parsed.activeBlocks);
          completedBlocks = normalizeBlocks(parsed.completedBlocks || []);
          loaded = true;
        } else if (parsed && Array.isArray(parsed.blocks)) {
          activeBlocks = normalizeBlocks(parsed.blocks);
          completedBlocks = [];
          loaded = true;
        }
        if (parsed && parsed.settings && Number.isFinite(parsed.settings.overtimeSeconds)) {
          settings.overtimeSeconds = Math.max(0, Math.round(parsed.settings.overtimeSeconds));
        }
        if (parsed && Number.isFinite(parsed.nextId) && parsed.nextId > nextId) {
          nextId = parsed.nextId;
        }
        if (parsed && typeof parsed.wasStarted === 'boolean') {
          wasStarted = parsed.wasStarted;
        }
        if (loaded) {
          if (Number.isFinite(parsed.meetingElapsedSec)) meetingElapsedSec = Math.max(0, parsed.meetingElapsedSec);
          if (Number.isFinite(parsed.meetingPlannedSec)) meetingPlannedSec = Math.max(0, parsed.meetingPlannedSec);
          if (wasStarted && Number.isFinite(parsed.remainingSec)) remainingSec = Math.max(0, parsed.remainingSec);
          if (wasStarted && Number.isFinite(parsed.overtimeRemainingSec)) overtimeRemainingSec = Math.max(0, parsed.overtimeRemainingSec);
          if (wasStarted) isOvertime = Boolean(parsed.isOvertime);
        }
      }
    } catch (_) {}
    if (!loaded) {
      const opts = initialConfig || window.APP_OPTIONS || null;
      if (opts) {
        if (opts.settings && Number.isFinite(opts.settings.overtimeSeconds)) {
          settings.overtimeSeconds = Math.max(0, Math.round(opts.settings.overtimeSeconds));
        }
        activeBlocks = normalizeBlocks(opts.blocks);
        completedBlocks = [];
      }
    }
    if (overtimeInput) overtimeInput.value = settings.overtimeSeconds;
  }

  // ---- Утилиты ----
  function formatTime(sec) {
    const s = Math.max(0, Math.floor(Math.abs(sec)));
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }

  function updateMeetingProgress() {
    if (!meetingProgressFill) return;
    const planned = meetingPlannedSec || [...activeBlocks, ...completedBlocks].reduce((sum, block) => sum + block.durationSec, 0);
    const elapsed = Math.max(0, meetingElapsedSec);
    const percent = planned > 0 ? Math.min(100, Math.floor(elapsed / planned * 100)) : 0;
    meetingProgressFill.style.width = `${percent}%`;
    if (meetingProgressPercent) meetingProgressPercent.textContent = `${percent}%`;
    meetingProgressTrack.setAttribute('aria-valuenow', String(percent));
    meetingElapsed.textContent = formatTime(elapsed);
    meetingPlanned.textContent = formatTime(planned);
  }

  // ---- Рендер списка ----
  function createBlockItem(block, idx, type) {
    const item = document.createElement('div');
    item.className = 'block-item';
    item.dataset.blockId = String(block.id);

    const nameSpan = document.createElement('span');
    nameSpan.className = 'name';
    nameSpan.textContent = block.name;

    const durSpan = document.createElement('span');
    durSpan.className = 'duration';
    durSpan.textContent = `${block.durationMin} мин`;

    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-btn';
    removeBtn.textContent = '✕';
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (isRunning) return;
      if (type === 'active') removeActiveBlock(idx);
      else removeCompletedBlock(idx);
    });

    item.append(nameSpan, durSpan, removeBtn);

    if (type === 'active') {
      item.addEventListener('click', () => switchToActiveBlock(idx));
      item.dataset.idx = idx;
      item.draggable = true;
      item.addEventListener('dragstart', onDragStart);
      item.addEventListener('dragend', onDragEnd);
      item.addEventListener('dragover', onDragOver);
      item.addEventListener('dragleave', onDragLeave);
      item.addEventListener('drop', onDrop);
    } else {
      item.classList.add('done');
    }

    return item;
  }

  function renderBlocks(newBlockRef = null, animateCompletion = false) {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const previous = new Map();
    if (animateCompletion && !reduceMotion) {
      for (const element of blocksListEl.children) {
        previous.set(element.dataset.blockId, element.getBoundingClientRect());
      }
    }
    blocksListEl.innerHTML = '';

    activeBlocks.forEach((block) => {
      const item = createBlockItem(block, activeBlocks.indexOf(block), 'active');
      if (block === newBlockRef) {
        item.classList.add('just-added');
        item.addEventListener('animationend',
          () => item.classList.remove('just-added'), { once: true });
      }
      blocksListEl.appendChild(item);
    });

    completedBlocks.forEach((block, idx) => {
      const item = createBlockItem(block, idx, 'completed');
      if (justCompletedIds.has(block.id)) {
        const id = block.id;
        if (!animateCompletion || reduceMotion) item.classList.add('just-completed');
        if (!animateCompletion || reduceMotion) {
          item.addEventListener('animationend', () => {
            item.classList.remove('just-completed');
            justCompletedIds.delete(id);
          }, { once: true });
        }
      }
      blocksListEl.appendChild(item);
    });

    updateBlocksState();
    if (animateCompletion && !reduceMotion) {
      // FLIP: перемещение блоков из прежних координат в новые.
      for (const element of blocksListEl.children) {
        const before = previous.get(element.dataset.blockId);
        if (!before) continue;
        const after = element.getBoundingClientRect();
        const dx = before.left - after.left;
        const dy = before.top - after.top;
        const completed = justCompletedIds.has(Number(element.dataset.blockId));
        if (completed) {
          element.classList.add('completion-moving');
          const animation = element.animate([
            { transform: `translate(${dx}px, ${dy}px) scale(1)`, opacity: 1,
              backgroundColor: 'rgba(139, 92, 246, 0.16)', borderColor: 'rgba(139, 92, 246, 0.55)' },
            { offset: 0.35, transform: `translate(${dx * 0.65}px, ${dy * 0.65}px) scale(1.018)`, opacity: 1,
              backgroundColor: 'rgba(236, 72, 153, 0.18)', borderColor: 'rgba(236, 72, 153, 0.6)' },
            { transform: 'translate(0, 0) scale(1)', opacity: 0.42,
              backgroundColor: 'rgba(255, 255, 255, 0.045)', borderColor: 'rgba(255, 255, 255, 0.09)' }
          ], { duration: 850, easing: 'cubic-bezier(.22,.75,.22,1)' });
          animation.finished.catch(() => {}).then(() => {
            element.classList.remove('completion-moving');
            justCompletedIds.delete(Number(element.dataset.blockId));
          });
        } else if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
          element.animate([
            { transform: `translate(${dx}px, ${dy}px)` },
            { transform: 'translate(0, 0)' }
          ], { duration: 700, easing: 'cubic-bezier(.22,.75,.22,1)' });
        }
      }
    }
  }

  function updateBlocksState() {
    const items = blocksListEl.children;
    for (let idx = 0; idx < activeBlocks.length && idx < items.length; idx++) {
      const item = items[idx];
      const isCurrent = idx === 0;

      item.classList.toggle('active', isCurrent);
      item.classList.toggle('next-up', idx === 1 && isRunning);
      item.classList.toggle('is-running', isCurrent && isRunning && !isPaused);

      if (isCurrent) {
        const block = activeBlocks[0];
        let progress;
        if (isOvertime) progress = 100;
        else progress = block.durationSec > 0
          ? ((1 - remainingSec / block.durationSec) * 100).toFixed(2) : 0;
        item.style.setProperty('--progress', `${progress}%`);
      } else {
        item.style.removeProperty('--progress');
      }
    }

    blocksListEl.querySelectorAll('.remove-btn').forEach(btn => {
      btn.disabled = isRunning;
      btn.title = isRunning ? 'Нельзя удалить во время работы' : 'Удалить блок';
    });
  }

  // ---- Таймер-визуализация ----
  function setRingFraction(fraction) {
    const f = Math.max(0, Math.min(1, fraction));
    timerRingEl.style.strokeDashoffset = String(RING_CIRCUMFERENCE * (1 - f));
  }

  function setTaskLabel(label) {
    if (lastDisplayedTask === label) return;
    lastDisplayedTask = label;
    // Анимация только при смене названия, а не каждую секунду таймера.
    if (!reduceMotion.matches && currentBlockNameEl.animate) {
      currentBlockNameEl.getAnimations().forEach(animation => animation.cancel());
      currentBlockNameEl.animate([
        { opacity: 0, transform: 'translateY(5px)' },
        { opacity: 1, transform: 'translateY(0)' }
      ], { duration: 420, easing: 'cubic-bezier(.22, 1, .36, 1)' });
    }
    currentBlockNameEl.textContent = label;
  }

  function syncTaskMotion() {
    timerCircleEl.classList.toggle('task-in-progress', isRunning && !isPaused && activeBlocks.length > 0);
  }

  function updateTimerDisplay() {
    timerDisplayEl.classList.toggle('overtime', isOvertime);
    timerCircleEl.classList.toggle('overtime', isOvertime);

    if (activeBlocks.length === 0) {
      setTaskLabel(completedBlocks.length > 0 ? 'Завершено' : '—');
      timerDisplayEl.textContent = '00:00';
      setRingFraction(0);
      return;
    }

    const block = activeBlocks[0];
    if (isOvertime) {
      const elapsed = settings.overtimeSeconds - overtimeRemainingSec;
      setTaskLabel(`⚠ ${block.name}`);
      timerDisplayEl.textContent = `+${formatTime(elapsed)}`;
      setRingFraction(1);
    } else {
      setTaskLabel(block.name);
      timerDisplayEl.textContent = formatTime(remainingSec);
      const fraction = block.durationSec > 0 ? remainingSec / block.durationSec : 0;
      setRingFraction(fraction);
    }
  }

  // ---- Toggle-кнопка ----
  function updateStartBtnIcon() {
    const isPauseState = isRunning && !isPaused;
    const label = isPauseState ? 'Пауза' : (wasStarted ? 'Продолжить' : 'Старт');
    const stateKey = isPauseState + '|' + label;
    if (stateKey === currentBtnState) return;
    currentBtnState = stateKey;

    startBtn.innerHTML = isPauseState ? ICONS.pause : ICONS.play;
    startBtn.title = label;
    startBtn.setAttribute('aria-label', label);
  }

  function updateControls() {
    const hasActive = activeBlocks.length > 0;

    // Toggle: активна, если есть что запускать/чем управлять
    startBtn.disabled = !hasActive;

    // Следующий: только после старта и пока есть активные
    skipBtn.disabled = !wasStarted || !hasActive;

    // Рестарт: только после старта
    resetBtn.disabled = !wasStarted;

    timerCircleEl.classList.toggle('running', isRunning && !isPaused && !isOvertime);
    syncTaskMotion();
    blocksListEl.classList.toggle('can-drag', !wasStarted && activeBlocks.length > 1);

    updateStartBtnIcon();
    updateMeetingProgress();
  }

  // ---- Drag & drop (только до первого старта) ----
  function onDragStart(e) {
    if (wasStarted || isRunning) { e.preventDefault(); return; }
    const item = e.currentTarget;
    draggedIndex = parseInt(item.dataset.idx, 10);
    item.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', String(draggedIndex)); } catch (_) {}
  }
  function onDragEnd(e) {
    e.currentTarget.classList.remove('dragging');
    draggedIndex = -1;
    blocksListEl.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
  }
  function onDragOver(e) {
    if (wasStarted || isRunning || draggedIndex < 0) return;
    const idx = parseInt(e.currentTarget.dataset.idx, 10);
    if (idx === draggedIndex) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    blocksListEl.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    e.currentTarget.classList.add('drag-over');
  }
  function onDragLeave(e) { e.currentTarget.classList.remove('drag-over'); }
  function onDrop(e) {
    e.preventDefault();
    if (wasStarted || isRunning) return;
    const to = parseInt(e.currentTarget.dataset.idx, 10);
    e.currentTarget.classList.remove('drag-over');
    if (draggedIndex < 0 || draggedIndex === to) return;
    reorderActiveBlocks(draggedIndex, to);
  }

  function reorderActiveBlocks(from, to) {
    if (from === to) return;
    const [moved] = activeBlocks.splice(from, 1);
    activeBlocks.splice(to, 0, moved);
    if (!isRunning && !isOvertime && activeBlocks.length > 0) {
      remainingSec = activeBlocks[0].durationSec;
    }
    saveState();
    renderBlocks();
    updateTimerDisplay();
    updateControls();
  }

  // ---- Переходы ----
  function advanceToNextBlock() {
    if (activeBlocks.length === 0) return;
    const finished = activeBlocks.shift();
    completedBlocks.push(finished);
    justCompletedIds.add(finished.id);

    isOvertime = false;
    overtimeRemainingSec = 0;

    if (activeBlocks.length === 0) {
      remainingSec = 0;
      if (timerId) { clearInterval(timerId); timerId = null; }
      isRunning = false;
      isPaused = false;
      lastTickAt = null;
    } else {
      remainingSec = activeBlocks[0].durationSec;
    }
    saveState();
    renderBlocks(null, true);
    updateTimerDisplay();
    updateControls();
  }

  function switchToActiveBlock(idx) {
    if (idx <= 0 || idx >= activeBlocks.length) return;
    for (let i = 0; i < idx; i++) {
      const moved = activeBlocks.shift();
      completedBlocks.push(moved);
      justCompletedIds.add(moved.id);
    }
    remainingSec = activeBlocks[0].durationSec;
    isOvertime = false;
    overtimeRemainingSec = 0;
    saveState();
    renderBlocks(null, true);
    updateTimerDisplay();
    updateControls();
  }

  // ---- Запуск / пауза / продолжение ----
  function startTimer() {
    if (isRunning || activeBlocks.length === 0) return;
    if (remainingSec <= 0 && !isOvertime) remainingSec = activeBlocks[0].durationSec;

    wasStarted = true;
    isRunning = true;
    isPaused = false;
    if (meetingPlannedSec === 0) meetingPlannedSec = [...activeBlocks, ...completedBlocks].reduce((sum, b) => sum + b.durationSec, 0);
    lastTickAt = performance.now();

    timerId = setInterval(tick, 250);

    saveState();
    updateTimerDisplay();
    updateBlocksState();
    updateControls();
  }

  function togglePauseResume() {
    if (!isRunning) return;
    if (!isPaused) accountElapsedTime();
    isPaused = !isPaused;
    lastTickAt = isPaused ? null : performance.now();
    saveState();
    updateControls();
  }

  function onStartBtnClick() {
    if (isRunning) togglePauseResume();
    else startTimer();
  }

  function accountElapsedTime() {
    if (!isRunning || isPaused || lastTickAt === null) return;
    const now = performance.now();
    let delta = Math.max(0, (now - lastTickAt) / 1000);
    lastTickAt = now;
    // Ограничаем огромные скачки при засыпании устройства: таймер считает
    // только время активной сессии; паузы после перезагрузки не учитываются.
    delta = Math.min(delta, 60);
    meetingElapsedSec += delta;
    while (delta > 0 && activeBlocks.length > 0) {
      if (isOvertime) {
        const step = Math.min(delta, overtimeRemainingSec);
        overtimeRemainingSec -= step;
        delta -= step;
        if (overtimeRemainingSec <= 0.00001) advanceToNextBlock();
      } else {
        const step = Math.min(delta, remainingSec);
        remainingSec -= step;
        delta -= step;
        if (remainingSec <= 0.00001) {
          remainingSec = 0;
          if (settings.overtimeSeconds > 0) {
            isOvertime = true;
            overtimeRemainingSec = settings.overtimeSeconds;
          } else advanceToNextBlock();
        }
      }
    }
  }

  function tick() {
    if (isPaused || !isRunning) return;
    accountElapsedTime();
    updateTimerDisplay();
    updateBlocksState();
    updateControls();
    saveState();
  }

  function skipBlock() {
    if (!wasStarted || activeBlocks.length === 0) return;
    advanceToNextBlock();
  }

  // ---- Рестарт: возврат к исходному состоянию ----
  function resetTimer() {
    if (!wasStarted) return;

    const allBlocks = [...activeBlocks, ...completedBlocks].sort((a, b) => a.id - b.id);
    activeBlocks = allBlocks;
    completedBlocks = [];
    justCompletedIds.clear();

    if (timerId) { clearInterval(timerId); timerId = null; }
    wasStarted = false;
    isRunning = false;
    isPaused = false;
    isOvertime = false;
    overtimeRemainingSec = 0;
    meetingElapsedSec = 0;
    meetingPlannedSec = 0;
    lastTickAt = null;
    remainingSec = activeBlocks.length > 0 ? activeBlocks[0].durationSec : 0;
    currentBtnState = null;   // сброс кеша, чтобы иконка обновилась

    saveState();
    renderBlocks();
    updateTimerDisplay();
    updateControls();
  }

  // ---- CRUD ----
  function addBlock() {
    const name = blockNameInput.value.trim();
    const duration = parseInt(blockDurationInput.value, 10);
    if (!name) { window.ChronoUI.toast('Укажите название блока.', 'error'); return; }
    if (!Number.isFinite(duration) || duration < 1 || duration > 120) {
      window.ChronoUI.toast('Укажите время от 1 до 120 минут.', 'error'); return;
    }
    const newBlock = makeBlock(name, duration);
    activeBlocks.push(newBlock);
    blockNameInput.value = '';
    blockNameInput.focus();
    if (!isRunning && !isOvertime && activeBlocks.length === 1) {
      remainingSec = activeBlocks[0].durationSec;
    }
    saveState();
    renderBlocks(newBlock);
    updateTimerDisplay();
    updateControls();
  }

  function removeActiveBlock(idx) {
    if (isRunning) return;
    const wasCurrent = idx === 0;
    activeBlocks.splice(idx, 1);
    if (activeBlocks.length === 0) {
      remainingSec = 0;
      if (timerId) { clearInterval(timerId); timerId = null; }
      isRunning = false;
      isPaused = false;
      isOvertime = false;
      overtimeRemainingSec = 0;
    } else if (wasCurrent) {
      remainingSec = activeBlocks[0].durationSec;
      isOvertime = false;
      overtimeRemainingSec = 0;
    }
    saveState();
    renderBlocks();
    updateTimerDisplay();
    updateControls();
  }

  function removeCompletedBlock(idx) {
    if (isRunning) return;
    completedBlocks.splice(idx, 1);
    saveState();
    renderBlocks();
    updateControls();
  }

  // ---- Настройки / экспорт ----
  if (overtimeInput) {
    overtimeInput.addEventListener('change', () => {
      let v = parseInt(overtimeInput.value, 10);
      if (!Number.isFinite(v) || v < 0) v = 0;
      if (v > 600) v = 600;
      settings.overtimeSeconds = v;
      overtimeInput.value = v;
      saveState();
    });
  }

  function exportOptions() {
    const all = [...activeBlocks, ...completedBlocks].sort((a, b) => a.id - b.id);
    const payload = {
      settings: { overtimeSeconds: settings.overtimeSeconds },
      blocks: all.map(b => ({ name: b.name, durationMin: b.durationMin })),
    };
    const fileContent =
      '// Автоматически сгенерированный файл настроек\n' +
      'window.APP_OPTIONS = ' + JSON.stringify(payload, null, 2) + ';\n';
    const blob = new Blob([fileContent], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'options.js';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ---- Импорт файла экспорта без выполнения JavaScript ----
  function parseImportedOptions(source) {
    // Принимаем только JSON или точный формат экспортируемого options.js.
    // Никаких eval, Function или динамических script-тегов.
    const text = source.replace(/^\uFEFF/, '').trim();
    let json = text;
    if (!text.startsWith('{')) {
      const match = text.match(/^(?:\/\/[^\r\n]*\r?\n\s*)*window\.APP_OPTIONS\s*=\s*(\{[\s\S]*\})\s*;?\s*$/);
      if (!match) throw new Error('Файл не похож на экспорт Хроноблока');
      json = match[1];
    }
    return window.ChronoConfig.normalize(JSON.parse(json));
  }

  if (importBtn && importFile) {
    importBtn.addEventListener('click', () => importFile.click());
    importFile.addEventListener('change', async () => {
      const file = importFile.files && importFile.files[0];
      importFile.value = ''; // повторный выбор того же файла тоже должен работать
      if (!file) return;
      if (file.size > 65536) {
        window.ChronoUI.toast('Файл слишком большой (максимум 64 КБ).', 'error');
        return;
      }
      importBtn.disabled = true;
      try {
        const config = parseImportedOptions(await file.text());
        const confirmed = await window.ChronoUI.modal({
          title: 'Импортировать конфигурацию?',
          message: `Будут заменены текущие блоки и настройки овертайма (${config.blocks.length} блоков). Прогресс встречи сбросится.`,
          confirmText: 'Импортировать'
        });
        if (!confirmed) return;
        const blocks = config.blocks.map((b, i) => ({
          id: i + 1, name: b.name, durationMin: b.durationMin, durationSec: b.durationMin * 60
        }));
        const state = {
          activeBlocks: blocks, completedBlocks: [],
          settings: config.settings, nextId: blocks.length + 1,
          wasStarted: false, meetingElapsedSec: 0, meetingPlannedSec: 0,
          remainingSec: blocks.length ? blocks[0].durationSec : 0,
          overtimeRemainingSec: 0, isOvertime: false
        };
        // Записываем только в пространство текущей конфигурации.
        localStorage.setItem(storageKey, JSON.stringify(state));
        window.location.reload();
      } catch (error) {
        console.error('[chronoblock] Import:', error);
        window.ChronoUI.toast('Не удалось импортировать: ' + (error instanceof SyntaxError ? 'ошибка формата файла' : error.message), 'error');
      } finally {
        importBtn.disabled = false;
      }
    });
  }

  // ---- Экспорт, сброс и Share ----
  const isLocalFile = window.location.protocol === 'file:';
  if (exportBtn) {
    exportBtn.hidden = false;
    exportBtn.addEventListener('click', exportOptions);
  }
  if (shareBtn) shareBtn.hidden = isLocalFile;

  function getPortableConfig() {
    const all = [...activeBlocks, ...completedBlocks].sort((a, b) => a.id - b.id);
    return {
      settings: { overtimeSeconds: settings.overtimeSeconds },
      blocks: all.map(b => ({ name: b.name, durationMin: b.durationMin })),
    };
  }

  async function copyShareLink(link) {
    if (navigator.clipboard && window.isSecureContext) {
      try { await navigator.clipboard.writeText(link); return true; } catch (_) {}
    }
    // Резервный способ для браузеров без Clipboard API.
    const input = document.createElement('textarea');
    input.value = link;
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.select();
    let copied = false;
    try { copied = document.execCommand('copy'); } catch (_) {}
    input.remove();
    return copied;
  }

  if (shareBtn) shareBtn.addEventListener('click', async () => {
    shareBtn.disabled = true;
    try {
      const token = await window.ChronoConfig.encode(getPortableConfig());
      const url = new URL(window.location.href);
      url.hash = 'config=' + token;
      const link = url.toString();
      if (await copyShareLink(link)) {
        window.ChronoUI.toast('Ссылка скопирована. Теперь можно поделиться блоками.');
      } else {
        await window.ChronoUI.modal({
          title: 'Поделиться конфигурацией',
          message: 'Автоматическое копирование недоступно. Выделите ссылку и скопируйте её вручную.',
          inputValue: link,
          confirmText: 'Готово',
          cancelText: 'Закрыть'
        });
      }
    } catch (error) {
      console.error('[chronoblock] Share:', error);
      window.ChronoUI.toast('Не удалось создать ссылку. Попробуйте ещё раз.', 'error');
    } finally {
      shareBtn.disabled = false;
    }
  });

  if (clearBtn) clearBtn.addEventListener('click', async () => {
    const shared = Boolean(initialConfig);
    const confirmed = await window.ChronoUI.modal({
      title: 'Вернуть исходные настройки?',
      message: shared
        ? 'Изменения этой конфигурации будут удалены. Блоки и настройки восстановятся из исходной ссылки.'
        : 'Все изменения будут отменены. Список блоков и настройки времени вернутся к исходным значениям.',
      confirmText: 'Сбросить'
    });
    if (!confirmed) return;
    try {
      localStorage.removeItem(storageKey);
      if (storageKey === DEFAULT_STORAGE_KEY) localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch (error) {
      console.error('[chronoblock] Reset:', error);
      window.ChronoUI.toast('Не удалось сбросить настройки. Проверьте доступ к хранилищу браузера.', 'error');
      return;
    }
    window.location.reload();
  });

  // ---- Горячие клавиши и справка ----
  if (keyboardHelpBtn) keyboardHelpBtn.addEventListener('click', showKeyboardHelp);
  function showKeyboardHelp() {
    window.ChronoUI.modal({
      title: 'Горячие клавиши',
      message: '',
      keyboardHelp: true,
      confirmText: 'Понятно'
    });
  }
  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || event.repeat || event.ctrlKey || event.altKey || event.metaKey || event.isComposing) return;
    const target = event.target;
    if (target instanceof Element && (target.closest('input, textarea, select, [contenteditable="true"], dialog') || target.closest('button, a'))) return;
    if (document.querySelector('dialog[open]')) return;
    if (event.code === 'Space') {
      event.preventDefault();
      if (!startBtn.disabled) onStartBtnClick();
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      if (!skipBtn.disabled) skipBlock();
    } else if (event.key.toLowerCase() === 'r') {
      event.preventDefault();
      if (!resetBtn.disabled) resetTimer();
    } else if (event.key === '?' || (event.code === 'Slash' && event.shiftKey)) {
      event.preventDefault();
      showKeyboardHelp();
    }
  });

  // ---- События ----
  addBtn.addEventListener('click', addBlock);
  blockNameInput.addEventListener('keydown', e => { if (e.key === 'Enter') addBlock(); });
  startBtn.addEventListener('click', onStartBtnClick);
  skipBtn.addEventListener('click', skipBlock);
  resetBtn.addEventListener('click', resetTimer);

  // ---- Инициализация ----
  async function initialize() {
    const token = window.ChronoConfig.getUrlToken();
    if (token !== null) {
      try {
        initialConfig = await window.ChronoConfig.decode(token);
        storageKey = 'chronoblock:shared:' + window.ChronoConfig.getConfigHash(initialConfig);
      } catch (error) {
        console.error('[chronoblock] Invalid share link:', error);
        window.ChronoUI.toast('Не удалось открыть конфигурацию. Проверьте ссылку.', 'error');
        // Не заменяем и не стираем локальные данные при ошибочной ссылке.
        initialConfig = null;
        storageKey = DEFAULT_STORAGE_KEY;
      }
    }
    loadState();
    if (!wasStarted || !Number.isFinite(remainingSec) || remainingSec <= 0 && !isOvertime) {
      remainingSec = activeBlocks.length > 0 ? activeBlocks[0].durationSec : 0;
    }
    // После обновления страницы запущенный таймер восстанавливается на паузе.
    isRunning = false;
    isPaused = false;
    lastTickAt = null;
    renderBlocks();
    updateTimerDisplay();
    updateControls();
  }
  // При смене ссылки в открытой вкладке выбираем другое хранилище.
  window.addEventListener('hashchange', () => window.location.reload());
  initialize();
})();