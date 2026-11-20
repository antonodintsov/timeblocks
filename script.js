(function () {
  'use strict';

  const RING_CIRCUMFERENCE = 2 * Math.PI * 95;
  const STORAGE_KEY = 'timeblocks_state_v3';

  // ---- Состояние ----
  let activeBlocks = [];      // [current, next, ...]
  let completedBlocks = [];   // [..., lastCompleted]
  let settings = { overtimeSeconds: 30 };
  let nextId = 1;             // для стабильных id

  let remainingSec = 0;
  let overtimeRemainingSec = 0;
  let isOvertime = false;
  let timerId = null;
  let isPaused = false;
  let isRunning = false;

  // ---- DOM ----
  const $ = (id) => document.getElementById(id);

  const blocksListEl = $('blocksList');
  const blockNameInput = $('blockName');
  const blockDurationInput = $('blockDuration');
  const addBtn = $('addBtn');
  const overtimeInput = $('overtimeInput');
  const exportBtn = $('exportBtn');

  const startBtn = $('startBtn');
  const pauseBtn = $('pauseBtn');
  const skipBtn = $('skipBtn');
  const resetBtn = $('resetBtn');

  const currentBlockNameEl = $('currentBlockName');
  const timerDisplayEl = $('timerDisplay');
  const timerRingEl = $('timerRing');
  const timerCircleEl = document.querySelector('.timer-circle');

  const required = {
    blocksListEl, blockNameInput, blockDurationInput, addBtn,
    startBtn, pauseBtn, skipBtn, resetBtn,
    currentBlockNameEl, timerDisplayEl, timerRingEl, timerCircleEl,
  };
  for (const [name, el] of Object.entries(required)) {
    if (!el) {
      console.error(`[timeblocks] Не найден DOM-элемент: ${name}.`);
      return;
    }
  }

  // ---- Фабрика блока ----
  function makeBlock(name, durationMin) {
    return {
      id: nextId++,
      name,
      durationMin,
      durationSec: durationMin * 60,
    };
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
        activeBlocks,
        completedBlocks,
        settings,
        nextId,
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
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
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
    removeBtn.title = 'Удалить блок';
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (type === 'active') removeActiveBlock(idx);
      else removeCompletedBlock(idx);
    });

    item.append(nameSpan, durSpan, removeBtn);

    if (type === 'active') {
      item.addEventListener('click', () => switchToActiveBlock(idx));
    } else {
      item.classList.add('done');
    }

    return item;
  }

  function renderBlocks(newBlockRef = null) {
    blocksListEl.innerHTML = '';

    activeBlocks.forEach((block, idx) => {
      const item = createBlockItem(block, idx, 'active');
      if (block === newBlockRef) {
        item.classList.add('just-added');
        item.addEventListener(
          'animationend',
          () => item.classList.remove('just-added'),
          { once: true }
        );
      }
      blocksListEl.appendChild(item);
    });

    completedBlocks.forEach((block, idx) => {
      blocksListEl.appendChild(createBlockItem(block, idx, 'completed'));
    });

    updateBlocksState();
  }

  function updateBlocksState() {
    const items = blocksListEl.children;
    for (let idx = 0; idx < activeBlocks.length && idx < items.length; idx++) {
      const item = items[idx];
      const isCurrent = idx === 0;

      item.classList.toggle('active', isCurrent);

      if (isCurrent) {
        const block = activeBlocks[0];
        let progress;
        if (isOvertime) progress = 100;
        else progress = block.durationSec > 0
          ? ((1 - remainingSec / block.durationSec) * 100).toFixed(2)
          : 0;
        item.style.setProperty('--progress', `${progress}%`);
      } else {
        item.style.removeProperty('--progress');
      }
    }
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

  function updateControls() {
    const hasActive = activeBlocks.length > 0;

    startBtn.disabled = !hasActive || isRunning;
    pauseBtn.disabled = !isRunning;
    skipBtn.disabled = !hasActive;
    resetBtn.disabled = !hasActive && completedBlocks.length === 0;

    timerCircleEl.classList.toggle('running', isRunning && !isPaused && !isOvertime);
  }

  // ---- Переходы ----
  function advanceToNextBlock() {
    if (activeBlocks.length === 0) return;

    const finished = activeBlocks.shift();
    completedBlocks.push(finished);

    isOvertime = false;
    overtimeRemainingSec = 0;

    if (activeBlocks.length === 0) {
      remainingSec = 0;
      if (timerId) { clearInterval(timerId); timerId = null; }
      isRunning = false;
      isPaused = false;
      pauseBtn.textContent = '⏸ Пауза';
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
      completedBlocks.push(activeBlocks.shift());
    }

    remainingSec = activeBlocks[0].durationSec;
    isOvertime = false;
    overtimeRemainingSec = 0;

    saveState();
    renderBlocks();
    updateTimerDisplay();
    updateControls();
  }

  function startTimer() {
    if (isRunning || activeBlocks.length === 0) return;
    if (remainingSec <= 0 && !isOvertime) remainingSec = activeBlocks[0].durationSec;

    isRunning = true;
    isPaused = false;

    timerId = setInterval(tick, 1000);

    updateTimerDisplay();
    updateBlocksState();
    updateControls();
  }

  function tick() {
    if (isPaused) return;

    if (isOvertime) {
      overtimeRemainingSec -= 1;
      if (overtimeRemainingSec <= 0) {
        advanceToNextBlock();
        return;
      }
    } else {
      remainingSec -= 1;
      if (remainingSec <= 0) {
        remainingSec = 0;
        if (settings.overtimeSeconds > 0) {
          isOvertime = true;
          overtimeRemainingSec = settings.overtimeSeconds;
        } else {
          advanceToNextBlock();
          return;
        }
      }
    }

    updateTimerDisplay();
    updateBlocksState();
    updateControls();
  }

  function pauseTimer() {
    if (!isRunning) return;
    isPaused = !isPaused;
    pauseBtn.textContent = isPaused ? '▶ Продолжить' : '⏸ Пауза';
    updateControls();
  }

  function skipBlock() {
    if (activeBlocks.length === 0) return;
    advanceToNextBlock();
  }

  // ---- СБРОС: восстанавливаем исходный порядок по id ----
  function resetTimer() {
    // Все блоки снова становятся активными, в том порядке, в котором были созданы
    const allBlocks = [...activeBlocks, ...completedBlocks].sort((a, b) => a.id - b.id);
    activeBlocks = allBlocks;
    completedBlocks = [];

    if (timerId) { clearInterval(timerId); timerId = null; }
    isRunning = false;
    isPaused = false;
    isOvertime = false;
    overtimeRemainingSec = 0;
    remainingSec = activeBlocks.length > 0 ? activeBlocks[0].durationSec : 0;
    pauseBtn.textContent = '⏸ Пауза';

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
      alert('Длительность должна быть от 1 до 120 минут');
      return;
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
    if (isRunning && idx === 0) {
      if (!confirm('Удалить текущий выполняемый блок? Таймер переключится на следующий.')) return;
    }

    const wasCurrent = idx === 0;
    activeBlocks.splice(idx, 1);

    if (activeBlocks.length === 0) {
      remainingSec = 0;
      if (timerId) { clearInterval(timerId); timerId = null; }
      isRunning = false;
      isPaused = false;
      isOvertime = false;
      overtimeRemainingSec = 0;
      pauseBtn.textContent = '⏸ Пауза';
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

  startBtn.addEventListener('click', startTimer);
  pauseBtn.addEventListener('click', pauseTimer);
  skipBtn.addEventListener('click', skipBlock);
  resetBtn.addEventListener('click', resetTimer);

  // ---- Инициализация ----
  loadState();
  if (activeBlocks.length > 0) remainingSec = activeBlocks[0].durationSec;

  renderBlocks();
  updateTimerDisplay();
  updateControls();
})();