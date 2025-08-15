/* ==========================================================================
   Sudoku — script.js (fixed & polished)
   - Robust, readable, and compatible with provided index.html + simple style.css
   - Features:
     * board render (readonly inputs)
     * generator + solver (backtracking)
     * digit-bank input & erase
     * pencil mode (notes)
     * auto-check with immediate highlighting of conflicting cells
     * mistake counter (counts each conflicted cell once until fixed)
     * timer, save/load, leaderboard (localStorage)
     * theme toggle wiring compatible with HTML
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
    eraseBtn: '#erase-btn',
    mistakes: '#mistakes'
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
  const mistakesEl = $(SEL.mistakes);

  /* -----------------------------
     State
     ----------------------------- */
  let grid = createEmptyGrid(); // model: 9x9 of { value, given, notes:Set }
  let initialGrid = null;
  let solutionGrid = null;
  let selected = null; // {r,c}
  let pencilMode = false;
  let timerInterval = null;
  let elapsed = 0;
  let mistakesCount = 0;

  // Track currently-invalid cells (so we don't increment mistakes repeatedly)
  // store as "r,c" string
  const invalidSet = new Set();

  const LS_KEYS = { SAVED: 'sudoku_saved_v3', LEAD: 'sudoku_lead_v3' };

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

  function cloneGridModel(g) {
    return g.map(row => row.map(cell => ({ value: cell.value, given: !!cell.given, notes: new Set(Array.from(cell.notes || [])) })));
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

  function inRange(r, c) {
    return r >= 0 && r < 9 && c >= 0 && c < 9;
  }

  function formatTime(s) {
    const mm = String(Math.floor(s / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    return `${mm}:${ss}`;
  }

  function setMessage(txt = '', ms = 2500) {
    if (!messageEl) return;
    messageEl.textContent = txt;
    if (ms > 0) setTimeout(() => { if (messageEl.textContent === txt) messageEl.textContent = ''; }, ms);
  }

  /* -----------------------------
     Rendering
     ----------------------------- */
  function buildBoardDOM() {
    if (!boardEl) return;
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
        input.inputMode = 'none'; // prevent mobile numeric keyboard
        input.readOnly = true;
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
    if (!boardEl) return;

    // show mistakes element if hidden
    if (mistakesEl && mistakesEl.classList.contains('hidden')) mistakesEl.classList.remove('hidden');

    const wrappers = Array.from(boardEl.children);
    wrappers.forEach(w => {
      const r = +w.dataset.row;
      const c = +w.dataset.col;
      const cell = grid[r][c];
      const input = w.querySelector('.cell');
      const notes = w.querySelectorAll('.note');

      // value
      if (cell.value !== null) {
        input.value = String(cell.value);
        w.classList.add('has-value');
      } else {
        input.value = '';
        w.classList.remove('has-value');
      }

      // given
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

      // clear transient classes; autoCheck will re-add .invalid
      input.classList.remove('correct', 'highlight');
      w.classList.remove('highlight-row', 'highlight-col', 'highlight-block');
    });

    // highlight selected
    if (selected) updateHighlights(selected.r, selected.c);

    updateDigitCounts();
    timerEl && (timerEl.textContent = formatTime(elapsed));
    updateMistakesUI();
  }

  /* -----------------------------
     Cell interactions
     ----------------------------- */
  function attachCellListeners(wrapper, input) {
    wrapper.addEventListener('click', () => {
      const r = +wrapper.dataset.row;
      const c = +wrapper.dataset.col;
      selectCell(r, c);
      input.focus({ preventScroll: true });
    });

    wrapper.addEventListener('dblclick', () => {
      setPencil(!pencilMode);
      setMessage(`Pencil ${pencilMode ? 'ON' : 'OFF'}`, 900);
    });

    input.addEventListener('focus', () => {
      const r = +wrapper.dataset.row;
      const c = +wrapper.dataset.col;
      selectCell(r, c);
    });
  }

  function clearHighlights() {
    $$('.cell-wrapper').forEach(w => {
      w.classList.remove('highlight-row', 'highlight-col', 'highlight-block', 'highlight');
      const inp = w.querySelector('.cell');
      inp && inp.classList.remove('highlight');
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
      const inp = w.querySelector('.cell');
      inp && inp.classList.add('highlight');
    }
  }

  function selectCell(r, c) {
    selected = { r, c };
    updateHighlights(r, c);
  }

  function getWrapper(r, c) {
    if (!boardEl) return null;
    return boardEl.querySelector(`.cell-wrapper[data-row="${r}"][data-col="${c}"]`);
  }

  /* -----------------------------
     Model operations
     ----------------------------- */
  function setValueAt(r, c, val) {
    if (!inRange(r, c)) return;
    const cell = grid[r][c];
    if (cell.given) return;
    if (val === null) {
      cell.value = null;
    } else {
      cell.value = val;
      cell.notes.clear();
    }

    // Render first so UI updates before animations
    renderFromModel();

    // Evaluate conflicts resulting from this placement
    const conflicts = findConflictsForCell(r, c);

    if (conflicts.length > 0) {
      // Mark placed cell and conflicts as invalid; increment mistakes for any newly-invalid cells
      const newlyInvalid = [];

      const placedKey = `${r},${c}`;
      if (!invalidSet.has(placedKey)) {
        newlyInvalid.push(placedKey);
        invalidSet.add(placedKey);
      }

      for (const { r: cr, c: cc } of conflicts) {
        const key = `${cr},${cc}`;
        if (!invalidSet.has(key)) {
          newlyInvalid.push(key);
          invalidSet.add(key);
        }
      }

      // Apply visual invalid + animate for all newlyInvalid cells
      newlyInvalid.forEach(key => {
        const [rr, cc] = key.split(',').map(Number);
        const w = getWrapper(rr, cc);
        if (w) {
          const inp = w.querySelector('.cell');
          inp && inp.classList.add('invalid');
          animateInvalid(w);
        }
      });

      // Increase mistakesCount by number of newlyInvalid cells (but you may prefer counting placed cell only)
      if (newlyInvalid.length > 0) {
        mistakesCount += newlyInvalid.length;
        updateMistakesUI(true);
      }
    } else {
      // No conflicts for placed value: run a global auto-check to clear any stale invalids
      autoCheckAndPostProcess();
    }

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
    // Before erase: if this cell was invalid, remove from invalidSet and decrement mistakes accordingly
    const key = `${r},${c}`;
    if (invalidSet.has(key)) {
      invalidSet.delete(key);
      // deduct one mistake (keep floor at 0)
      mistakesCount = Math.max(0, mistakesCount - 1);
    }

    cell.value = null;
    cell.notes.clear();
    renderFromModel();
    // After erase evaluate remaining conflicts globally and sync invalidSet accordingly
    autoCheckAndPostProcess();
  }

  /* -----------------------------
     Conflict detection
     ----------------------------- */
  function findConflictsForCell(r, c) {
    const val = grid[r][c].value;
    if (!val) return [];
    const conflicts = [];

    // row
    for (let i = 0; i < 9; i++) {
      if (i !== c && grid[r][i].value === val) conflicts.push({ r, c: i });
    }
    // column
    for (let i = 0; i < 9; i++) {
      if (i !== r && grid[i][c].value === val) conflicts.push({ r: i, c });
    }
    // box
    const br = Math.floor(r / 3) * 3;
    const bc = Math.floor(c / 3) * 3;
    for (let rr = br; rr < br + 3; rr++) {
      for (let cc = bc; cc < bc + 3; cc++) {
        if ((rr !== r || cc !== c) && grid[rr][cc].value === val) {
          // avoid dup
          if (!conflicts.some(x => x.r === rr && x.c === cc)) conflicts.push({ r: rr, c: cc });
        }
      }
    }
    return conflicts;
  }

  function autoCheckAndPostProcess() {
    // Recompute all conflicts, sync DOM & invalidSet
    // Clear previous invalid marks in DOM
    $$('.cell').forEach(i => i.classList.remove('invalid'));

    // We'll recompute which cells are currently invalid and synchronize invalidSet
    const currentlyInvalid = new Set();
    const nums = gridToNumbers(grid);

    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const v = nums[r][c];
        if (v === 0) continue;
        nums[r][c] = 0;
        if (!isValidPlacement(nums, r, c, v)) {
          const w = getWrapper(r, c);
          if (w) w.querySelector('.cell').classList.add('invalid');
          currentlyInvalid.add(`${r},${c}`);
        }
        nums[r][c] = v;
      }
    }

    // Now sync invalidSet vs currentlyInvalid:
    // - any keys in invalidSet but not in currentlyInvalid: remove from invalidSet
    // - any keys in currentlyInvalid but not in invalidSet: add to invalidSet (do NOT increment mistakes here — only count on user placement)
    for (const key of Array.from(invalidSet)) {
      if (!currentlyInvalid.has(key)) invalidSet.delete(key);
    }
    for (const key of currentlyInvalid) {
      if (!invalidSet.has(key)) {
        // Add silently (don't increment mistakes) — this keeps invalidSet accurate in case outside changes
        invalidSet.add(key);
      }
    }

    // Update mistakes UI to reflect current mistakesCount value (which we track separately)
    updateMistakesUI();
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
     Animations
     ----------------------------- */
  function animateInvalid(wrapper) {
    const input = wrapper.querySelector('.cell');
    if (!input) return;
    try {
      input.animate([
        { transform: 'translateX(0)', boxShadow: 'none' },
        { transform: 'translateX(-6px)', boxShadow: '0 6px 18px rgba(239,68,68,0.08)' },
        { transform: 'translateX(4px)' },
        { transform: 'translateX(0)' }
      ], { duration: 520, easing: 'cubic-bezier(.36,.07,.19,.97)' });
    } catch (e) {
      // ignore if WAAPI not supported
    }
  }

  function animateMistakesCounter() {
    if (!mistakesEl) return;
    try {
      mistakesEl.animate([
        { transform: 'scale(1)', color: getComputedStyle(document.documentElement).getPropertyValue('--text') || '#000' },
        { transform: 'scale(1.06)', color: getComputedStyle(document.documentElement).getPropertyValue('--danger') || '#ef4444' },
        { transform: 'scale(1)', color: getComputedStyle(document.documentElement).getPropertyValue('--text') || '#000' }
      ], { duration: 420, easing: 'cubic-bezier(.2,.9,.2,1)'});
    } catch (e) {}
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
    setMessage('Preparing new puzzle — please wait...', 2500);
    setTimeout(() => {
      const { puzzle, solution } = generatePuzzle(difficulty);
      grid = numbersToModel(puzzle);
      initialGrid = cloneGridModel(grid);
      solutionGrid = deepCopyNumbers(solution);
      elapsed = 0;
      mistakesCount = 0;
      invalidSet.clear();
      renderFromModel();
      startTimer();
      setMessage(`New ${difficulty} puzzle ready. Use digit-bank to fill.`, 2000);
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
      timerEl && (timerEl.textContent = formatTime(elapsed));
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
    try {
      const payload = { grid, solutionGrid, elapsed, difficulty: selDifficulty.value, timestamp: Date.now() };
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
      grid = obj.grid.map(row => row.map(cell => ({ value: cell.value === null ? null : cell.value, given: !!cell.given, notes: (cell.notes instanceof Set) ? new Set(Array.from(cell.notes)) : new Set() })));
      initialGrid = cloneGridModel(grid);
      solutionGrid = obj.solutionGrid ? deepCopyNumbers(obj.solutionGrid) : null;
      elapsed = obj.elapsed || 0;
      mistakesCount = 0;
      invalidSet.clear();
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
     Completion detection
     ----------------------------- */
  function maybeSolved(quiet = false) {
    const nums = gridToNumbers(grid);
    for (let r=0;r<9;r++) for (let c=0;c<9;c++) if (nums[r][c] === 0) return false;
    const copy = deepCopyNumbers(nums);
    if (solveSudoku(copy)) {
      stopTimer();
      if (!quiet) setMessage(`Solved in ${formatTime(elapsed)}!`);
      recordCompletion();
      return true;
    } else {
      autoCheckAndPostProcess();
      return false;
    }
  }

  /* -----------------------------
     Digit bank handlers
     ----------------------------- */
  function updateDigitCounts(animate = false) {
    if (!digitBank) return;
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
        if (animate && span.textContent !== String(Math.max(0, counts[d]))) {
          span.classList.remove('count-update'); void span.offsetWidth; span.classList.add('count-update');
        }
        span.textContent = String(Math.max(0, counts[d]));
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
     Keyboard navigation & input (arrow keys, digits, backspace)
     ----------------------------- */
  document.addEventListener('keydown', (e) => {
    // Allow digit entry from real keyboard (convenience)
    if (!selected && !(e.key >= '1' && e.key <= '9')) return;
    const { r, c } = selected || {};
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
      selected = null; clearHighlights(); document.activeElement && document.activeElement.blur();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault(); handleErase();
    } else if (e.key >= '1' && e.key <= '9') {
      e.preventDefault();
      handleDigitPress(Number(e.key));
    }
  });

  /* -----------------------------
     UI wiring
     ----------------------------- */
  function wireUI() {
    if (btnNew) btnNew.addEventListener('click', ()=> startNewGame(selDifficulty.value));
    if (btnReset) btnReset.addEventListener('click', resetToInitial);
    if (btnSolve) btnSolve.addEventListener('click', ()=> {
      if (confirm('Selesaikan papan sekarang?')) solveInstant();
    });

    if (togglePencilBtn) togglePencilBtn.addEventListener('click', ()=> {
      setPencil(!pencilMode);
      setMessage(`Pencil ${pencilMode ? 'ON' : 'OFF'}`, 900);
    });

    if (toggleThemeBtn) toggleThemeBtn.addEventListener('click', ()=> {
      const root = document.documentElement;
      const isDark = root.getAttribute('data-theme') === 'dark' || root.classList.contains('dark');
      if (isDark) {
        root.removeAttribute('data-theme'); root.classList.remove('dark'); toggleThemeBtn.setAttribute('aria-pressed','false');
      } else {
        root.setAttribute('data-theme','dark'); toggleThemeBtn.setAttribute('aria-pressed','true');
      }
    });

    if (btnSave) btnSave.addEventListener('click', saveProgress);
    if (btnLoad) btnLoad.addEventListener('click', loadProgress);

    if (digitBank) {
      digitBank.addEventListener('click', (e) => {
        const btn = e.target.closest('.digit-btn');
        if (btn && !btn.disabled) {
          const d = Number(btn.dataset.digit);
          handleDigitPress(d);
        }
        if (e.target.closest('#erase-btn')) handleErase();
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

  /* -----------------------------
     Mistakes UI sync
     ----------------------------- */
  function updateMistakesUI(animate = false) {
    if (!mistakesEl) return;
    if (mistakesEl.classList.contains('hidden')) mistakesEl.classList.remove('hidden');
    mistakesEl.textContent = `Mistakes: ${mistakesCount}`;
    if (animate) animateMistakesCounter();
  }

  /* -----------------------------
     Init
     ----------------------------- */
  function init() {
    buildBoardDOM();
    renderFromModel();
    wireUI();
    renderLeaderboard();

    // Start new game by default
    startNewGame(selDifficulty ? selDifficulty.value : 'medium');

    setTimeout(()=> setMessage('Klik kotak, lalu pilih angka di bar bawah. Double-click untuk pencil.'), 1200);
  }

  /* -----------------------------
     Expose debug helpers
     ----------------------------- */
  window._sudoku = {
    getGrid: () => grid,
    getNumbers: () => gridToNumbers(grid),
    getSolution: () => solutionGrid,
    generatePuzzle,
    solveSudoku,
    setPencil,
    getMistakes: () => mistakesCount
  };

  // Run
  init();

})();
