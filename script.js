/* ==========================================================================
   Sudoku — script.js
   - Integrates with the provided index.html & style.css
   - No manual typing into cells (inputs are readonly). Use digit-bank / erase.
   - Auto-check on every placement; Check button removed from UI.
   ========================================================================== */

(function () {
  'use strict';

  /* -----------------------------
     DOM selectors
     ----------------------------- */
  const SEL = {
    board: '#sudoku-board',
    template: '#cell-template',
    newGame: '#new-game',
    solve: '#solve',
    reset: '#reset',
    difficulty: '#difficulty',
    timer: '#timer',
    message: '#message',
    togglePencil: '#toggle-pencil',
    toggleTheme: '#toggle-theme',
    save: '#save-progress',
    load: '#load-progress',
    leaderList: '#leader-list',
    digitBank: '#digit-bank',
    eraseBtn: '#erase-btn'
  };

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  const boardEl = $(SEL.board);
  const tpl = $(SEL.template);
  const btnNew = $(SEL.newGame);
  const btnSolve = $(SEL.solve);
  const btnReset = $(SEL.reset);
  const selDifficulty = $(SEL.difficulty);
  const timerEl = $(SEL.timer);
  const messageEl = $(SEL.message);
  const togglePencilBtn = $(SEL.togglePencil);
  const toggleThemeBtn = $(SEL.toggleTheme);
  const btnSave = $(SEL.save);
  const btnLoad = $(SEL.load);
  const leaderList = $(SEL.leaderList);
  const digitBank = $(SEL.digitBank);
  const eraseBtn = $(SEL.eraseBtn);

  /* -----------------------------
     Data model
     ----------------------------- */
  // cell: { value: number|null, given: boolean, notes: Set<number> }
  let grid = createEmptyGrid();
  let initialGrid = null;
  let solutionGrid = null;
  let selected = null; // {r,c}
  let pencilMode = false;
  let timerInterval = null;
  let elapsed = 0;

  const LS_KEYS = { SAVED: 'sudoku_saved_v2', LEAD: 'sudoku_lead_v2' };

  /* Difficulty clues */
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

  function gridToNumbers(g) {
    return g.map(row => row.map(cell => (cell.value === null ? 0 : cell.value)));
  }

  function numbersToModel(nums) {
    return nums.map(row => row.map(v => ({ value: v === 0 ? null : v, given: v !== 0, notes: new Set() })));
  }

  function deepCopyNumbers(nums) {
    return nums.map(r => r.slice());
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function posToBox(r, c) {
    return Math.floor(r / 3) * 3 + Math.floor(c / 3);
  }

  function formatTime(s) {
    const mm = String(Math.floor(s / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    return `${mm}:${ss}`;
  }

  function setMessage(txt, ms = 2500) {
    if (!messageEl) return;
    messageEl.textContent = txt;
    if (ms > 0) setTimeout(() => { if (messageEl.textContent === txt) messageEl.textContent = ''; }, ms);
  }

  /* -----------------------------
     Render / DOM
     ----------------------------- */
  function buildBoardDOM() {
    boardEl.innerHTML = '';
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const wrapper = document.createElement('div');
        wrapper.className = 'cell-wrapper';
        wrapper.dataset.row = r;
        wrapper.dataset.col = c;
        wrapper.dataset.box = posToBox(r, c);
        wrapper.setAttribute('role', 'gridcell');

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'cell';
        input.autocomplete = 'off';
        input.inputMode = 'none'; // intentionally block numeric softkeyboard
        input.readOnly = true; // prevent manual typing
        input.setAttribute('aria-label', `Cell ${r + 1}-${c + 1}`);
        input.value = '';

        const notes = document.createElement('div');
        notes.className = 'notes';
        notes.setAttribute('aria-hidden', 'true');
        for (let n = 1; n <= 9; n++) {
          const nd = document.createElement('div');
          nd.className = 'note';
          nd.dataset.n = n;
          nd.textContent = '';
          notes.appendChild(nd);
        }

        wrapper.appendChild(input);
        wrapper.appendChild(notes);
        attachCellListeners(wrapper, input);
        boardEl.appendChild(wrapper);
      }
    }
  }

  function renderFromModel() {
    const wrappers = Array.from(boardEl.children);
    wrappers.forEach(w => {
      const r = +w.dataset.row;
      const c = +w.dataset.col;
      const cell = grid[r][c];
      const input = w.querySelector('.cell');
      const notes = w.querySelectorAll('.note');

      if (cell.value !== null) {
        input.value = String(cell.value);
        w.classList.add('has-value');
      } else {
        input.value = '';
        w.classList.remove('has-value');
      }

      if (cell.given) {
        input.classList.add('given');
        input.setAttribute('readonly', 'readonly');
        input.tabIndex = -1;
      } else {
        input.classList.remove('given');
        input.removeAttribute('readonly');
        input.tabIndex = 0;
      }

      // notes
      notes.forEach(nd => {
        const n = Number(nd.dataset.n);
        nd.textContent = cell.notes.has(n) ? n : '';
      });

      // clear feedback classes
      input.classList.remove('invalid', 'correct', 'highlight');
      w.classList.remove('highlight-row', 'highlight-col', 'highlight-block');
    });

    // highlight selection if exists
    if (selected) updateHighlights(selected.r, selected.c);

    // update digit counts
    updateDigitCounts();
    timerEl.textContent = formatTime(elapsed);
  }

  /* -----------------------------
     Cell listeners
     ----------------------------- */
  function attachCellListeners(wrapper, input) {
    wrapper.addEventListener('click', () => {
      const r = +wrapper.dataset.row;
      const c = +wrapper.dataset.col;
      selectCell(r, c);
      input.focus({ preventScroll: true });
    });

    wrapper.addEventListener('dblclick', () => {
      // convenient toggle pencil
      setPencil(!pencilMode);
      setMessage(`Pencil ${pencilMode ? 'ON' : 'OFF'}`, 900);
    });

    input.addEventListener('focus', () => {
      const r = +wrapper.dataset.row;
      const c = +wrapper.dataset.col;
      selectCell(r, c);
    });

    input.addEventListener('blur', () => {
      // delay clear highlights if nothing else focused inside board
      setTimeout(() => {
        if (!document.activeElement || !boardEl.contains(document.activeElement)) {
          // keep selection but remove keyboard focus visuals
        }
      }, 50);
    });
  }

  function clearHighlights() {
    $$('.cell-wrapper').forEach(w => {
      w.classList.remove('highlight-row', 'highlight-col', 'highlight-block', 'highlight');
      const inp = w.querySelector('.cell');
      inp.classList.remove('highlight');
    });
  }

  function updateHighlights(r, c) {
    clearHighlights();
    const box = posToBox(r, c);
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
      w.querySelector('.cell').classList.add('highlight');
    }
  }

  function selectCell(r, c) {
    // ignore selecting given cells? still allow selection to view.
    selected = { r, c };
    updateHighlights(r, c);
  }

  function getWrapper(r, c) {
    return boardEl.querySelector(`.cell-wrapper[data-row="${r}"][data-col="${c}"]`);
  }

  /* -----------------------------
     Model ops: set value / toggle note / erase
     ----------------------------- */
  function setValueAt(r, c, val, options = {}) {
    if (!inRange(r, c)) return;
    const cell = grid[r][c];
    if (cell.given) return;
    if (val === null) {
      cell.value = null;
    } else {
      cell.value = val;
      cell.notes.clear();
    }
    renderFromModel();
    autoCheckAndPostProcess();
    maybeSolved();
  }

  function toggleNoteAt(r, c, n) {
    if (!inRange(r, c)) return;
    const cell = grid[r][c];
    if (cell.given) return;
    if (cell.value !== null) return;
    if (cell.notes.has(n)) cell.notes.delete(n);
    else cell.notes.add(n);
    renderFromModel();
  }

  function eraseAt(r, c) {
    if (!inRange(r, c)) return;
    const cell = grid[r][c];
    if (cell.given) return;
    cell.value = null;
    cell.notes.clear();
    renderFromModel();
  }

  function inRange(r, c) {
    return r >= 0 && r < 9 && c >= 0 && c < 9;
  }

  /* -----------------------------
     Auto-check: mark conflicts visually
     ----------------------------- */
  function autoCheckAndPostProcess() {
    // compute numbers grid
    const nums = gridToNumbers(grid);
    // clear all invalids first
    $$('.cell').forEach(i => i.classList.remove('invalid'));
    // check each filled cell
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const v = nums[r][c];
        if (v === 0) continue;
        nums[r][c] = 0; // remove temporarily
        if (!isValidPlacement(nums, r, c, v)) {
          const wrapper = getWrapper(r, c);
          if (wrapper) wrapper.querySelector('.cell').classList.add('invalid');
        }
        nums[r][c] = v; // restore
      }
    }
  }

  function isValidPlacement(numbers, r, c, num) {
    for (let i = 0; i < 9; i++) {
      if (numbers[r][i] === num) return false;
      if (numbers[i][c] === num) return false;
    }
    const br = Math.floor(r / 3) * 3;
    const bc = Math.floor(c / 3) * 3;
    for (let rr = br; rr < br + 3; rr++) {
      for (let cc = bc; cc < bc + 3; cc++) {
        if (numbers[rr][cc] === num) return false;
      }
    }
    return true;
  }

  /* -----------------------------
     Solver & generator (backtracking)
     ----------------------------- */
  function solveSudoku(numbers) {
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
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
      for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
          if (nums[r][c] === 0) {
            const candidates = shuffle([1,2,3,4,5,6,7,8,9].slice());
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
      }
      return true;
    }
    fill();
    return nums;
  }

  function generatePuzzle(difficulty = 'medium') {
    setMessage('Generating puzzle...');
    const solution = generateFullSolution();
    const puzzle = deepCopyNumbers(solution);
    const diff = DIFF[difficulty] || DIFF.medium;
    const target = Math.floor(Math.random() * (diff.maxClues - diff.minClues + 1)) + diff.minClues;

    const coords = [];
    for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) coords.push({ r, c });
    shuffle(coords);

    let currentClues = 81;
    let i = 0;
    while (currentClues > target && i < coords.length) {
      const { r, c } = coords[i++];
      const backup = puzzle[r][c];
      puzzle[r][c] = 0;
      const copy = puzzle.map(rr => rr.slice());
      const solCount = countSolutions(copy, 2);
      if (solCount !== 1) {
        puzzle[r][c] = backup; // revert
      } else {
        currentClues--;
      }
    }
    setMessage('', 50);
    return { puzzle, solution };
  }

  /* -----------------------------
     Public actions
     ----------------------------- */
  function startNewGame(difficulty = 'medium') {
    stopTimer();
    setMessage('Preparing new puzzle — please wait...', 3000);
    setTimeout(() => {
      const { puzzle, solution } = generatePuzzle(difficulty);
      grid = numbersToModel(puzzle);
      initialGrid = cloneGridModel(grid);
      solutionGrid = deepCopyNumbers(solution);
      elapsed = 0;
      renderFromModel();
      startTimer();
      setMessage(`New ${difficulty} puzzle ready. Use digit-bank to fill.`, 2200);
    }, 50);
  }

  function cloneGridModel(g) {
    return g.map(row => row.map(cell => ({ value: cell.value, given: cell.given, notes: new Set(Array.from(cell.notes)) })));
  }

  function resetToInitial() {
    if (!initialGrid) return;
    stopTimer();
    grid = cloneGridModel(initialGrid);
    elapsed = 0;
    renderFromModel();
    startTimer();
    setMessage('Reset to initial puzzle.');
  }

  function solveInstant() {
    if (!solutionGrid) return;
    stopTimer();
    for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
      grid[r][c].value = solutionGrid[r][c];
      grid[r][c].notes.clear();
    }
    renderFromModel();
    setMessage('Puzzle solved.');
    maybeSolved(true);
  }

  /* -----------------------------
     Timer
     ----------------------------- */
  function startTimer() {
    stopTimer();
    timerInterval = setInterval(() => {
      elapsed++;
      timerEl.textContent = formatTime(elapsed);
    }, 1000);
  }

  function stopTimer() {
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  }

  /* -----------------------------
     Save / Load
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
    const payload = {
      grid,
      solutionGrid,
      elapsed,
      difficulty: selDifficulty.value,
      timestamp: Date.now()
    };
    try {
      localStorage.setItem(LS_KEYS.SAVED, JSON.stringify(payload, replacer));
      setMessage('Game saved locally.');
    } catch (err) {
      console.error(err);
      setMessage('Failed to save.');
    }
  }

  function loadProgress() {
    const raw = localStorage.getItem(LS_KEYS.SAVED);
    if (!raw) { setMessage('No saved game.'); return; }
    try {
      const obj = JSON.parse(raw, reviver);
      // reconstruct grid model (ensure sets)
      grid = obj.grid.map(row => row.map(cell => ({ value: cell.value === null ? null : cell.value, given: !!cell.given, notes: (cell.notes instanceof Set) ? new Set(Array.from(cell.notes)) : new Set() })));
      initialGrid = cloneGridModel(grid);
      solutionGrid = obj.solutionGrid ? deepCopyNumbers(obj.solutionGrid) : null;
      elapsed = obj.elapsed || 0;
      renderFromModel();
      startTimer();
      setMessage('Saved game loaded.');
    } catch (err) {
      console.error(err);
      setMessage('Failed to load save.');
    }
  }

  /* -----------------------------
     Leaderboard (local)
     ----------------------------- */
  function recordCompletion() {
    const raw = localStorage.getItem(LS_KEYS.LEAD);
    const arr = raw ? JSON.parse(raw) : [];
    arr.push({ time: elapsed, difficulty: selDifficulty.value, date: new Date().toISOString() });
    arr.sort((a,b)=>a.time-b.time);
    localStorage.setItem(LS_KEYS.LEAD, JSON.stringify(arr.slice(0,10)));
    renderLeaderboard();
  }

  function renderLeaderboard() {
    const raw = localStorage.getItem(LS_KEYS.LEAD);
    const arr = raw ? JSON.parse(raw) : [];
    leaderList.innerHTML = '';
    arr.forEach(it => {
      const li = document.createElement('li');
      li.textContent = `${formatTime(it.time)} — ${it.difficulty} — ${new Date(it.date).toLocaleString()}`;
      leaderList.appendChild(li);
    });
  }

  /* -----------------------------
     Completion check
     ----------------------------- */
  function maybeSolved(quiet = false) {
    // quick check: any zeros?
    const nums = gridToNumbers(grid);
    for (let r=0;r<9;r++) for (let c=0;c<9;c++) if (nums[r][c] === 0) return false;
    // validate full solution
    const copy = deepCopyNumbers(nums);
    if (solveSudoku(copy)) {
      stopTimer();
      if (!quiet) setMessage(`Solved in ${formatTime(elapsed)}!`);
      recordCompletion();
      return true;
    } else {
      // some conflict
      autoCheckAndPostProcess();
      return false;
    }
  }

  /* -----------------------------
     Digit bank handlers
     ----------------------------- */
  function updateDigitCounts(animate = false) {
    const counts = Array(10).fill(9);
    const nums = gridToNumbers(grid);
    for (let r=0;r<9;r++) for (let c=0;c<9;c++){
      const v = nums[r][c];
      if (v >=1 && v <=9) counts[v]--;
    }
    const btns = digitBank.querySelectorAll('.digit-btn');
    btns.forEach(b=>{
      const d = Number(b.dataset.digit);
      const span = b.querySelector('.count');
      if (span) {
        span.textContent = String(Math.max(0, counts[d]));
        if (animate) {
          span.classList.remove('count-update');
          // force reflow
          void span.offsetWidth;
          span.classList.add('count-update');
        }
      }
      b.disabled = counts[d] <= 0;
      b.setAttribute('aria-disabled', b.disabled ? 'true' : 'false');
    });
  }

  function handleDigitPress(d) {
    if (!selected) { setMessage('Pilih sebuah kotak dulu.'); return; }
    const { r, c } = selected;
    const cell = grid[r][c];
    if (cell.given) { setMessage('Kotak ini adalah given — tidak bisa diubah.'); return; }
    if (pencilMode) {
      toggleNoteAt(r, c, d);
    } else {
      setValueAt(r, c, d);
      // update digit counts animate
      updateDigitCounts(true);
    }
  }

  function handleErase() {
    if (!selected) { setMessage('Pilih sebuah kotak dulu.'); return; }
    const { r, c } = selected;
    eraseAt(r, c);
    updateDigitCounts(true);
  }

  /* -----------------------------
     Keyboard navigation (NO numeric typing)
     ----------------------------- */
  document.addEventListener('keydown', (e) => {
    if (!selected) return;
    const { r, c } = selected;
    if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) {
      e.preventDefault();
      let nr = r, nc = c;
      if (e.key === 'ArrowUp') nr = (r + 8) % 9;
      if (e.key === 'ArrowDown') nr = (r + 1) % 9;
      if (e.key === 'ArrowLeft') nc = (c + 8) % 9;
      if (e.key === 'ArrowRight') nc = (c + 1) % 9;
      selectCell(nr, nc);
      const w = getWrapper(nr, nc);
      if (w) w.querySelector('.cell').focus({preventScroll:true});
    } else if (e.key === 'Escape') {
      selected = null;
      clearHighlights();
      document.activeElement && document.activeElement.blur();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      // allow erase via keyboard for convenience
      e.preventDefault();
      handleErase();
    }
  });

  /* -----------------------------
     UI wiring
     ----------------------------- */
  function wireUI() {
    btnNew.addEventListener('click', ()=> startNewGame(selDifficulty.value));
    btnReset.addEventListener('click', resetToInitial);
    btnSolve.addEventListener('click', ()=> {
      if (confirm('Selesaikan papan sekarang?')) solveInstant();
    });

    togglePencilBtn.addEventListener('click', ()=> {
      setPencil(!pencilMode);
      setMessage(`Pencil ${pencilMode ? 'ON' : 'OFF'}`, 900);
    });

    toggleThemeBtn.addEventListener('click', ()=> {
      const root = document.documentElement;
      const isDark = root.getAttribute('data-theme') === 'dark' || root.classList.contains('dark');
      if (isDark) {
        root.removeAttribute('data-theme');
        root.classList.remove('dark');
        toggleThemeBtn.setAttribute('aria-pressed','false');
      } else {
        root.setAttribute('data-theme','dark');
        toggleThemeBtn.setAttribute('aria-pressed','true');
      }
    });

    btnSave.addEventListener('click', saveProgress);
    btnLoad.addEventListener('click', loadProgress);

    // digit-bank delegation
    digitBank.addEventListener('click', (e) => {
      const btn = e.target.closest('.digit-btn');
      if (btn && !btn.disabled) {
        const d = Number(btn.dataset.digit);
        handleDigitPress(d);
      }
      if (e.target.closest('#erase-btn')) {
        handleErase();
      }
    });
  }

  function setPencil(flag) {
    pencilMode = !!flag;
    togglePencilBtn.setAttribute('aria-pressed', pencilMode ? 'true' : 'false');
    togglePencilBtn.classList.toggle('active', pencilMode);
  }

  /* -----------------------------
     Initialization
     ----------------------------- */
  function init() {
    buildBoardDOM();
    renderFromModel();
    wireUI();
    renderLeaderboard();

    // Try to load saved game; otherwise create a new one
    const saved = localStorage.getItem(LS_KEYS.SAVED);
    if (saved) {
      // don't auto-load — offer to user via load button; create new puzzle
      startNewGame(selDifficulty.value);
    } else {
      startNewGame(selDifficulty.value);
    }

    // slight accessibility hint
    setTimeout(()=> setMessage('Klik kotak, lalu pilih angka di bar bawah. Double-click untuk pencil.'), 1500);
  }

  /* -----------------------------
     Expose some helpers for debugging
     ----------------------------- */
  window._sudoku = {
    getGrid: () => grid,
    getNumbers: () => gridToNumbers(grid),
    getSolution: () => solutionGrid,
    generatePuzzle,
    solveSudoku,
    setPencil
  };

  // Start
  init();

})();
