/* ==========================================================================
   Sudoku — script.js (full rewrite + integrated WebAudio SFX)
   - Render board + digit bank automatically
   - Generator + solver (backtracking)
   - Pencil/notes, erase, auto-check + highlight conflicts
   - Mistakes counter (count only newly-created invalid cells)
   - Timer, save/load, leaderboard (localStorage)
   - Theme toggle wiring
   - SFX: click/place/erase/error/toggle/win using Web Audio API (no external files)
   ========================================================================== */

(function () {
  'use strict';

  /* -----------------------------
     Selectors / DOM helpers
     ----------------------------- */
  const ID = {
    board: 'sudoku-board',
    template: 'cell-template',
    newGame: 'new-game',
    solve: 'solve',
    reset: 'reset',
    difficulty: 'difficulty',
    timer: 'timer',
    message: 'message',
    togglePencil: 'toggle-pencil',
    toggleTheme: 'toggle-theme',
    save: 'save-progress',
    load: 'load-progress',
    leaderList: 'leader-list',
    digitBank: 'digit-bank',
    eraseBtn: 'erase-btn',
    mistakes: 'mistakes'
  };

  const $id = (id) => document.getElementById(id);
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const boardEl = $id(ID.board);
  const timerEl = $id(ID.timer);
  const messageEl = $id(ID.message);
  const mistakesEl = $id(ID.mistakes);
  const digitBankEl = $id(ID.digitBank);
  const leaderListEl = $id(ID.leaderList);

  const btnNew = $id(ID.newGame);
  const btnSolve = $id(ID.solve);
  const btnReset = $id(ID.reset);
  const selDifficulty = $id(ID.difficulty);
  const togglePencilBtn = $id(ID.togglePencil);
  const toggleThemeBtn = $id(ID.toggleTheme);
  const btnSave = $id(ID.save);
  const btnLoad = $id(ID.load);
  const eraseBtn = $id(ID.eraseBtn);

  /* -----------------------------
     Sound (Web Audio API) — small SFX engine
     ----------------------------- */
  class SFX {
    constructor() {
      this.ctx = null;
      this.master = null;
      this.enabled = true;
      this._initVolumeFromStorage();
    }

    ensure() {
      if (this.ctx) return;
      try {
        const C = window.AudioContext || window.webkitAudioContext;
        if (!C) return;
        this.ctx = new C();
        this.master = this.ctx.createGain();
        this.master.gain.value = parseFloat(localStorage.getItem('sudoku_sound_vol') || 0.12);
        this.master.connect(this.ctx.destination);
      } catch (e) {
        this.ctx = null;
      }
    }

    resume() {
      this.ensure();
      if (!this.ctx) return;
      if (this.ctx.state === 'suspended') {
        return this.ctx.resume().catch(() => {});
      }
    }

    setVolume(v) {
      this.ensure();
      if (!this.master) return;
      this.master.gain.value = v;
      localStorage.setItem('sudoku_sound_vol', String(v));
    }

    _initVolumeFromStorage() {
      const v = parseFloat(localStorage.getItem('sudoku_sound_vol'));
      this._storedVol = (!isNaN(v) ? v : 0.12);
    }

    _playOsc({ freq = 440, type = 'sine', dur = 0.08, when = 0, gain = 1 }) {
      if (!this.enabled) return;
      this.ensure();
      if (!this.ctx) return;
      try {
        const now = this.ctx.currentTime;
        const o = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        o.type = type;
        o.frequency.setValueAtTime(freq, now + when);
        g.gain.setValueAtTime(0.0001, now + when);
        g.gain.exponentialRampToValueAtTime(gain, now + when + 0.006);
        g.gain.exponentialRampToValueAtTime(0.0001, now + when + dur);
        o.connect(g);
        g.connect(this.master);
        o.start(now + when);
        o.stop(now + when + dur + 0.02);
      } catch (e) { /* ignore */ }
    }

    playClick() { this._playOsc({ freq: 880, type: 'sine', dur: 0.06, gain: 0.18 }); }
    playPlace() {
      // two-tone pleasant placement
      this._playOsc({ freq: 660, type: 'sine', dur: 0.10, gain: 0.16 });
      this._playOsc({ freq: 880, type: 'triangle', dur: 0.06, when: 0.06, gain: 0.12 });
    }
    playErase() { this._playOsc({ freq: 220, type: 'sawtooth', dur: 0.12, gain: 0.12 }); }
    playError() {
      this._playOsc({ freq: 170, type: 'square', dur: 0.16, gain: 0.14 });
      this._playOsc({ freq: 120, type: 'sine', dur: 0.18, when: 0.06, gain: 0.12 });
    }
    playToggle() { this._playOsc({ freq: 1100, type: 'triangle', dur: 0.06, gain: 0.12 }); }
    playStart() { this._playOsc({ freq: 520, type: 'sine', dur: 0.09, gain: 0.14 }); }
    playWin() {
      // small arpeggio
      this._playOsc({ freq: 880, type: 'sine', dur: 0.09, gain: 0.14, when: 0 });
      this._playOsc({ freq: 1100, type: 'sine', dur: 0.09, gain: 0.13, when: 0.09 });
      this._playOsc({ freq: 1320, type: 'sine', dur: 0.09, gain: 0.12, when: 0.18 });
    }
  }

  const sfx = new SFX();

  // Ensure audio created/resumed on first user gesture: call sfx.resume() inside user handlers.

  /* -----------------------------
     State & constants
     ----------------------------- */
  let grid = createEmptyGrid();
  let initialGrid = null;
  let solutionGrid = null;
  let selected = null;
  let pencilMode = false;
  let elapsed = 0;
  let timerInterval = null;
  let mistakesCount = 0;
  const invalidSet = new Set();

  const LS_KEYS = { SAVED: 'sudoku_saved_v4', LEAD: 'sudoku_lead_v4' };

  const DIFF = {
    easy: { minClues: 40, maxClues: 50 },
    medium: { minClues: 30, maxClues: 35 },
    hard: { minClues: 25, maxClues: 28 }
  };

  /* -----------------------------
     Utilities
     ----------------------------- */
  function createEmptyGrid() {
    return Array.from({ length: 9 }, () =>
      Array.from({ length: 9 }, () => ({ value: null, given: false, notes: new Set() }))
    );
  }

  function cloneGridModel(g) {
    return g.map(row => row.map(cell => ({ value: cell.value, given: !!cell.given, notes: new Set(Array.from(cell.notes || [])) })));
  }

  function gridToNumbers(g) {
    return g.map(row => row.map(cell => (cell.value === null ? 0 : cell.value)));
  }

  function numbersToModel(nums) {
    return nums.map(row => row.map(v => ({ value: v === 0 ? null : v, given: v !== 0, notes: new Set() })));
  }

  function posKey(r, c) { return `${r},${c}`; }
  function parseKey(k) { const [r, c] = k.split(',').map(Number); return { r, c }; }
  function inRange(r, c) { return r >= 0 && r < 9 && c >= 0 && c < 9; }

  function formatTime(s) {
    const mm = String(Math.floor(s / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    return `${mm}:${ss}`;
  }

  function setMessage(txt = '', ms = 2200) {
    if (!messageEl) return;
    messageEl.textContent = txt;
    if (ms > 0) setTimeout(() => { if (messageEl && messageEl.textContent === txt) messageEl.textContent = ''; }, ms);
  }

  /* -----------------------------
     Build DOM (board + digit bank)
     ----------------------------- */
  function ensureBoardDOM() {
    if (!boardEl) return;
    boardEl.innerHTML = '';
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const wrapper = document.createElement('div');
        wrapper.className = 'cell-wrapper';
        wrapper.dataset.row = r;
        wrapper.dataset.col = c;
        wrapper.dataset.box = Math.floor(r / 3) * 3 + Math.floor(c / 3);
        wrapper.setAttribute('role', 'gridcell');

        const inp = document.createElement('input');
        inp.type = 'text';
        inp.className = 'cell';
        inp.readOnly = true;
        inp.inputMode = 'none';
        inp.autocomplete = 'off';
        inp.setAttribute('aria-label', `Cell ${r + 1}-${c + 1}`);
        inp.value = '';

        const notes = document.createElement('div');
        notes.className = 'notes';
        for (let n = 1; n <= 9; n++) {
          const nd = document.createElement('div');
          nd.className = 'note';
          nd.dataset.n = n;
          nd.textContent = '';
          notes.appendChild(nd);
        }

        wrapper.appendChild(inp);
        wrapper.appendChild(notes);
        boardEl.appendChild(wrapper);
        attachCellListeners(wrapper, inp);
      }
    }
  }

  function ensureDigitBankDOM() {
    if (!digitBankEl) return;
    if (digitBankEl.children.length > 0) {
      for (let d = 1; d <= 9; d++) {
        let btn = digitBankEl.querySelector(`.digit-btn[data-digit="${d}"]`);
        if (!btn) {
          btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'digit-btn';
          btn.dataset.digit = String(d);
          const sp = document.createElement('span'); sp.className = 'digit'; sp.textContent = String(d);
          const cnt = document.createElement('span'); cnt.className = 'count'; cnt.textContent = '9';
          btn.appendChild(sp); btn.appendChild(cnt);
          digitBankEl.appendChild(btn);
        } else {
          if (!btn.querySelector('.count')) {
            const cnt = document.createElement('span'); cnt.className = 'count'; cnt.textContent = '9';
            btn.appendChild(cnt);
          }
        }
      }
      if (!digitBankEl.querySelector('#' + ID.eraseBtn)) {
        const er = document.createElement('button');
        er.type = 'button';
        er.id = ID.eraseBtn;
        er.className = 'digit-btn';
        er.innerHTML = `<span class="digit">⌫</span>`;
        digitBankEl.appendChild(er);
      }
      return;
    }

    digitBankEl.innerHTML = '';
    for (let d = 1; d <= 9; d++) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'digit-btn';
      btn.dataset.digit = String(d);

      const sp = document.createElement('span'); sp.className = 'digit'; sp.textContent = String(d);
      const cnt = document.createElement('span'); cnt.className = 'count'; cnt.textContent = '9';
      btn.appendChild(sp); btn.appendChild(cnt);
      digitBankEl.appendChild(btn);
    }
    const er = document.createElement('button');
    er.type = 'button';
    er.id = ID.eraseBtn;
    er.className = 'digit-btn';
    er.innerHTML = `<span class="digit">⌫</span>`;
    digitBankEl.appendChild(er);
  }

  /* -----------------------------
     Render model -> DOM
     ----------------------------- */
  function renderFromModel() {
    if (!boardEl) return;
    const wrappers = Array.from(boardEl.children);
    wrappers.forEach(w => {
      const r = +w.dataset.row;
      const c = +w.dataset.col;
      const cell = grid[r][c];
      const inp = w.querySelector('.cell');
      const notes = w.querySelectorAll('.note');

      if (cell.value !== null) {
        inp.value = String(cell.value);
        w.classList.add('has-value');
      } else {
        inp.value = '';
        w.classList.remove('has-value');
      }

      if (cell.given) {
        inp.classList.add('given');
        inp.setAttribute('readonly', 'readonly');
        inp.tabIndex = -1;
      } else {
        inp.classList.remove('given');
        inp.removeAttribute('readonly');
        inp.tabIndex = 0;
      }

      notes.forEach(nd => {
        const n = Number(nd.dataset.n);
        nd.textContent = cell.notes.has(n) ? n : '';
      });

      inp.classList.remove('invalid', 'highlight');
      w.classList.remove('highlight', 'highlight-row', 'highlight-col', 'highlight-block');
    });

    if (selected) updateHighlights(selected.r, selected.c);
    updateDigitCounts();
    updateTimerUI();
    updateMistakesUI(false);
  }

  /* -----------------------------
     Selection / highlights
     ----------------------------- */
  function attachCellListeners(wrapper, inp) {
    wrapper.addEventListener('click', (e) => {
      e.preventDefault();
      sfx.resume(); // resume audio on user interaction
      const r = +wrapper.dataset.row;
      const c = +wrapper.dataset.col;
      selectCell(r, c);
      const el = wrapper.querySelector('.cell');
      el && el.focus({ preventScroll: true });
      sfx.playClick();
    });

    wrapper.addEventListener('dblclick', (e) => {
      e.preventDefault();
      setPencil(!pencilMode);
      setMessage(`Pencil ${pencilMode ? 'ON' : 'OFF'}`, 900);
      sfx.resume();
      sfx.playToggle();
    });

    inp.addEventListener('focus', () => {
      const r = +wrapper.dataset.row;
      const c = +wrapper.dataset.col;
      selectCell(r, c);
    });
  }

  function selectCell(r, c) {
    selected = { r, c };
    updateHighlights(r, c);
  }

  function clearHighlights() {
    $$('.cell-wrapper').forEach(w => {
      w.classList.remove('highlight', 'highlight-row', 'highlight-col', 'highlight-block');
      const inp = w.querySelector('.cell');
      inp && inp.classList.remove('highlight');
    });
  }

  function updateHighlights(r, c) {
    clearHighlights();
    const box = Math.floor(r / 3) * 3 + Math.floor(c / 3);
    $$('.cell-wrapper').forEach(w => {
      const rr = +w.dataset.row;
      const cc = +w.dataset.col;
      const bb = +w.dataset.box;
      if (rr === r) w.classList.add('highlight-row');
      if (cc === c) w.classList.add('highlight-col');
      if (bb === box) w.classList.add('highlight-block');
    });
    const w = getWrapper(r, c);
    if (w) {
      w.classList.add('highlight');
      const inp = w.querySelector('.cell');
      inp && inp.classList.add('highlight');
    }
  }

  function getWrapper(r, c) {
    return boardEl ? boardEl.querySelector(`.cell-wrapper[data-row="${r}"][data-col="${c}"]`) : null;
  }

  /* -----------------------------
     Put / toggle / erase operations
     ----------------------------- */
  function setValueAt(r, c, val, options = {}) {
    if (!inRange(r, c)) return;
    const cell = grid[r][c];
    if (cell.given) return;
    if (val === null) {
      eraseAt(r, c);
      return;
    }
    cell.value = val;
    cell.notes.clear();
    renderFromModel();

    const conflicts = findConflictsForCell(r, c);

    if (conflicts.length > 0) {
      const newlyInvalid = [];
      const placedKey = posKey(r, c);
      if (!invalidSet.has(placedKey)) { newlyInvalid.push(placedKey); invalidSet.add(placedKey); }

      for (const { r: cr, c: cc } of conflicts) {
        const k = posKey(cr, cc);
        if (!invalidSet.has(k)) { newlyInvalid.push(k); invalidSet.add(k); }
      }

      for (const k of newlyInvalid) {
        const { r: rr, c: cc } = parseKey(k);
        const w = getWrapper(rr, cc);
        if (w) {
          const inp = w.querySelector('.cell');
          inp && inp.classList.add('invalid');
          animateInvalid(w);
        }
      }

      if (newlyInvalid.length > 0) {
        mistakesCount += newlyInvalid.length;
        updateMistakesUI(true);
        sfx.resume();
        sfx.playError();
      }
    } else {
      autoCheckAndSyncInvalids();
      sfx.resume();
      sfx.playPlace();
    }

    updateDigitCounts(true);
    maybeSolved();
  }

  function toggleNoteAt(r, c, n) {
    if (!inRange(r, c)) return;
    const cell = grid[r][c];
    if (cell.given || cell.value !== null) return;
    if (cell.notes.has(n)) cell.notes.delete(n); else cell.notes.add(n);
    renderFromModel();
    sfx.resume();
    sfx.playClick();
  }

  function eraseAt(r, c) {
    if (!inRange(r, c)) return;
    const cell = grid[r][c];
    if (cell.given) return;
    const key = posKey(r, c);
    if (invalidSet.has(key)) {
      invalidSet.delete(key);
      mistakesCount = Math.max(0, mistakesCount - 1);
    }
    cell.value = null;
    cell.notes.clear();
    renderFromModel();
    autoCheckAndSyncInvalids();
    sfx.resume();
    sfx.playErase();
  }

  /* -----------------------------
     Conflict detection & auto-check
     ----------------------------- */
  function findConflictsForCell(r, c) {
    const val = grid[r][c].value;
    if (!val) return [];
    const conflicts = [];

    for (let i = 0; i < 9; i++) if (i !== c && grid[r][i].value === val) conflicts.push({ r, c: i });
    for (let i = 0; i < 9; i++) if (i !== r && grid[i][c].value === val) conflicts.push({ r: i, c });
    const br = Math.floor(r / 3) * 3, bc = Math.floor(c / 3) * 3;
    for (let rr = br; rr < br + 3; rr++) {
      for (let cc = bc; cc < bc + 3; cc++) {
        if ((rr !== r || cc !== c) && grid[rr][cc].value === val) {
          if (!conflicts.some(x => x.r === rr && x.c === cc)) conflicts.push({ r: rr, c: cc });
        }
      }
    }
    return conflicts;
  }

  function isValidPlacement(numbers, r, c, num) {
    for (let i = 0; i < 9; i++) {
      if (numbers[r][i] === num) return false;
      if (numbers[i][c] === num) return false;
    }
    const br = Math.floor(r / 3) * 3, bc = Math.floor(c / 3) * 3;
    for (let rr = br; rr < br + 3; rr++) for (let cc = bc; cc < bc + 3; cc++) if (numbers[rr][cc] === num) return false;
    return true;
  }

  function autoCheckAndSyncInvalids() {
    $$('.cell').forEach(c => c.classList.remove('invalid'));
    const nums = gridToNumbers(grid);
    const currentInvalid = new Set();

    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const v = nums[r][c];
        if (v === 0) continue;
        nums[r][c] = 0;
        if (!isValidPlacement(nums, r, c, v)) {
          currentInvalid.add(posKey(r, c));
          const w = getWrapper(r, c);
          if (w) w.querySelector('.cell').classList.add('invalid');
        }
        nums[r][c] = v;
      }
    }

    for (const k of Array.from(invalidSet)) {
      if (!currentInvalid.has(k)) invalidSet.delete(k);
    }
    for (const k of currentInvalid) {
      if (!invalidSet.has(k)) invalidSet.add(k);
    }

    updateMistakesUI(false);
  }

  /* -----------------------------
     Animations
     ----------------------------- */
  function animateInvalid(wrapper) {
    const el = wrapper.querySelector('.cell');
    if (!el || !el.animate) return;
    try {
      el.animate([
        { transform: 'translateX(0)' },
        { transform: 'translateX(-6px)' },
        { transform: 'translateX(4px)' },
        { transform: 'translateX(0)' }
      ], { duration: 420, easing: 'cubic-bezier(.36,.07,.19,.97)' });
    } catch (e) { }
  }

  function animateMistakesCounter() {
    if (!mistakesEl || !mistakesEl.animate) return;
    try {
      mistakesEl.animate([
        { transform: 'scale(1)' },
        { transform: 'scale(1.06)' },
        { transform: 'scale(1)' }
      ], { duration: 360, easing: 'ease-out' });
    } catch (e) { }
  }

  /* -----------------------------
     Solver & generator
     ----------------------------- */
  function solveSudoku(numbers) {
    for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
      if (numbers[r][c] === 0) {
        for (let n = 1; n <= 9; n++) {
          if (isValidPlacement(numbers, r, c, n)) {
            numbers[r][c] = n;
            if (solveSudoku(numbers)) return true;
            numbers[r][c] = 0;
          }
        }
        return false;
      }
    }
    return true;
  }

  function countSolutions(numbers, limit = 2) {
    let count = 0;
    function backtrack() {
      if (count >= limit) return;
      let found = false, er = -1, ec = -1;
      for (let r = 0; r < 9 && !found; r++) {
        for (let c = 0; c < 9; c++) {
          if (numbers[r][c] === 0) { found = true; er = r; ec = c; break; }
        }
      }
      if (!found) { count++; return; }
      for (let n = 1; n <= 9; n++) {
        if (isValidPlacement(numbers, er, ec, n)) {
          numbers[er][ec] = n;
          backtrack();
          numbers[er][ec] = 0;
          if (count >= limit) return;
        }
      }
    }
    backtrack();
    return count;
  }

  function generateFullSolution() {
    const nums = Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => 0));
    function fill() {
      for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
        if (nums[r][c] === 0) {
          const candidates = shuffle([1,2,3,4,5,6,7,8,9]);
          for (const n of candidates) {
            if (isValidPlacement(nums, r, c, n)) {
              nums[r][c] = n;
              if (fill()) return true;
              nums[r][c] = 0;
            }
          }
          return false;
        }
      }
      return true;
    }
    fill();
    return nums;
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function generatePuzzle(difficulty = 'medium') {
    setMessage('Generating puzzle...');
    const solution = generateFullSolution();
    const puzzle = deepCopy(solution);
    const diff = DIFF[difficulty] || DIFF.medium;
    const target = Math.floor(Math.random() * (diff.maxClues - diff.minClues + 1)) + diff.minClues;

    const coords = [];
    for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) coords.push({ r, c });
    shuffle(coords);

    let clues = 81;
    for (let i = 0; i < coords.length && clues > target; i++) {
      const { r, c } = coords[i];
      const backup = puzzle[r][c];
      puzzle[r][c] = 0;
      const copy = deepCopy(puzzle);
      const solCount = countSolutions(copy, 2);
      if (solCount !== 1) {
        puzzle[r][c] = backup;
      } else {
        clues--;
      }
    }

    setMessage('', 50);
    return { puzzle, solution };
  }

  function deepCopy(arr) { return arr.map(r => r.slice()); }

  /* -----------------------------
     Public actions
     ----------------------------- */
  function startNewGame(difficulty = 'medium') {
    stopTimer();
    setMessage('Preparing new puzzle — please wait...', 1400);
    setTimeout(() => {
      const { puzzle, solution } = generatePuzzle(difficulty);
      grid = numbersToModel(puzzle);
      initialGrid = cloneGridModel(grid);
      solutionGrid = deepCopy(solution);
      elapsed = 0;
      mistakesCount = 0;
      invalidSet.clear();
      renderFromModel();
      startTimer();
      sfx.resume(); sfx.playStart();
      setMessage(`New ${difficulty} puzzle ready.`, 1600);
    }, 40);
  }

  function resetToInitial() {
    if (!initialGrid) return;
    stopTimer();
    grid = cloneGridModel(initialGrid);
    elapsed = 0;
    mistakesCount = 0;
    invalidSet.clear();
    renderFromModel();
    startTimer();
    sfx.resume(); sfx.playStart();
    setMessage('Reset to initial puzzle.');
  }

  function solveInstant() {
    if (!solutionGrid) return;
    stopTimer();
    for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
      grid[r][c].value = solutionGrid[r][c];
      grid[r][c].notes.clear();
    }
    invalidSet.clear();
    renderFromModel();
    sfx.resume(); sfx.playWin();
    setMessage('Puzzle solved.');
    maybeSolved(true);
  }

  /* -----------------------------
     Timer + UI
     ----------------------------- */
  function startTimer() {
    stopTimer();
    timerInterval = setInterval(() => {
      elapsed++;
      updateTimerUI();
    }, 1000);
  }
  function stopTimer() {
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  }
  function updateTimerUI() { if (timerEl) timerEl.textContent = formatTime(elapsed); }

  /* -----------------------------
     Save / Load / Leaderboard
     ----------------------------- */
  function replacer(key, value) {
    if (value instanceof Set) return { __set: Array.from(value) };
    return value;
  }
  function reviver(key, value) {
    if (value && value.__set) return new Set(value.__set);
    return value;
  }

  function saveProgress() {
    try {
      const payload = { grid, solutionGrid, elapsed, difficulty: selDifficulty ? selDifficulty.value : 'medium', ts: Date.now() };
      localStorage.setItem(LS_KEYS.SAVED, JSON.stringify(payload, replacer));
      setMessage('Game saved locally.');
    } catch (e) {
      console.error(e);
      setMessage('Failed to save.');
    }
  }

  function loadProgress() {
    try {
      const raw = localStorage.getItem(LS_KEYS.SAVED);
      if (!raw) { setMessage('No saved game.'); return; }
      const obj = JSON.parse(raw, reviver);
      grid = obj.grid.map(row => row.map(cell => ({ value: cell.value === null ? null : cell.value, given: !!cell.given, notes: (cell.notes instanceof Set) ? new Set(Array.from(cell.notes)) : new Set() })));
      initialGrid = cloneGridModel(grid);
      solutionGrid = obj.solutionGrid ? deepCopy(obj.solutionGrid) : null;
      elapsed = obj.elapsed || 0;
      mistakesCount = 0;
      invalidSet.clear();
      renderFromModel();
      startTimer();
      setMessage('Saved game loaded.');
    } catch (e) {
      console.error(e);
      setMessage('Failed to load save.');
    }
  }

  function recordCompletion() {
    try {
      const raw = localStorage.getItem(LS_KEYS.LEAD);
      const arr = raw ? JSON.parse(raw) : [];
      arr.push({ time: elapsed, difficulty: selDifficulty ? selDifficulty.value : 'medium', date: new Date().toISOString() });
      arr.sort((a, b) => a.time - b.time);
      localStorage.setItem(LS_KEYS.LEAD, JSON.stringify(arr.slice(0, 10)));
      renderLeaderboard();
    } catch (e) { console.error(e); }
  }

  function renderLeaderboard() {
    if (!leaderListEl) return;
    const raw = localStorage.getItem(LS_KEYS.LEAD);
    const arr = raw ? JSON.parse(raw) : [];
    leaderListEl.innerHTML = '';
    for (const it of arr) {
      const li = document.createElement('li');
      li.textContent = `${formatTime(it.time)} — ${it.difficulty} — ${new Date(it.date).toLocaleString()}`;
      leaderListEl.appendChild(li);
    }
  }

  /* -----------------------------
     Completion check
     ----------------------------- */
  function maybeSolved(quiet = false) {
    const nums = gridToNumbers(grid);
    for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) if (nums[r][c] === 0) return false;
    const copy = deepCopy(nums);
    if (solveSudoku(copy)) {
      stopTimer();
      if (!quiet) setMessage(`Solved in ${formatTime(elapsed)}!`);
      recordCompletion();
      sfx.resume(); sfx.playWin();
      return true;
    } else {
      autoCheckAndSyncInvalids();
      return false;
    }
  }

  /* -----------------------------
     Digit bank handlers & counts
     ----------------------------- */
  function updateDigitCounts(animate = false) {
    if (!digitBankEl) return;
    const counts = Array(10).fill(9);
    const nums = gridToNumbers(grid);
    for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
      const v = nums[r][c];
      if (v >= 1 && v <= 9) counts[v]--;
    }
    const btns = digitBankEl.querySelectorAll('.digit-btn');
    btns.forEach(b => {
      const d = Number(b.dataset.digit);
      const span = b.querySelector('.count');
      if (span && !Number.isNaN(d)) {
        const newText = String(Math.max(0, counts[d]));
        if (animate && span.textContent !== newText) {
          span.classList.remove('count-update'); void span.offsetWidth; span.classList.add('count-update');
        }
        span.textContent = newText;
      }
      if (!Number.isNaN(d)) {
        b.disabled = counts[d] <= 0;
        b.setAttribute('aria-disabled', b.disabled ? 'true' : 'false');
      }
    });
  }

  function handleDigitPress(d) {
    if (!selected) { setMessage('Pilih sebuah kotak dulu.'); return; }
    sfx.resume();
    const { r, c } = selected;
    const cell = grid[r][c];
    if (cell.given) { setMessage('Kotak ini adalah given — tidak bisa diubah.'); sfx.playClick(); return; }
    if (pencilMode) {
      toggleNoteAt(r, c, d);
    } else {
      setValueAt(r, c, d);
    }
  }

  function handleErase() {
    if (!selected) { setMessage('Pilih sebuah kotak dulu.'); return; }
    sfx.resume();
    const { r, c } = selected;
    eraseAt(r, c);
    updateDigitCounts(true);
  }

  /* -----------------------------
     Keyboard support
     ----------------------------- */
  document.addEventListener('keydown', (e) => {
    if (!selected && !(e.key >= '1' && e.key <= '9')) return;
    const { r, c } = selected || {};
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      e.preventDefault();
      let nr = r, nc = c;
      if (e.key === 'ArrowUp') nr = (r + 8) % 9;
      if (e.key === 'ArrowDown') nr = (r + 1) % 9;
      if (e.key === 'ArrowLeft') nc = (c + 8) % 9;
      if (e.key === 'ArrowRight') nc = (c + 1) % 9;
      selectCell(nr, nc);
      const w = getWrapper(nr, nc);
      if (w) w.querySelector('.cell').focus({ preventScroll: true });
    } else if (e.key === 'Escape') {
      selected = null; clearHighlights(); document.activeElement && document.activeElement.blur();
    } else if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault(); handleErase(); updateDigitCounts(true);
    } else if (e.key >= '1' && e.key <= '9') {
      e.preventDefault(); sfx.resume(); handleDigitPress(Number(e.key)); updateDigitCounts(true);
    }
  });

  /* -----------------------------
     UI wiring (buttons + bank)
     ----------------------------- */
  function wireUI() {
    if (btnNew) btnNew.addEventListener('click', () => { sfx.resume(); startNewGame(selDifficulty ? selDifficulty.value : 'medium'); });
    if (btnReset) btnReset.addEventListener('click', () => { sfx.resume(); resetToInitial(); });
    if (btnSolve) btnSolve.addEventListener('click', () => { if (confirm('Selesaikan papan sekarang?')) { sfx.resume(); solveInstant(); } });
    if (togglePencilBtn) togglePencilBtn.addEventListener('click', () => {
      setPencil(!pencilMode);
      setMessage(`Pencil ${pencilMode ? 'ON' : 'OFF'}`, 900);
      sfx.resume(); sfx.playToggle();
    });
    if (toggleThemeBtn) toggleThemeBtn.addEventListener('click', () => {
      const root = document.documentElement;
      const isDark = root.getAttribute('data-theme') === 'dark' || root.classList.contains('dark');
      if (isDark) { root.removeAttribute('data-theme'); root.classList.remove('dark'); toggleThemeBtn.setAttribute('aria-pressed', 'false'); }
      else { root.setAttribute('data-theme', 'dark'); root.classList.add('dark'); toggleThemeBtn.setAttribute('aria-pressed', 'true'); }
      sfx.resume(); sfx.playToggle();
    });
    if (btnSave) btnSave.addEventListener('click', () => { sfx.resume(); saveProgress(); });
    if (btnLoad) btnLoad.addEventListener('click', () => { sfx.resume(); loadProgress(); });

    if (digitBankEl) {
      digitBankEl.addEventListener('click', (e) => {
        const btn = e.target.closest('.digit-btn');
        if (!btn) return;
        sfx.resume();
        if (btn.id === ID.eraseBtn) { handleErase(); updateDigitCounts(true); return; }
        const d = Number(btn.dataset.digit);
        if (!Number.isNaN(d)) {
          handleDigitPress(d);
          updateDigitCounts(true);
        }
      });
    }
  }

  function setPencil(flag) {
    pencilMode = !!flag;
    if (togglePencilBtn) {
      togglePencilBtn.setAttribute('aria-pressed', pencilMode ? 'true' : 'false');
      togglePencilBtn.classList.toggle('active', pencilMode);
    }
  }

  function updateMistakesUI(animate = false) {
    if (!mistakesEl) return;
    mistakesEl.textContent = `Mistakes: ${mistakesCount}`;
    if (animate) {
      animateMistakesCounter();
      sfx.resume();
      sfx.playError();
    }
  }

  /* -----------------------------
     Init
     ----------------------------- */
  function init() {
    if (boardEl) ensureBoardDOM();
    if (digitBankEl) ensureDigitBankDOM();

    renderFromModel();
    wireUI();
    renderLeaderboard();

    const saved = localStorage.getItem(LS_KEYS.SAVED);
    if (saved) {
      startNewGame(selDifficulty ? selDifficulty.value : 'medium');
    } else {
      startNewGame(selDifficulty ? selDifficulty.value : 'medium');
    }

    setTimeout(() => setMessage('Klik kotak, lalu pilih angka di bar bawah. Double-click untuk pencil.'), 1200);
  }

  /* -----------------------------
     Debug helpers
     ----------------------------- */
  window._sudoku = {
    getGrid: () => grid,
    getNumbers: () => gridToNumbers(grid),
    getSolution: () => solutionGrid,
    generatePuzzle,
    solveSudoku,
    setPencil,
    getMistakes: () => mistakesCount,
    sfx // expose for console control (e.g., _sudoku.sfx.setVolume(0.05))
  };

  // Run init on DOMContentLoaded
  document.addEventListener('DOMContentLoaded', init);

})();
