(function () {
  'use strict';

  const RING_CIRCUMFERENCE = 2 * Math.PI * 95;
  const STORAGE_KEY = 'timeblocks_state_v2';

  // ---- Состояние ----
  let blocks = [];
  let settings = { overtimeSeconds: 30 };
  let currentIndex = 0;
  let remainingSec = 0;
  let overtimeRemainingSec = 0;
  let isOvertime = false;
  let timerId = null;
  let isPaused = false;
  let isRunning = false;

  // ---- DOM ----
  const blocksListEl = document.getElementById('blocksList');
  const blockNameInput = document.getElementById('blockName');
  const blockDurationInput = document.getElementById('blockDuration');
  const addBtn = document.getElementById('addBtn');
  const overtimeInput = document.getElementById('overtimeInput');
  const exportBtn = document.getElementById('exportBtn');

  const startBtn = document.getElementById('startBtn');
  const pauseBtn = document.getElementById('pauseBtn');
  const skipBtn = document.getElementById('skipBtn');
  const resetBtn = document.getElementById('resetBtn');

  const currentBlockNameEl = document.getElementById('currentBlockName');
  const timerDisplayEl = document.getElementById('timerDisplay');
  const timerRingEl = document.getElementById('timerRing');
  const timerCircleEl = document.querySelector('.timer-circle');

  // ---- Storage ----
  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ blocks, settings }));
    } catch (_) {}
  }

  function normalizeBlocks(arr) {
    if (!Array.isArray(arr)) return [];
    return arr
      .filter(b => b && typeof b.name === 'string' && Number.isFinite(b.durationMin))
      .map(b => {
        const m = Math.max(1, Math.round(b.durationMin));
        return { name: b.name, durationMin: m, durationSec: m * 60 };
      });
  }

  function loadState() {
    let loaded = false;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.blocks)) {
          blocks = normalizeBlocks(parsed.blocks);
          if (parsed.settings && Number.isFinite(parsed.settings.overtimeSeconds)) {
            settings.overtimeSeconds = Math.max(0, Math.round(parsed.settings.overtimeSeconds));
          }
          loaded = true;
        }
      }
    } catch (_) {}

    if (!loaded) {
      const opts = (typeof window !== 'undefined' && window.APP_OPTIONS) || null;
      if (opts) {
        if (opts.settings && Number.isFinite(opts.settings.overtimeSeconds)) {
          settings.overtimeSeconds = Math.max(0, Math.round(opts.settings.overtimeSeconds));
        }
        blocks = normalizeBlocks(opts.blocks);
      }
    }

    overtimeInput.value = settings.overtimeSeconds;
  }

  // ---- Утилиты ----
  function formatTime(sec) {
    const s = Math.max(0, Math.floor(Math.abs(sec)));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
  }

  // ---- Список ----
  function renderBlocks(newIndex = -1) {
    blocksListEl.innerHTML = '';
    if (blocks.length === 0) return;

    blocks.forEach((block, idx) => {
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
        removeBlock(idx);
      });

      item.append(nameSpan, durSpan, removeBtn);

      // Клик по блоку — переключение на него
      item.addEventListener('click', () => switchToBlock(idx));

      if (idx === newIndex) {
        item.classList.add('just-added');
        item.addEventListener(
          'animationend',
          () => item.classList.remove('just-added'),
          { once: true }
        );
      }

      blocksListEl.appendChild(item);
    });

    updateBlocksState();
  }

  function updateBlocksState() {
    Array.from(blocksListEl.children).forEach((item, idx) => {
      item.classList.toggle('active', idx === currentIndex && isRunning);
      item.classList.toggle('done', idx < currentIndex);

      if (idx === currentIndex && currentIndex < blocks.length) {
        const block = blocks[currentIndex];
        let progress;
        if (isOvertime) {
          progress = 100;
        } else {
          progress = block.durationSec > 0
            ? ((1 - remainingSec / block.durationSec) * 100).toFixed(2)
            : 0;
        }
        item.style.setProperty('--progress', `${progress}%`);
      } else {
        item.style.removeProperty('--progress');
      }
    });
  }

  // ---- Таймер ----
  function setRingFraction(fraction) {
    const f = Math.max(0, Math.min(1, fraction));
    timerRingEl.style.strokeDashoffset = String(RING_CIRCUMFERENCE * (1 - f));
  }

  function updateTimerDisplay() {
    timerDisplayEl.classList.toggle('overtime', isOvertime);
    timerCircleEl.classList.toggle('overtime', isOvertime);

    if (blocks.length === 0) {
      currentBlockNameEl.textContent = '—';
      timerDisplayEl.textContent = '00:00';
      setRingFraction(0);
      return;
    }

    if (currentIndex >= blocks.length) {
      currentBlockNameEl.textContent = 'Встреча завершена 🎉';
      timerDisplayEl.textContent = '00:00';
      setRingFraction(0);
      return;
    }

    const block = blocks[currentIndex];

    if (isOvertime) {
      const elapsed = settings.overtimeSeconds - overtimeRemainingSec;
      currentBlockNameEl.textContent = `⚠ ${block.name}`;
      timerDisplayEl.textContent = `+${formatTime(elapsed)}`;
      setRingFraction(1); // полное красное кольцо
    } else {
      currentBlockNameEl.textContent = block.name;
      timerDisplayEl.textContent = formatTime(remainingSec);
      const fraction = block.durationSec > 0 ? remainingSec / block.durationSec : 0;
      setRingFraction(fraction);
    }
  }

  function updateControls() {
    const hasBlocks = blocks.length > 0;
    const isFinished = currentIndex >= blocks.length;

    startBtn.disabled = !hasBlocks || isRunning || isFinished;
    pauseBtn.disabled = !isRunning;
    skipBtn.disabled = !hasBlocks || isFinished;
    resetBtn.disabled = !hasBlocks;

    timerCircleEl.classList.toggle('running', isRunning && !isPaused && !isOvertime);
  }

  // ---- Переходы ----
  function advanceToNextBlock() {
    currentIndex += 1;
    isOvertime = false;
    overtimeRemainingSec = 0;

    if (currentIndex < blocks.length) {
      remainingSec = blocks[currentIndex].durationSec;
    } else {
      remainingSec = 0;
      if (timerId) { clearInterval(timerId); timerId = null; }
      isRunning = false;
      isPaused = false;
      pauseBtn.textContent = '⏸ Пауза';
    }
  }

  function switchToBlock(idx) {
    if (idx < 0 || idx >= blocks.length) return;
    if (idx === currentIndex) return; // не сбрасываем активный блок случайно

    currentIndex = idx;
    remainingSec = blocks[currentIndex].durationSec;
    isOvertime = false;
    overtimeRemainingSec = 0;

    updateTimerDisplay();
    updateBlocksState();
    updateControls();
  }

  function startTimer() {
    if (isRunning || blocks.length === 0) return;
    if (currentIndex >= blocks.length) resetTimer();
    if (remainingSec <= 0 && !isOvertime) remainingSec = blocks[currentIndex].durationSec;

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
      if (overtimeRemainingSec <= 0) advanceToNextBlock();
    } else {
      remainingSec -= 1;
      if (remainingSec <= 0) {
        remainingSec = 0;
        if (settings.overtimeSeconds > 0) {
          isOvertime = true;
          overtimeRemainingSec = settings.overtimeSeconds;
        } else {
          advanceToNextBlock();
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
    if (blocks.length === 0 || currentIndex >= blocks.length) return;
    advanceToNextBlock();
    updateTimerDisplay();
    updateBlocksState();
    updateControls();
  }

  function resetTimer() {
    if (timerId) { clearInterval(timerId); timerId = null; }
    isRunning = false;
    isPaused = false;
    isOvertime = false;
    overtimeRemainingSec = 0;
    currentIndex = 0;
    remainingSec = blocks.length > 0 ? blocks[0].durationSec : 0;
    pauseBtn.textContent = '⏸ Пауза';
    updateTimerDisplay();
    updateBlocksState();
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

    blocks.push({ name, durationMin: duration, durationSec: duration * 60 });
    saveState();

    blockNameInput.value = '';
    blockNameInput.focus();

    if (!isRunning && currentIndex === 0 && !isOvertime) {
      remainingSec = blocks[0].durationSec;
    }

    renderBlocks(blocks.length - 1);
    updateTimerDisplay();
    updateControls();
  }

  function removeBlock(idx) {
    if (isRunning && idx === currentIndex) {
      if (!confirm('Удалить текущий выполняемый блок? Таймер будет сброшен.')) return;
    }

    blocks.splice(idx, 1);
    saveState();

    if (idx < currentIndex) {
      currentIndex -= 1;
    } else if (idx === currentIndex) {
      isOvertime = false;
      overtimeRemainingSec = 0;
      if (currentIndex >= blocks.length && blocks.length > 0) {
        currentIndex = blocks.length - 1;
      }
      if (blocks.length === 0) {
        currentIndex = 0;
        remainingSec = 0;
      } else {
        remainingSec = blocks[currentIndex].durationSec;
      }
      renderBlocks();
      updateTimerDisplay();
      updateControls();
      return;
    }

    if (currentIndex >= blocks.length && blocks.length > 0) {
      currentIndex = blocks.length - 1;
      remainingSec = blocks[currentIndex].durationSec;
    } else if (blocks.length === 0) {
      currentIndex = 0;
      remainingSec = 0;
    }

    renderBlocks();
    updateTimerDisplay();
    updateControls();
  }

  // ---- Настройки / экспорт ----
  overtimeInput.addEventListener('change', () => {
    let v = parseInt(overtimeInput.value, 10);
    if (!Number.isFinite(v) || v < 0) v = 0;
    if (v > 600) v = 600;
    settings.overtimeSeconds = v;
    overtimeInput.value = v;
    saveState();
  });

  function exportOptions() {
    const payload = {
      settings: { overtimeSeconds: settings.overtimeSeconds },
      blocks: blocks.map(b => ({ name: b.name, durationMin: b.durationMin })),
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

  exportBtn.addEventListener('click', exportOptions);

  // ---- События ----
  addBtn.addEventListener('click', addBlock);
  blockNameInput.addEventListener('keydown', e => { if (e.key === 'Enter') addBlock(); });

  startBtn.addEventListener('click', startTimer);
  pauseBtn.addEventListener('click', pauseTimer);
  skipBtn.addEventListener('click', skipBlock);
  resetBtn.addEventListener('click', resetTimer);

  // ---- Init ----
  loadState();
  if (blocks.length > 0) remainingSec = blocks[0].durationSec;

  renderBlocks();
  updateTimerDisplay();
  updateControls();
})();