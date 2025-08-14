/* ==========================================================================
   Sudoku — script.js
   - Integrates with index.html and style.css from previous files
   - Responsibilities:
     * Render 9x9 board
     * Generate puzzles (with unique-solution check)
     * Solve puzzles (backtracking)
     * UI interactions: input, keyboard, pencil mode, highlights
     * Timer, mistakes, save/load, leaderboard
   ========================================================================== */

(function () {
  'use strict';

  /* -----------------------------
     Config / DOM pointers
     ----------------------------- */
  const SELECTORS = {
    board: '#sudoku-board',
    cellTemplate: '#cell-template',
    newGameBtn: '#new-game',
    checkBtn: '#check',
    solveBtn: '#solve',
    resetBtn: '#reset',
    difficulty: '#difficulty',
    timer: '#timer',
    mistakes: '#mistakes',
    togglePencil: '#toggle-pencil',
    toggleTheme: '#toggle-theme',
    message: '#message',
    saveBtn: '#save-progress',
    loadBtn: '#load-progress',
    leaderboard: '#leader-list',
    leaderboardPanel: '.leaderboard'
  };

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const boardEl = $(SELECTORS.board);
  const template = $(SELECTORS.cellTemplate);
  const newGameBtn = $(SELECTORS.newGameBtn);
  const checkBtn = $(SELECTORS.checkBtn);
  const solveBtn = $(SELECTORS.solveBtn);
  const resetBtn = $(SELECTORS.resetBtn);
  const difficultySel = $(SELECTORS.difficulty);
  const timerEl = $(SELECTORS.timer);
  const mistakesEl = $(SELECTORS.mistakes);
  const togglePencilBtn = $(SELECTORS.togglePencil);
  const toggleThemeBtn = $(SELECTORS.toggleTheme);
  const messageEl = $(SELECTORS.message);
  const saveBtn = $(SELECTORS.saveBtn);
  const loadBtn = $(SELECTORS.loadBtn);
  const leaderboardList = $(SELECTORS.leaderboard);

  /* -----------------------------
     Data model
     ----------------------------- */
  // grid: 9x9 array of cell objects { value: number|null, given: boolean, notes: Set<number> }
  let grid = createEmptyGrid();
  let initialGrid = null; // deep copy of puzzle at start for reset
  let solutionGrid = null; // full-solution 9x9 numbers
  let selectedCell = null; // { r, c }
  let pencilMode = false;
  let timerInterval = null;
  let elapsedSeconds = 0;
  let mistakes = 0;
  let solveAnimationTimer = null;
  let solvingAnimationInProgress = false;

  const LS_KEYS = {
    SAVED: 'sudoku_saved_v1',
    LEADER: 'sudoku_leader_v1'
  };

  /* -----------------------------
     Difficulty parameters
     ----------------------------- */
  const DIFFICULTY = {
    easy: { minClues: 40, maxClues: 50 },
    medium: { minClues: 30, maxClues: 35 },
    hard: { minClues: 25, maxClues: 28 },
  };

  /* -----------------------------
     Utilities
     ----------------------------- */
  function createEmptyGrid() {
    return Array.from({ length: 9 }, () =>
      Array.from({ length: 9 }, () => ({ value: null, given: false, notes: new Set() }))
    );
  }

  function deepCopyGridNumbers(gridNumbers) {
    return gridNumbers.map(row => row.slice());
  }

  function gridToNumbers(gridModel) {
    return gridModel.map(row => row.map(cell => (cell.value === null ? 0 : cell.value)));
  }

  function numbersToGridModel(numbers) {
    return numbers.map((row, r) =>
      row.map((val, c) => ({ value: val === 0 ? null : val, given: val !== 0, notes: new Set() }))
    );
  }

  function shuffleArray(arr) {
    // Fisher-Yates
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function posToBox(r, c) {
    return Math.floor(r / 3) * 3 + Math.floor(c / 3);
  }

  function formatTime(seconds) {
    const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
    const ss = String(seconds % 60).padStart(2, '0');
    return `${mm}:${ss}`;
  }

  function setMessage(text, delay = 3500) {
    if (!messageEl) return;
    messageEl.textContent = text;
    if (delay > 0) {
      setTimeout(() => {
        if (messageEl.textContent === text) messageEl.textContent = '';
      }, delay);
    }
  }

  /* -----------------------------
     Rendering DOM
     ----------------------------- */
  function buildBoardDOM() {
    boardEl.innerHTML = '';
    // Build 9x9 cell wrappers
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const wrapper = document.createElement('div');
        wrapper.className = 'cell-wrapper';
        wrapper.setAttribute('data-row', r);
        wrapper.setAttribute('data-col', c);
        wrapper.setAttribute('data-box', posToBox(r, c));
        wrapper.setAttribute('role', 'gridcell');
        wrapper.tabIndex = -1;

        // Input element
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'cell';
        input.setAttribute('inputmode', 'numeric');
        input.setAttribute('maxlength', '1');
        input.setAttribute('aria-label', `Cell ${r + 1}-${c + 1}`);
        input.autocomplete = 'off';
        input.value = '';

        // notes container (3x3)
        const notes = document.createElement('div');
        notes.className = 'notes';
        notes.setAttribute('aria-hidden', 'true');
        // nine placeholders
        for (let n = 1; n <= 9; n++) {
          const noteEl = document.createElement('div');
          noteEl.className = 'note';
          noteEl.dataset.n = String(n);
          noteEl.textContent = ''; // will fill when notes exist
          notes.appendChild(noteEl);
        }

        wrapper.appendChild(input);
        wrapper.appendChild(notes);

        // Event listeners per wrapper / input
        attachCellListeners(wrapper, input);

        boardEl.appendChild(wrapper);
      }
    }
  }

  function renderBoardFromModel() {
    // Walk DOM and reflect grid model
    const wrappers = Array.from(boardEl.children);
    wrappers.forEach((wrapper) => {
      const r = Number(wrapper.dataset.row);
      const c = Number(wrapper.dataset.col);
      const input = wrapper.querySelector('.cell');
      const notesEl = wrapper.querySelector('.notes');
      const cell = grid[r][c];

      // class on wrapper
      wrapper.classList.toggle('has-value', cell.value !== null);

      // set value and readonly for givens
      if (cell.value !== null) {
        input.value = String(cell.value);
      } else {
        input.value = '';
      }
      if (cell.given) {
        input.classList.add('given');
        input.setAttribute('readonly', 'readonly');
        input.setAttribute('aria-readonly', 'true');
        input.tabIndex = -1;
      } else {
        input.classList.remove('given');
        input.removeAttribute('readonly');
        input.removeAttribute('aria-readonly');
        input.tabIndex = 0;
      }

      // render notes
      const noteDivs = notesEl.querySelectorAll('.note');
      noteDivs.forEach((nd) => {
        const n = Number(nd.dataset.n);
        nd.textContent = cell.notes.has(n) ? n : '';
      });

      // clear state classes
      input.classList.remove('invalid', 'correct', 'highlight');
    });

    // update timer & mistakes UI
    timerEl.textContent = formatTime(elapsedSeconds);
    mistakesEl.textContent = `Mistakes: ${mistakes}`;
  }

  /* -----------------------------
     Event handlers: per-cell
     ----------------------------- */
  function attachCellListeners(wrapper, input) {
    // pointer focus
    wrapper.addEventListener('click', (e) => {
      const r = Number(wrapper.dataset.row);
      const c = Number(wrapper.dataset.col);
      focusCell(r, c);
      input.focus({ preventScroll: true });
    });

    // double click toggles pencil mode for that cell (quick note toggle hint)
    wrapper.addEventListener('dblclick', (e) => {
      const r = Number(wrapper.dataset.row);
      const c = Number(wrapper.dataset.col);
      // toggle pencil mode for convenience
      setPencilMode(!pencilMode);
      focusCell(r, c);
      setMessage(`Pencil mode ${pencilMode ? 'ON' : 'OFF'}`, 1200);
    });

    // input listener: typed value
    input.addEventListener('input', (e) => {
      if (solvingAnimationInProgress) return;
      const r = Number(wrapper.dataset.row);
      const c = Number(wrapper.dataset.col);
      const raw = input.value.replace(/[^\d]/g, '').slice(0, 1); // keep only one digit 1-9
      if (raw === '') {
        // user cleared
        setCellValue(r, c, null, { user: true });
        return;
      }
      const num = Number(raw);
      if (num < 1 || num > 9) {
        input.value = '';
        return;
      }
      if (pencilMode) {
        // toggle note instead of setting value
        toggleNote(r, c, num);
        // show notes in DOM; value cleared
        input.value = '';
      } else {
        // set as value
        setCellValue(r, c, num, { user: true });
      }
    });

    // keydown for navigation + backspace handling
    input.addEventListener('keydown', (e) => {
      const r = Number(wrapper.dataset.row);
      const c = Number(wrapper.dataset.col);

      // arrow keys to move selection
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
        const pos = movePos({ r, c }, e.key);
        focusCell(pos.r, pos.c);
        const nextWrapper = getWrapper(pos.r, pos.c);
        nextWrapper.querySelector('.cell').focus({ preventScroll: true });
        return;
      }

      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        if (grid[r][c].given) return; // can't change givens
        if (pencilMode) {
          // clear notes
          grid[r][c].notes.clear();
        } else {
          setCellValue(r, c, null, { user: true });
        }
        renderBoardFromModel();
        return;
      }

      // If user presses number keys while focused, allow them to type naturally (handled by input event)
      // But also support numpad keys (they will appear as digits usually)
    });

    // focus/blur for highlighting
    input.addEventListener('focus', () => {
      const r = Number(wrapper.dataset.row);
      const c = Number(wrapper.dataset.col);
      setSelectedCell(r, c);
    });
    input.addEventListener('blur', () => {
      // small delay to allow other focus events to process
      setTimeout(() => {
        if (!document.activeElement || !boardEl.contains(document.activeElement)) {
          clearHighlights();
        }
      }, 20);
    });
  }

  function movePos(pos, arrowKey) {
    let { r, c } = pos;
    if (arrowKey === 'ArrowUp') r = (r + 8) % 9;
    if (arrowKey === 'ArrowDown') r = (r + 1) % 9;
    if (arrowKey === 'ArrowLeft') c = (c + 8) % 9;
    if (arrowKey === 'ArrowRight') c = (c + 1) % 9;
    return { r, c };
  }

  function getWrapper(r, c) {
    return boardEl.querySelector(`.cell-wrapper[data-row="${r}"][data-col="${c}"]`);
  }

  function setSelectedCell(r, c) {
    selectedCell = { r, c };
    updateHighlights(r, c);
  }

  function focusCell(r, c) {
    const wrapper = getWrapper(r, c);
    if (!wrapper) return;
    const input = wrapper.querySelector('.cell');
    input.focus({ preventScroll: true });
    setSelectedCell(r, c);
  }

  function clearHighlights() {
    $$('.cell-wrapper').forEach(w => {
      w.classList.remove('highlight-row', 'highlight-col', 'highlight-block', 'highlight');
      const input = w.querySelector('.cell');
      input.classList.remove('highlight');
    });
  }

  function updateHighlights(r, c) {
    clearHighlights();
    const box = posToBox(r, c);
    $$('.cell-wrapper').forEach(w => {
      const rr = Number(w.dataset.row);
      const cc = Number(w.dataset.col);
      const b = Number(w.dataset.box);
      if (rr === r) w.classList.add('highlight-row');
      if (cc === c) w.classList.add('highlight-col');
      if (b === box) w.classList.add('highlight-block');
    });
    const wrapper = getWrapper(r, c);
    if (wrapper) {
      wrapper.classList.add('highlight');
      wrapper.querySelector('.cell').classList.add('highlight');
    }
  }

  /* -----------------------------
     Model manipulation
     ----------------------------- */
  function setCellValue(r, c, value, { user = false } = {}) {
    if (grid[r][c].given && user) {
      return; // can't overwrite givens
    }
    grid[r][c].value = value;
    // when setting a real value, clear notes
    if (value !== null) grid[r][c].notes.clear();
    // UI update
    renderBoardFromModel();
  }

  function toggleNote(r, c, n) {
    if (grid[r][c].value !== null) return; // if a value exists, don't add notes
    if (grid[r][c].notes.has(n)) grid[r][c].notes.delete(n);
    else grid[r][c].notes.add(n);
    renderBoardFromModel();
  }

  /* -----------------------------
     Sudoku logic: validation
     ----------------------------- */
  function isValidPlacement(numbers, r, c, num) {
    // numbers is 9x9 array of ints (0 for empty)
    // check row/col/box
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
     Solver: backtracking (single solution)
     - returns boolean (solved) and writes into numbers if solved
     ----------------------------- */
  function solveSudoku(numbers) {
    // find empty
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        if (numbers[r][c] === 0) {
          // try numbers 1..9
          for (let n = 1; n <= 9; n++) {
            if (isValidPlacement(numbers, r, c, n)) {
              numbers[r][c] = n;
              if (solveSudoku(numbers)) return true;
              numbers[r][c] = 0;
            }
          }
          return false; // no valid number
        }
      }
    }
    // no empty: solved
    return true;
  }

  /* -----------------------------
     Count solutions (used to ensure uniqueness)
     - stops early if more than `limit` solutions found (default 2)
     ----------------------------- */
  function countSolutions(numbers, limit = 2) {
    let count = 0;

    function backtrack() {
      if (count >= limit) return; // stop early
      // find empty
      let found = false;
      let er = -1, ec = -1;
      for (let r = 0; r < 9 && !found; r++) {
        for (let c = 0; c < 9; c++) {
          if (numbers[r][c] === 0) {
            found = true;
            er = r; ec = c;
            break;
          }
        }
      }
      if (!found) {
        count++;
        return;
      }
      // try digits in random-ish order could help, but basic order fine
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

  /* -----------------------------
     Generator: produce a full solution, then remove numbers per difficulty
     ----------------------------- */
  function generateFullSolution() {
    // start with empty numbers grid
    const numbers = Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => 0));

    // backtracking with randomized candidates
    function fill() {
      // find empty
      for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
          if (numbers[r][c] === 0) {
            const candidates = shuffleArray([1,2,3,4,5,6,7,8,9].slice());
            for (const n of candidates) {
              if (isValidPlacement(numbers, r, c, n)) {
                numbers[r][c] = n;
                if (fill()) return true;
                numbers[r][c] = 0;
              }
            }
            return false;
          }
        }
      }
      return true;
    }

    fill();
    return numbers; // fully filled
  }

  function generatePuzzle(difficulty = 'medium', progressCallback = null) {
    // Generate full solution
    const solution = generateFullSolution();
    // clone
    const puzzle = deepCopyGridNumbers(solution);

    // determine target clues
    const diff = DIFFICULTY[difficulty] || DIFFICULTY.medium;
    const targetClues = Math.floor(Math.random() * (diff.maxClues - diff.minClues + 1)) + diff.minClues;

    // coordinates list randomized
    const cells = [];
    for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) cells.push({ r, c });
    shuffleArray(cells);

    // remove numbers until we hit target clues, ensure uniqueness by checking solution count
    let currentClues = 81;
    let idx = 0;

    while (currentClues > targetClues && idx < cells.length) {
      const { r, c } = cells[idx++];
      if (puzzle[r][c] === 0) continue;
      const backup = puzzle[r][c];
      puzzle[r][c] = 0;

      // copy for checking
      const copy = puzzle.map(row => row.slice());
      const solCount = countSolutions(copy, 2);
      if (solCount !== 1) {
        // not unique, revert
        puzzle[r][c] = backup;
        continue;
      } else {
        currentClues--;
      }

      if (typeof progressCallback === 'function') {
        progressCallback({ currentClues, targetClues });
      }
    }

    return { puzzle, solution };
  }

  /* -----------------------------
     Public actions: new game / reset / check / solve / save / load
     ----------------------------- */
  function newGame(difficulty = 'medium') {
    stopTimer();
    setMessage('Generating puzzle — please wait...', 3000);
    // small delay to allow UI update
    setTimeout(() => {
      const { puzzle, solution } = generatePuzzle(difficulty);
      // set models
      grid = numbersToGridModel(puzzle);
      initialGrid = JSON.parse(JSON.stringify(grid, replacerForSet)); // deep clone handling sets
      solutionGrid = deepCopyGridNumbers(solution);
      elapsedSeconds = 0;
      mistakes = 0;
      renderBoardFromModel();
      startTimer();
      setMessage(`New puzzle (${difficulty}). Good luck!`, 2200);
    }, 40);
  }

  function replacerForSet(key, value) {
    // replace Set with array for serialization
    if (value instanceof Set) {
      return { __set: Array.from(value) };
    }
    return value;
  }
  function reviverForSet(key, value) {
    if (value && value.__set) return new Set(value.__set);
    return value;
  }

  function resetToInitial() {
    if (!initialGrid) return;
    stopTimer();
    grid = initialGrid.map(row => row.map(cell => ({ value: cell.value, given: cell.given, notes: new Set(cell.notes ? Array.from(cell.notes) : []) })));
    elapsedSeconds = 0;
    mistakes = 0;
    renderBoardFromModel();
    startTimer();
    setMessage('Reset to initial puzzle.');
  }

  function checkBoard() {
    // check all user-filled cells; mark invalid ones
    const numbers = gridToNumbers(grid);
    let invalidFound = false;
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const val = numbers[r][c];
        const wrapper = getWrapper(r, c);
        const input = wrapper.querySelector('.cell');

        input.classList.remove('invalid', 'correct');

        if (val === 0) continue;
        // Temporarily remove to test uniqueness in context
        numbers[r][c] = 0;
        const ok = isValidPlacement(numbers, r, c, val);
        numbers[r][c] = val;
        if (!ok) {
          input.classList.add('invalid');
          invalidFound = true;
        } else {
          input.classList.add('correct');
          setTimeout(() => input.classList.remove('correct'), 900);
        }
      }
    }
    if (invalidFound) {
      mistakes++;
      mistakesEl.textContent = `Mistakes: ${mistakes}`;
      setMessage('Be careful — some numbers conflict.', 2500);
    } else {
      setMessage('No conflicts detected (so far).', 1800);
    }
  }

  function solveAndAnimate(speedMs = 40) {
    if (!solutionGrid) return;
    stopTimer();
    solvingAnimationInProgress = true;
    const flat = [];
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        flat.push({ r, c, val: solutionGrid[r][c] });
      }
    }
    let i = 0;
    solveAnimationTimer = setInterval(() => {
      if (i >= flat.length) {
        clearInterval(solveAnimationTimer);
        solvingAnimationInProgress = false;
        setMessage('Solved (filled).');
        return;
      }
      const { r, c, val } = flat[i++];
      grid[r][c].value = val;
      grid[r][c].notes.clear();
      renderBoardFromModel();
    }, speedMs);
  }

  /* -----------------------------
     Timer
     ----------------------------- */
  function startTimer() {
    stopTimer();
    timerInterval = setInterval(() => {
      elapsedSeconds++;
      timerEl.textContent = formatTime(elapsedSeconds);
    }, 1000);
  }

  function stopTimer() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    if (solveAnimationTimer) {
      clearInterval(solveAnimationTimer);
      solveAnimationTimer = null;
    }
  }

  /* -----------------------------
     Save / Load localStorage
     ----------------------------- */
  function saveProgress() {
    // Save grid, solution, elapsed, mistakes, difficulty
    const data = {
      grid: grid,
      solution: solutionGrid,
      elapsedSeconds,
      mistakes,
      difficulty: difficultySel.value,
      timestamp: Date.now()
    };
    // custom serializer for Set
    const str = JSON.stringify(data, replacerForSet);
    localStorage.setItem(LS_KEYS.SAVED, str);
    setMessage('Game saved locally.');
  }

  function loadProgress() {
    const raw = localStorage.getItem(LS_KEYS.SAVED);
    if (!raw) {
      setMessage('No saved game found.');
      return;
    }
    try {
      const obj = JSON.parse(raw, reviverForSet);
      // reconstruct grid model
      grid = obj.grid.map(row => row.map(cell => ({
        value: cell.value === null ? null : cell.value,
        given: !!cell.given,
        notes: cell.notes instanceof Set ? new Set(Array.from(cell.notes)) : new Set()
      })));
      initialGrid = JSON.parse(JSON.stringify(grid, replacerForSet));
      solutionGrid = obj.solution ? deepCopyGridNumbers(obj.solution) : null;
      elapsedSeconds = obj.elapsedSeconds || 0;
      mistakes = obj.mistakes || 0;
      renderBoardFromModel();
      startTimer();
      setMessage('Saved game loaded.');
    } catch (err) {
      console.error(err);
      setMessage('Failed to load saved game.');
    }
  }

  /* -----------------------------
     Completion detection & leaderboard
     ----------------------------- */
  function isSolvedModel() {
    const numbers = gridToNumbers(grid);
    for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) if (numbers[r][c] === 0) return false;
    // quick validity check
    const copy = numbers.map(row => row.slice());
    return solveSudoku(copy) === true;
  }

  function onPuzzleSolved() {
    stopTimer();
    setMessage(`Puzzle solved in ${formatTime(elapsedSeconds)}!`);
    // store result to leaderboard
    const leadersRaw = localStorage.getItem(LS_KEYS.LEADER);
    const leaders = leadersRaw ? JSON.parse(leadersRaw) : [];
    const entry = {
      time: elapsedSeconds,
      difficulty: difficultySel.value,
      date: new Date().toISOString()
    };
    leaders.push(entry);
    // keep only top 10 fastest per local
    leaders.sort((a, b) => a.time - b.time);
    const trimmed = leaders.slice(0, 10);
    localStorage.setItem(LS_KEYS.LEADER, JSON.stringify(trimmed));
    renderLeaderboard();
  }

  function renderLeaderboard() {
    const raw = localStorage.getItem(LS_KEYS.LEADER);
    const leaders = raw ? JSON.parse(raw) : [];
    leaderboardList.innerHTML = '';
    leaders.forEach((l, i) => {
      const li = document.createElement('li');
      li.textContent = `${formatTime(l.time)} — ${l.difficulty} — ${new Date(l.date).toLocaleString()}`;
      leaderboardList.appendChild(li);
    });
    // show panel only if entries exist
    const panel = document.querySelector(SELECTORS.leaderboardPanel);
    if (panel) panel.style.display = leaders.length ? 'block' : 'none';
  }

  /* -----------------------------
     Helper: find conflicts for current grid (list cells that conflict)
     ----------------------------- */
  function findConflicts() {
    const numbers = gridToNumbers(grid);
    const conflicts = [];
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const v = numbers[r][c];
        if (v === 0) continue;
        numbers[r][c] = 0;
        if (!isValidPlacement(numbers, r, c, v)) {
          conflicts.push({ r, c });
        }
        numbers[r][c] = v;
      }
    }
    return conflicts;
  }

  /* -----------------------------
     UI Bindings (top-level buttons & keyboard)
     ----------------------------- */
  function wireUpUI() {
    newGameBtn.addEventListener('click', () => {
      newGame(difficultySel.value);
    });

    resetBtn.addEventListener('click', () => {
      resetToInitial();
    });

    checkBtn.addEventListener('click', () => {
      checkBoard();
    });

    solveBtn.addEventListener('click', () => {
      if (confirm('Selesaikan papan sekarang? Ini akan mengisi semua kotak.')) {
        solveAndAnimate(18);
      }
    });

    togglePencilBtn.addEventListener('click', () => {
      setPencilMode(!pencilMode);
      setMessage(`Pencil mode ${pencilMode ? 'ON' : 'OFF'}`, 1200);
    });

    toggleThemeBtn.addEventListener('click', () => {
      const root = document.documentElement;
      const isDark = root.getAttribute('data-theme') === 'dark' || root.classList.contains('dark');
      if (isDark) {
        root.removeAttribute('data-theme');
        root.classList.remove('dark');
        toggleThemeBtn.setAttribute('aria-pressed', 'false');
      } else {
        root.setAttribute('data-theme', 'dark');
        toggleThemeBtn.setAttribute('aria-pressed', 'true');
      }
    });

    saveBtn.addEventListener('click', saveProgress);
    loadBtn.addEventListener('click', loadProgress);

    // Global keyboard for number typing even when board not focused
    document.addEventListener('keydown', (e) => {
      if (!selectedCell) return;
      if (solvingAnimationInProgress) return;
      const { r, c } = selectedCell;
      if (e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        if (pencilMode) {
          toggleNote(r, c, Number(e.key));
        } else {
          setCellValue(r, c, Number(e.key), { user: true });
          // after user sets a number, check solved?
          if (isSolvedModel()) onPuzzleSolved();
        }
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        if (!grid[r][c].given) setCellValue(r, c, null, { user: true });
      } else if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) {
        // navigation handled elsewhere if inputs focused; handle for when not focused
        e.preventDefault();
        const pos = movePos({ r, c }, e.key);
        focusCell(pos.r, pos.c);
      } else if (e.key === 'Escape') {
        // quick unselect
        selectedCell = null;
        clearHighlights();
        document.activeElement && document.activeElement.blur();
      } else if (e.key === 'Enter') {
        // quick check
        checkBoard();
      }
    });
  }

  function setPencilMode(flag) {
    pencilMode = !!flag;
    togglePencilBtn.setAttribute('aria-pressed', pencilMode ? 'true' : 'false');
    togglePencilBtn.classList.toggle('active', pencilMode);
  }

  /* -----------------------------
     Initialization
     ----------------------------- */
  function init() {
    buildBoardDOM();
    renderBoardFromModel();
    wireUpUI();
    renderLeaderboard();

    // auto-generate a medium puzzle on first load
    setMessage('Ready. Generating a puzzle...');
    setTimeout(() => newGame(difficultySel.value), 60);

    // small accessibility: announce helper
    setTimeout(() => setMessage('Use number keys to fill, double-click to toggle pencil mode.'), 2000);
  }

  /* -----------------------------
     Start!
     ----------------------------- */
  init();

  /* -----------------------------
     Expose a few debug functions for console (optional)
     ----------------------------- */
  window._sudoku = {
    getGrid: () => grid,
    getNumbers: () => gridToNumbers(grid),
    getSolution: () => solutionGrid,
    generatePuzzle,
    solveSudoku: (nums) => solveSudoku(nums)
  };

})();
