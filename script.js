(function () {
  'use strict';

  const RING_CIRCUMFERENCE = 2 * Math.PI * 95;
  const STORAGE_KEY = 'timeblocks_state_v3';

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
  let currentBtnState = null;     // кеш состояния кнопки-переключателя

  const justCompletedIds = new Set();

  // ---- DOM ----
  const $ = (id) => document.getElementById(id);
  const blocksListEl = $('blocksList');
  const blockNameInput = $('blockName');
  const blockDurationInput = $('blockDuration');
  const addBtn = $('addBtn');
  const overtimeInput = $('overtimeInput');
  const exportBtn = $('exportBtn');
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
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        activeBlocks, completedBlocks, settings, nextId, wasStarted,
      }));
    } catch (_) {}
  }
  function loadState() {
    let loaded = false;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
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
      }
    } catch (_) {}
    if (!loaded) {
      const opts = (typeof window !== 'undefined' && window.APP_OPTIONS) || null;
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

  // ---- Рендер списка ----
  function createBlockItem(block, idx, type) {
    const item = document.createElement('div');
    item.className = 'block-item';

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

  function renderBlocks(newBlockRef = null) {
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
        item.classList.add('just-completed');
        item.addEventListener('animationend', () => {
          item.classList.remove('just-completed');
          justCompletedIds.delete(id);
        }, { once: true });
      }
      blocksListEl.appendChild(item);
    });

    updateBlocksState();
  }

  function updateBlocksState() {
    const items = blocksListEl.children;
    for (let idx = 0; idx < activeBlocks.length && idx < items.length; idx++) {
      const item = items[idx];
      const isCurrent = idx === 0;

      item.classList.toggle('active', isCurrent);
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

  function updateTimerDisplay() {
    timerDisplayEl.classList.toggle('overtime', isOvertime);
    timerCircleEl.classList.toggle('overtime', isOvertime);

    if (activeBlocks.length === 0) {
      currentBlockNameEl.textContent =
        completedBlocks.length > 0 ? 'Встреча завершена 🎉' : '—';
      timerDisplayEl.textContent = '00:00';
      setRingFraction(0);
      return;
    }

    const block = activeBlocks[0];
    if (isOvertime) {
      const elapsed = settings.overtimeSeconds - overtimeRemainingSec;
      currentBlockNameEl.textContent = `⚠ ${block.name}`;
      timerDisplayEl.textContent = `+${formatTime(elapsed)}`;
      setRingFraction(1);
    } else {
      currentBlockNameEl.textContent = block.name;
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
    blocksListEl.classList.toggle('can-drag', !wasStarted && activeBlocks.length > 1);

    updateStartBtnIcon();
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
    } else {
      remainingSec = activeBlocks[0].durationSec;
    }
    saveState();
    renderBlocks();
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
    renderBlocks();
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

    timerId = setInterval(tick, 1000);

    saveState();
    updateTimerDisplay();
    updateBlocksState();
    updateControls();
  }

  function togglePauseResume() {
    if (!isRunning) return;
    isPaused = !isPaused;
    updateControls();
  }

  function onStartBtnClick() {
    if (isRunning) togglePauseResume();
    else startTimer();
  }

  function tick() {
    if (isPaused) return;
    if (isOvertime) {
      overtimeRemainingSec -= 1;
      if (overtimeRemainingSec <= 0) { advanceToNextBlock(); return; }
    } else {
      remainingSec -= 1;
      if (remainingSec <= 0) {
        remainingSec = 0;
        if (settings.overtimeSeconds > 0) {
          isOvertime = true;
          overtimeRemainingSec = settings.overtimeSeconds;
        } else { advanceToNextBlock(); return; }
      }
    }
    updateTimerDisplay();
    updateBlocksState();
    updateControls();
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
    if (!name) { alert('Введите название блока'); return; }
    if (!Number.isFinite(duration) || duration < 1 || duration > 120) {
      alert('Длительность должна быть от 1 до 120 минут'); return;
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

  if (exportBtn) exportBtn.addEventListener('click', exportOptions);

  // ---- События ----
  addBtn.addEventListener('click', addBlock);
  blockNameInput.addEventListener('keydown', e => { if (e.key === 'Enter') addBlock(); });
  startBtn.addEventListener('click', onStartBtnClick);
  skipBtn.addEventListener('click', skipBlock);
  resetBtn.addEventListener('click', resetTimer);

  // ---- Инициализация ----
  loadState();
  if (activeBlocks.length > 0) remainingSec = activeBlocks[0].durationSec;
  renderBlocks();
  updateTimerDisplay();
  updateControls();
})();