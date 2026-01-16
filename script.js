/* script.js
   Renders 9x9 board, grid lines, selection overlays, cell pulses,
   connects digit bank to setNumber, implements undo/clear/candidates.
*/

(() => {
  // --- Config ---
  const LONG_PRESS_MS = 450;
  const REMOVALS = { easy: 36, medium: 44, hard: 52 };

  // --- State ---
  let solution = null; // 9x9 full solution
  let board = null; // 9x9 current (0 = empty)
  let fixed = null; // 9x9 booleans
  let candidates = null; // 9x9 Set<int>
  let selected = { r: null, c: null };
  let mistakes = 0;
  let undoStack = [];

  // Cached DOM
  const boardEl = document.getElementById('sudoku-board');
  const gridLinesEl = document.getElementById('grid-lines');
  const overlayRow = document.getElementById('overlay-row');
  const overlayCol = document.getElementById('overlay-col');
  const overlayBox = document.getElementById('overlay-box');
  const template = document.getElementById('cell-template');
  const timerEl = document.getElementById('timer');
  const mistakesEl = document.getElementById('mistakes');
  const mistakesMini = document.getElementById('mistakes-mini');
  const digitBtns = Array.from(document.querySelectorAll('.digit-btn'));
  const eraseBtn = document.getElementById('erase-btn');
  const clearBtn = document.getElementById('clear-btn');
  const undoBtn = document.getElementById('undo-btn');
  const newBtn = document.getElementById('new-game');
  const diffE = document.getElementById('diff-e');
  const diffM = document.getElementById('diff-m');
  const diffH = document.getElementById('diff-h');
  const cellNodes = []; // 9x9 DOM wrappers cached after render

  // --- Utilities ---
  function makeEmptyGrid(v = 0) {
    return Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => v));
  }
  function deepCopyGrid(g) {
    return g.map(row => row.slice());
  }

  // Random shuffle helper
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // --- Sudoku generator (backtracking) ---
  function createSolvedGrid() {
    const g = makeEmptyGrid(0);

    function canPlace(r, c, n) {
      for (let i = 0; i < 9; i++) {
        if (g[r][i] === n) return false;
        if (g[i][c] === n) return false;
      }
      const br = Math.floor(r / 3) * 3;
      const bc = Math.floor(c / 3) * 3;
      for (let rr = br; rr < br + 3; rr++) {
        for (let cc = bc; cc < bc + 3; cc++) {
          if (g[rr][cc] === n) return false;
        }
      }
      return true;
    }

    function fillCell(pos = 0) {
      if (pos === 81) return true;
      const r = Math.floor(pos / 9);
      const c = pos % 9;
      const nums = shuffle([1,2,3,4,5,6,7,8,9].slice());
      for (const n of nums) {
        if (canPlace(r, c, n)) {
          g[r][c] = n;
          if (fillCell(pos + 1)) return true;
          g[r][c] = 0;
        }
      }
      return false;
    }

    const ok = fillCell(0);
    if (!ok) throw new Error('Failed to generate solution');
    return g;
  }

  // Remove cells (random) - no uniqueness checking (fast)
  function removeCells(grid, removals) {
    const g = deepCopyGrid(grid);
    const indices = shuffle(Array.from({ length: 81 }, (_, i) => i));
    let removed = 0;
    for (const idx of indices) {
      if (removed >= removals) break;
      const r = Math.floor(idx / 9);
      const c = idx % 9;
      if (g[r][c] !== 0) {
        g[r][c] = 0;
        removed++;
      }
    }
    return g;
  }

  // --- Model operations ---
  function restart(difficulty = 'medium') {
    solution = createSolvedGrid();
    board = deepCopyGrid(solution);
    const removals = REMOVALS[difficulty] ?? REMOVALS.medium;
    board = removeCells(board, removals);
    fixed = board.map(r => r.map(v => v !== 0));
    candidates = Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => new Set()));
    selected = { r: null, c: null };
    mistakes = 0;
    undoStack = [];
    renderBoard();
    installGridLines(); // align lines after render
    updateAllCounts();
    updateMistakes();
    updateUndoButton();
  }

  function pushUndo() {
    const snapshot = {
      board: deepCopyGrid(board),
      candidates: candidates.map(row => row.map(s => new Set(Array.from(s)))),
      mistakes,
      selected: { ...selected }
    };
    undoStack.push(snapshot);
    if (undoStack.length > 100) undoStack.shift();
    updateUndoButton();
  }

  function undo() {
    if (!undoStack.length) return;
    const s = undoStack.pop();
    board = s.board;
    candidates = s.candidates;
    mistakes = s.mistakes;
    selected = s.selected;
    renderBoard(); // full rerender
    updateAllCounts();
    updateMistakes();
    updateUndoButton();
    positionOverlays();
  }

  function setNumber(r, c, value, isNote = false) {
    if (!inBounds(r, c)) return;
    if (fixed[r][c]) return;

    if (isNote) {
      pushUndo();
      const set = candidates[r][c];
      if (set.has(value)) set.delete(value);
      else set.add(value);
      renderCell(r, c);
      return;
    }

    pushUndo();
    board[r][c] = value;
    candidates[r][c].clear();

    // mistakes compare with solution
    if (solution && solution[r][c] !== value) {
      mistakes++;
      // wrong feedback
      animateWrongCell(r, c);
    } else {
      // correct feedback
      animateCorrectCell(r, c);
    }

    renderCell(r, c);
    renderConflicts();
    updateAllCounts();
    updateMistakes();

    // completion check for row/col/box containing the cell
    if (isRowComplete(r)) {
      pulseOverlay('row', r);
    }
    if (isColComplete(c)) {
      pulseOverlay('col', c);
    }
    if (isBoxCompleteForCell(r, c)) {
      pulseOverlay('box', r, c);
    }
  }

  function clearCell(r, c) {
    if (!inBounds(r, c)) return;
    if (fixed[r][c]) return;
    pushUndo();
    board[r][c] = 0;
    candidates[r][c].clear();
    renderCell(r, c);
    renderConflicts();
    updateAllCounts();
    positionOverlays();
  }

  function inBounds(r, c) {
    return r >= 0 && r < 9 && c >= 0 && c < 9;
  }

  // --- Rendering ---
  function renderBoard() {
    // Clear board children except overlays placeholders
    // We'll reconstruct cells and keep overlay placeholders (#grid-lines, overlays)
    // Remove all children then recreate overlays then cells to ensure ordering
    boardEl.innerHTML = '';
    // recreate overlay placeholders
    boardEl.appendChild(gridLinesEl);
    boardEl.appendChild(overlayRow);
    boardEl.appendChild(overlayCol);
    boardEl.appendChild(overlayBox);

    // build cells
    for (let r = 0; r < 9; r++) {
      cellNodes[r] = [];
      for (let c = 0; c < 9; c++) {
        const tpl = template.content.cloneNode(true);
        const wrapper = tpl.querySelector('.cell-wrapper');
        wrapper.dataset.row = r;
        wrapper.dataset.col = c;
        wrapper.dataset.box = Math.floor(r/3)*3 + Math.floor(c/3);
        const input = wrapper.querySelector('.cell');
        const notesEl = wrapper.querySelector('.notes');

        // set initial value
        const v = board[r][c];
        input.value = v === 0 ? '' : String(v);
        if (fixed[r][c]) {
          input.classList.add('fixed');
        } else {
          input.classList.remove('fixed');
        }

        // apply candidate notes if any
        const set = candidates[r][c];
        for (let n = 1; n <= 9; n++) {
          const noteEl = notesEl.querySelector(`.note[data-n="${n}"]`);
          noteEl.textContent = set.has(n) ? String(n) : '';
        }

        // add event handlers on wrapper (for selection and long press)
        attachCellEvents(wrapper, r, c);

        // append to board
        boardEl.appendChild(wrapper);
        cellNodes[r][c] = wrapper;
      }
    }

    renderConflicts();
    positionOverlays();
  }

  function renderCell(r, c) {
    const wrapper = cellNodes[r][c];
    if (!wrapper) return;
    const input = wrapper.querySelector('.cell');
    const notesEl = wrapper.querySelector('.notes');
    const v = board[r][c];
    input.value = v === 0 ? '' : String(v);
    if (fixed[r][c]) input.classList.add('fixed');
    else input.classList.remove('fixed');

    // candidates
    const set = candidates[r][c];
    for (let n = 1; n <= 9; n++) {
      const noteEl = notesEl.querySelector(`.note[data-n="${n}"]`);
      noteEl.textContent = set.has(n) ? String(n) : '';
    }
  }

  // Conflicts: mark any cell that duplicates a value in its row/col/box
  function renderConflicts() {
    // clear all
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        cellNodes[r][c].classList.remove('has-conflict');
      }
    }

    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const v = board[r][c];
        if (v === 0) continue;
        // row/col/box check
        for (let cc = 0; cc < 9; cc++) {
          if (cc !== c && board[r][cc] === v) {
            cellNodes[r][c].classList.add('has-conflict');
            cellNodes[r][cc].classList.add('has-conflict');
          }
        }
        for (let rr = 0; rr < 9; rr++) {
          if (rr !== r && board[rr][c] === v) {
            cellNodes[r][c].classList.add('has-conflict');
            cellNodes[rr][c].classList.add('has-conflict');
          }
        }
        const br = Math.floor(r/3)*3;
        const bc = Math.floor(c/3)*3;
        for (let rr = br; rr < br+3; rr++) {
          for (let cc = bc; cc < bc+3; cc++) {
            if ((rr !== r || cc !== c) && board[rr][cc] === v) {
              cellNodes[r][c].classList.add('has-conflict');
              cellNodes[rr][cc].classList.add('has-conflict');
            }
          }
        }
      }
    }
  }

  // --- Grid lines (8 vertical + 8 horizontal), drawn into #grid-lines ---
// REPLACE your old installGridLines() with this improved version
function installGridLines() {
  // clear existing
  gridLinesEl.innerHTML = '';

  // Board size (use clientWidth/clientHeight to avoid transform/viewport offsets)
  const w = boardEl.clientWidth;
  const h = boardEl.clientHeight;

  const thinPx = 1;   // thin line width in px
  const thickPx = 3;  // thick separator width in px

  // vertical lines: i = 1..8
  for (let i = 1; i <= 8; i++) {
    const isThick = (i % 3 === 0);
    const widthPx = isThick ? thickPx : thinPx;

    const line = document.createElement('div');
    line.className = 'grid-line vertical' + (isThick ? ' thick' : '');
    // Position with percentage + calc to avoid rounding drift:
    // left = calc(i*100/9% - widthPx/2)
    line.style.left = `calc(${(i * 100 / 9).toFixed(6)}% - ${Math.round(widthPx/2)}px)`;
    line.style.width = `${widthPx}px`;
    line.style.top = '0';
    line.style.height = '100%';
    gridLinesEl.appendChild(line);
  }

  // horizontal lines: i = 1..8
  for (let i = 1; i <= 8; i++) {
    const isThick = (i % 3 === 0);
    const heightPx = isThick ? thickPx : thinPx;

    const line = document.createElement('div');
    line.className = 'grid-line horizontal' + (isThick ? ' thick' : '');
    // top = calc(i*100/9% - heightPx/2)
    line.style.top = `calc(${(i * 100 / 9).toFixed(6)}% - ${Math.round(heightPx/2)}px)`;
    line.style.height = `${heightPx}px`;
    line.style.left = '0';
    line.style.width = '100%';
    gridLinesEl.appendChild(line);
  }

  // Make sure overlays are above board cells
  gridLinesEl.style.position = 'absolute';
  gridLinesEl.style.inset = '0';
  gridLinesEl.style.pointerEvents = 'none';
}


  // --- Selection & overlays ---
  function attachCellEvents(wrapper, r, c) {
    // click selects cell
    wrapper.addEventListener('click', (e) => {
      e.preventDefault();
      selectCell(r, c);
    });

    // longpress to clear cell (like Flutter long press)
    let longTimer = null;
    wrapper.addEventListener('pointerdown', (ev) => {
      // start longpress timer — clear cell if longpress
      longTimer = setTimeout(() => {
        if (!fixed[r][c]) {
          clearCell(r, c);
        }
      }, 600);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(evName => {
      wrapper.addEventListener(evName, () => {
        if (longTimer) { clearTimeout(longTimer); longTimer = null; }
      });
    });
  }

  function selectCell(r, c) {
    // toggle selection
    if (selected.r === r && selected.c === c) {
      selected = { r: null, c: null };
    } else {
      selected = { r, c };
    }
    updateSelectionUI();
    positionOverlays();
  }

  function updateSelectionUI() {
    for (let rr = 0; rr < 9; rr++) {
      for (let cc = 0; cc < 9; cc++) {
        const wrapper = cellNodes[rr][cc];
        if (!wrapper) continue;
        if (selected.r === rr && selected.c === cc) wrapper.classList.add('selected');
        else wrapper.classList.remove('selected');
      }
    }
  }

  function positionOverlays() {
    // Hide overlays if no selection
    if (selected.r === null || selected.c === null) {
      overlayRow.style.display = 'none';
      overlayCol.style.display = 'none';
      overlayBox.style.display = 'none';
      return;
    }
    const rect = boardEl.getBoundingClientRect();
    const cellW = rect.width / 9;
    const cellH = rect.height / 9;

    // row
    overlayRow.style.display = 'block';
    overlayRow.style.left = '0px';
    overlayRow.style.width = rect.width + 'px';
    overlayRow.style.top = (selected.r * cellH) + 'px';
    overlayRow.style.height = cellH + 'px';

    // col
    overlayCol.style.display = 'block';
    overlayCol.style.top = '0px';
    overlayCol.style.height = rect.height + 'px';
    overlayCol.style.left = (selected.c * cellW) + 'px';
    overlayCol.style.width = cellW + 'px';

    // box
    const br = Math.floor(selected.r / 3) * 3;
    const bc = Math.floor(selected.c / 3) * 3;
    overlayBox.style.display = 'block';
    overlayBox.style.left = (bc * cellW) + 'px';
    overlayBox.style.top = (br * cellH) + 'px';
    overlayBox.style.width = (3 * cellW) + 'px';
    overlayBox.style.height = (3 * cellH) + 'px';
  }

  // pulse overlay for completion
  function pulseOverlay(kind, rOrC, cIfBox) {
    let el;
    if (kind === 'row') el = overlayRow;
    else if (kind === 'col') el = overlayCol;
    else el = overlayBox;
    if (!el) return;
    el.classList.remove('pulse');
    // trigger reflow
    void el.offsetWidth;
    el.classList.add('pulse');
    // remove after animation
    setTimeout(() => el.classList.remove('pulse'), 700);
  }

  // --- Animations for cells ---
  function animateCorrectCell(r, c) {
    const wrapper = cellNodes[r][c];
    if (!wrapper) return;
    const el = wrapper;
    el.style.transition = 'transform 180ms cubic-bezier(.2,.9,.2,1)';
    el.style.transform = 'scale(1.14)';
    setTimeout(() => {
      el.style.transform = 'scale(1)';
      setTimeout(() => {
        el.style.transition = '';
        el.style.transform = '';
      }, 200);
    }, 180);
  }

  function animateWrongCell(r, c) {
    const wrapper = cellNodes[r][c];
    if (!wrapper) return;
    // red flash
    const orig = wrapper.style.background;
    wrapper.classList.add('has-conflict');
    setTimeout(() => {
      // keep conflict class (still marks duplicates), but flash effect can be temporary
      // we won't remove has-conflict here because duplicates logic will handle it
    }, 300);
  }

  // --- helpers for completion checks ---
  function isRowComplete(r) {
    if (r === null) return false;
    for (let c = 0; c < 9; c++) if (board[r][c] === 0) return false;
    return true;
  }
  function isColComplete(c) {
    if (c === null) return false;
    for (let r = 0; r < 9; r++) if (board[r][c] === 0) return false;
    return true;
  }
  function isBoxCompleteForCell(r, c) {
    if (r === null || c === null) return false;
    const br = Math.floor(r / 3) * 3;
    const bc = Math.floor(c / 3) * 3;
    for (let rr = br; rr < br + 3; rr++) {
      for (let cc = bc; cc < bc + 3; cc++) {
        if (board[rr][cc] === 0) return false;
      }
    }
    return true;
  }

  // --- Digit bank handlers (tap & long press for notes) ---
  function attachDigitBank() {
    digitBtns.forEach(btn => {
      const n = Number(btn.dataset.digit);
      let timer = null;
      const start = (e) => {
        e.preventDefault();
        timer = setTimeout(() => {
          // long press: toggle candidate on selected
          if (selected.r !== null && selected.c !== null) {
            setNumber(selected.r, selected.c, n, true);
          }
        }, LONG_PRESS_MS);
      };
      const cancel = (e) => {
        if (timer) { clearTimeout(timer); timer = null; }
      };
      btn.addEventListener('pointerdown', start);
      ['pointerup','pointerleave','pointercancel'].forEach(ev => btn.addEventListener(ev, cancel));

      btn.addEventListener('click', (e) => {
        e.preventDefault();
        // click: set number if selection exists
        if (selected.r !== null && selected.c !== null) {
          setNumber(selected.r, selected.c, n, false);
        }
      });
    });

    // erase button behaves like Clear: clear selected cell
    eraseBtn.addEventListener('click', (e) => {
      e.preventDefault();
      if (selected.r !== null && selected.c !== null) clearCell(selected.r, selected.c);
    });
  }

  // --- footer buttons ---
  clearBtn.addEventListener('click', (e) => {
    e.preventDefault();
    if (selected.r !== null && selected.c !== null) clearCell(selected.r, selected.c);
  });

  undoBtn.addEventListener('click', (e) => {
    e.preventDefault();
    undo();
  });

  // New game & difficulty chips
  newBtn.addEventListener('click', () => {
    // difficulty from selected chip
    const diff = diffE.classList.contains('selected') ? 'easy' : diffH.classList.contains('selected') ? 'hard' : 'medium';
    restart(diff);
  });
  function setDifficultyChip(el) {
    diffE.classList.remove('selected'); diffE.setAttribute('aria-pressed','false');
    diffM.classList.remove('selected'); diffM.setAttribute('aria-pressed','false');
    diffH.classList.remove('selected'); diffH.setAttribute('aria-pressed','false');
    el.classList.add('selected'); el.setAttribute('aria-pressed','true');
  }
  diffE.addEventListener('click', () => { setDifficultyChip(diffE); restart('easy'); });
  diffM.addEventListener('click', () => { setDifficultyChip(diffM); restart('medium'); });
  diffH.addEventListener('click', () => { setDifficultyChip(diffH); restart('hard'); });

  // --- counts & UI update helpers ---
  function updateAllCounts() {
    // compute remaining per number (9 - occurrences)
    const counts = Array(9).fill(0);
    for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
      const v = board[r][c];
      if (v >= 1 && v <= 9) counts[v-1]++;
    }
    digitBtns.forEach(btn => {
      const n = Number(btn.dataset.digit);
      const countEl = btn.querySelector('.count');
      if (countEl) countEl.textContent = String(9 - counts[n-1]);
      btn.setAttribute('aria-pressed','false');
    });
  }

  function updateMistakes() {
    mistakesEl.textContent = String(mistakes);
    mistakesMini.textContent = String(mistakes);
  }

  function updateUndoButton() {
    if (undoStack.length) undoBtn.removeAttribute('disabled');
    else undoBtn.setAttribute('disabled', 'true');
  }

  // Set up keyboard input for convenience (1-9 keys to set, Backspace to clear)
  window.addEventListener('keydown', (e) => {
    if (!selected.r && selected.r !== 0) return;
    if (e.key >= '1' && e.key <= '9') {
      setNumber(selected.r, selected.c, Number(e.key));
    } else if (e.key === 'Backspace' || e.key === 'Delete') {
      clearCell(selected.r, selected.c);
    } else if (e.key === 'Escape') {
      selected = { r: null, c: null };
      updateSelectionUI();
      positionOverlays();
    }
  });

  // --- initialization ---
  function init() {
    // create initial puzzle (default medium)
    restart('medium');
    attachDigitBank();
    // ensure grid lines update on resize
    let t;
    window.addEventListener('resize', () => {
      clearTimeout(t);
      t = setTimeout(() => {
        installGridLines();
        positionOverlays();
      }, 120);
    });
  }

  // expose restart to window for dev debugging
  window.sudokuRestart = restart;

  // start after DOM ready
  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
