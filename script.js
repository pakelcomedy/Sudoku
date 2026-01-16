/* script.js
   Sudoku UI glue:
   - renders 9x9 board
   - draws grid-lines into #grid-lines (creates placeholder if missing)
   - selection overlays (row/col/box)
   - cell pulse animation on correct input, conflict highlight on wrong
   - digit bank click & long-press (notes)
   - Clear / Undo / Erase
   Primary input method: digit bank. Keyboard input intentionally minimal/disabled.
*/

(() => {
  // config
  const LONG_PRESS_MS = 450;
  const REMOVALS = { easy: 36, medium: 44, hard: 52 };

  // state
  let solution = null;
  let board = null;
  let fixed = null;
  let candidates = null;
  let selected = { r: null, c: null };
  let lastSelected = { r: null, c: null }; // fallback for digit clicks
  let mistakes = 0;
  let undoStack = [];

  // cached dom (create placeholders if missing)
  const boardEl = document.getElementById('sudoku-board');
  if (!boardEl) throw new Error('#sudoku-board element required in HTML');

  // ensure overlay placeholders exist (some templates include them already)
  function ensureEl(id, cls) {
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement('div');
      el.id = id;
      if (cls) el.className = cls;
      boardEl.appendChild(el);
    }
    return el;
  }

  const gridLinesEl = ensureEl('grid-lines', 'grid-lines');
  const overlayRow = ensureEl('overlay-row', 'overlay-highlight row');
  const overlayCol = ensureEl('overlay-col', 'overlay-highlight col');
  const overlayBox = ensureEl('overlay-box', 'overlay-highlight box');

  const template = document.getElementById('cell-template');
  if (!template) throw new Error('#cell-template missing');

  const timerEl = document.getElementById('timer');
  const mistakesEl = document.getElementById('mistakes');
  const mistakesMini = document.getElementById('mistakes-mini');

  let digitBtns = Array.from(document.querySelectorAll('.digit-btn'));
  const eraseBtn = document.getElementById('erase-btn');
  const clearBtn = document.getElementById('clear-btn');
  const undoBtn = document.getElementById('undo-btn');
  const newBtn = document.getElementById('new-game');
  const diffE = document.getElementById('diff-e');
  const diffM = document.getElementById('diff-m');
  const diffH = document.getElementById('diff-h');

  const cellNodes = []; // 9x9 wrappers

  // helpers
  function makeEmptyGrid(v = 0) {
    return Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => v));
  }
  function deepCopyGrid(g) { return g.map(row => row.slice()); }
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // sudoku generator (simple backtracking)
  function createSolvedGrid() {
    const g = makeEmptyGrid(0);
    function canPlace(r, c, n) {
      for (let i = 0; i < 9; i++) {
        if (g[r][i] === n) return false;
        if (g[i][c] === n) return false;
      }
      const br = Math.floor(r / 3) * 3, bc = Math.floor(c / 3) * 3;
      for (let rr = br; rr < br + 3; rr++) for (let cc = bc; cc < bc + 3; cc++) if (g[rr][cc] === n) return false;
      return true;
    }
    function fillCell(pos = 0) {
      if (pos === 81) return true;
      const r = Math.floor(pos / 9), c = pos % 9;
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
    if (!fillCell(0)) throw new Error('generator failed');
    return g;
  }

  function removeCells(g, removals) {
    const out = deepCopyGrid(g);
    const idx = shuffle(Array.from({ length: 81 }, (_, i) => i));
    let removed = 0;
    for (const k of idx) {
      if (removed >= removals) break;
      const r = Math.floor(k / 9), c = k % 9;
      if (out[r][c] !== 0) { out[r][c] = 0; removed++; }
    }
    return out;
  }

  // model ops
  function restart(difficulty = 'medium') {
    solution = createSolvedGrid();
    board = deepCopyGrid(solution);
    const rem = REMOVALS[difficulty] ?? REMOVALS.medium;
    board = removeCells(board, rem);
    fixed = board.map(r => r.map(v => v !== 0));
    candidates = Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => new Set()));
    selected = { r: null, c: null };
    lastSelected = { r: null, c: null };
    mistakes = 0;
    undoStack = [];
    renderBoard();
    installGridLines();
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
    lastSelected = selected ? { ...selected } : { r: null, c: null };
    renderBoard();
    updateAllCounts();
    updateMistakes();
    updateUndoButton();
    positionOverlays();
  }

  function setNumber(r, c, val, isNote = false) {
    if (!inBounds(r,c)) return;
    if (fixed[r][c]) return;
    if (isNote) {
      pushUndo();
      const set = candidates[r][c];
      if (set.has(val)) set.delete(val); else set.add(val);
      renderCell(r,c);
      return;
    }
    pushUndo();
    board[r][c] = val;
    candidates[r][c].clear();
    if (solution && solution[r][c] !== val) { mistakes++; animateWrongCell(r,c); }
    else animateCorrectCell(r,c);
    renderCell(r,c);
    renderConflicts();
    updateAllCounts();
    updateMistakes();
    if (isRowComplete(r)) pulseOverlay('row', r);
    if (isColComplete(c)) pulseOverlay('col', c);
    if (isBoxCompleteForCell(r,c)) pulseOverlay('box', r, c);
  }

  function clearCell(r,c) {
    if (!inBounds(r,c)) return;
    if (fixed[r][c]) return;
    pushUndo();
    board[r][c] = 0;
    candidates[r][c].clear();
    renderCell(r,c);
    renderConflicts();
    updateAllCounts();
    positionOverlays();
  }

  function inBounds(r,c) { return r>=0 && r<9 && c>=0 && c<9; }

  // render
  function renderBoard() {
    // clear except overlays (we'll re-append placeholders to keep order)
    boardEl.innerHTML = '';
    boardEl.appendChild(gridLinesEl);
    boardEl.appendChild(overlayRow);
    boardEl.appendChild(overlayCol);
    boardEl.appendChild(overlayBox);

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

        const v = board[r][c];
        input.value = v === 0 ? '' : String(v);
        if (fixed[r][c]) input.classList.add('fixed'); else input.classList.remove('fixed');

        const set = candidates[r][c];
        for (let n = 1; n <= 9; n++) {
          const noteEl = notesEl.querySelector(`.note[data-n="${n}"]`);
          if (noteEl) noteEl.textContent = set.has(n) ? String(n) : '';
        }

        attachCellEvents(wrapper, r, c);
        wrapper.tabIndex = 0;
        boardEl.appendChild(wrapper);
        cellNodes[r][c] = wrapper;
      }
    }

    renderConflicts();
    positionOverlays();
  }

  function renderCell(r,c) {
    const wrapper = cellNodes[r] && cellNodes[r][c];
    if (!wrapper) return;
    const input = wrapper.querySelector('.cell');
    const notesEl = wrapper.querySelector('.notes');
    const v = board[r][c];
    input.value = v === 0 ? '' : String(v);
    if (fixed[r][c]) input.classList.add('fixed'); else input.classList.remove('fixed');

    const set = candidates[r][c];
    for (let n = 1; n <= 9; n++) {
      const noteEl = notesEl.querySelector(`.note[data-n="${n}"]`);
      if (noteEl) noteEl.textContent = set.has(n) ? String(n) : '';
    }
  }

  function renderConflicts() {
    for (let r=0;r<9;r++) for (let c=0;c<9;c++) {
      const node = (cellNodes[r] && cellNodes[r][c]);
      if (node) node.classList.remove('has-conflict');
    }
    for (let r=0;r<9;r++) for (let c=0;c<9;c++) {
      const v = board[r][c];
      if (v === 0) continue;
      for (let cc=0; cc<9; cc++) if (cc !== c && board[r][cc] === v) {
        cellNodes[r][c].classList.add('has-conflict');
        cellNodes[r][cc].classList.add('has-conflict');
      }
      for (let rr=0; rr<9; rr++) if (rr !== r && board[rr][c] === v) {
        cellNodes[r][c].classList.add('has-conflict');
        cellNodes[rr][c].classList.add('has-conflict');
      }
      const br = Math.floor(r/3)*3, bc = Math.floor(c/3)*3;
      for (let rr = br; rr < br+3; rr++) for (let cc = bc; cc < bc+3; cc++) {
        if ((rr !== r || cc !== c) && board[rr][cc] === v) {
          cellNodes[r][c].classList.add('has-conflict');
          cellNodes[rr][cc].classList.add('has-conflict');
        }
      }
    }
  }

  // gridlines (percentage positioning to avoid subpixel drift)
  function installGridLines() {
    gridLinesEl.innerHTML = '';
    const thin = 1, thick = 3;
    for (let i=1;i<=8;i++) {
      const isThick = (i%3===0);
      const w = isThick ? thick : thin;
      const v = document.createElement('div');
      v.className = 'grid-line vertical' + (isThick ? ' thick' : '');
      v.style.left = `calc(${(i*100/9).toFixed(6)}% - ${Math.round(w/2)}px)`;
      v.style.width = `${w}px`; v.style.top = '0'; v.style.height = '100%';
      gridLinesEl.appendChild(v);
    }
    for (let i=1;i<=8;i++) {
      const isThick = (i%3===0);
      const h = isThick ? thick : thin;
      const v = document.createElement('div');
      v.className = 'grid-line horizontal' + (isThick ? ' thick' : '');
      v.style.top = `calc(${(i*100/9).toFixed(6)}% - ${Math.round(h/2)}px)`;
      v.style.height = `${h}px`; v.style.left = '0'; v.style.width = '100%';
      gridLinesEl.appendChild(v);
    }
    gridLinesEl.style.position = 'absolute';
    gridLinesEl.style.inset = '0';
    gridLinesEl.style.pointerEvents = 'none';
    gridLinesEl.style.zIndex = '40';
  }

  // selection & overlays
  function attachCellEvents(wrapper, r, c) {
    wrapper.addEventListener('click', (e) => {
      e.preventDefault();
      selectCell(r,c);
    });
    wrapper.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        selectCell(r,c);
      }
    });
    let longTimer = null;
    wrapper.addEventListener('pointerdown', () => {
      longTimer = setTimeout(() => {
        if (!fixed[r][c]) clearCell(r,c);
      }, 600);
    });
    ['pointerup','pointerleave','pointercancel'].forEach(ev => {
      wrapper.addEventListener(ev, () => {
        if (longTimer) { clearTimeout(longTimer); longTimer = null; }
      });
    });
  }

  function selectCell(r,c) {
    if (selected.r === r && selected.c === c) {
      selected = { r: null, c: null };
    } else {
      selected = { r, c };
      lastSelected = { r, c };
    }
    updateSelectionUI();
    positionOverlays();
  }

  function updateSelectionUI() {
    for (let rr=0; rr<9; rr++) for (let cc=0; cc<9; cc++) {
      const w = cellNodes[rr] && cellNodes[rr][cc];
      if (!w) continue;
      if (selected.r === rr && selected.c === cc) {
        w.classList.add('selected');
        const input = w.querySelector('.cell');
        if (input) input.focus({ preventScroll: true });
      } else w.classList.remove('selected');
    }
  }

  function positionOverlays() {
    if (selected.r === null || selected.c === null) {
      overlayRow.style.display = 'none';
      overlayCol.style.display = 'none';
      overlayBox.style.display = 'none';
      return;
    }
    const rect = boardEl.getBoundingClientRect();
    const cellW = rect.width / 9, cellH = rect.height / 9;
    overlayRow.style.display = 'block';
    overlayRow.style.left = '0px';
    overlayRow.style.width = rect.width + 'px';
    overlayRow.style.top = (selected.r * cellH) + 'px';
    overlayRow.style.height = cellH + 'px';
    overlayCol.style.display = 'block';
    overlayCol.style.top = '0px';
    overlayCol.style.height = rect.height + 'px';
    overlayCol.style.left = (selected.c * cellW) + 'px';
    overlayCol.style.width = cellW + 'px';
    const br = Math.floor(selected.r/3)*3, bc = Math.floor(selected.c/3)*3;
    overlayBox.style.display = 'block';
    overlayBox.style.left = (bc * cellW) + 'px';
    overlayBox.style.top = (br * cellH) + 'px';
    overlayBox.style.width = (3 * cellW) + 'px';
    overlayBox.style.height = (3 * cellH) + 'px';
  }

  function pulseOverlay(kind) {
    const el = kind === 'row' ? overlayRow : kind === 'col' ? overlayCol : overlayBox;
    if (!el) return;
    el.classList.remove('pulse');
    void el.offsetWidth;
    el.classList.add('pulse');
    setTimeout(()=> el.classList.remove('pulse'), 700);
  }

  // animations
  function animateCorrectCell(r,c) {
    const w = cellNodes[r] && cellNodes[r][c]; if (!w) return;
    w.style.transition = 'transform 180ms cubic-bezier(.2,.9,.2,1)';
    w.style.transform = 'scale(1.14)';
    setTimeout(()=> {
      w.style.transform = 'scale(1)';
      setTimeout(()=> { w.style.transition=''; w.style.transform=''; }, 200);
    }, 180);
  }
  function animateWrongCell(r,c) {
    const w = cellNodes[r] && cellNodes[r][c]; if (!w) return;
    w.classList.add('has-conflict');
  }

  function isRowComplete(r) { if (r === null) return false; for (let c=0;c<9;c++) if (board[r][c]===0) return false; return true; }
  function isColComplete(c) { if (c === null) return false; for (let r=0;r<9;r++) if (board[r][c]===0) return false; return true; }
  function isBoxCompleteForCell(r,c) {
    if (r === null || c === null) return false;
    const br = Math.floor(r/3)*3, bc = Math.floor(c/3)*3;
    for (let rr=br; rr<br+3; rr++) for (let cc=bc; cc<bc+3; cc++) if (board[rr][cc]===0) return false;
    return true;
  }

  // digit bank handlers (robust across devices)
  function attachDigitBank() {
    digitBtns = Array.from(document.querySelectorAll('.digit-btn')); // refresh list in case DOM changed
    digitBtns.forEach(btn => {
      const n = Number(btn.dataset.digit);
      let timer = null;

      // start long-press timer on pointerdown (do NOT preventDefault)
      function startLong(e) {
        // don't preventDefault: that can cancel click on some browsers
        timer = setTimeout(() => {
          const r = (selected.r !== null ? selected.r : lastSelected.r);
          const c = (selected.c !== null ? selected.c : lastSelected.c);
          if (r !== null && c !== null) setNumber(r, c, n, true);
          else flashDigitBtn(btn);
          timer = null;
        }, LONG_PRESS_MS);
      }
      function cancelLong() { if (timer) { clearTimeout(timer); timer = null; } }

      // pointer events preferred
      if (window.PointerEvent) {
        btn.addEventListener('pointerdown', startLong, { passive: true });
        ['pointerup','pointerleave','pointercancel'].forEach(ev => btn.addEventListener(ev, cancelLong));
      } else {
        // fallback for older browsers: touch & mouse
        btn.addEventListener('touchstart', startLong, { passive: true });
        btn.addEventListener('mousedown', startLong);
        ['touchend','touchcancel','mouseleave','mouseup'].forEach(ev => btn.addEventListener(ev, cancelLong));
      }

      // click for normal tap -> set number
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        cancelLong();
        const r = (selected.r !== null ? selected.r : lastSelected.r);
        const c = (selected.c !== null ? selected.c : lastSelected.c);
        if (r !== null && c !== null) setNumber(r, c, n, false);
        else flashBoard();
      });
    });

    // erase behaviour
    if (eraseBtn) {
      eraseBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const r = (selected.r !== null ? selected.r : lastSelected.r);
        const c = (selected.c !== null ? selected.c : lastSelected.c);
        if (r !== null && c !== null) clearCell(r, c);
        else flashBoard();
      });
    }
  }

  function flashDigitBtn(btn) {
    btn.style.transform = 'scale(0.96)';
    setTimeout(()=> btn.style.transform = '', 160);
  }
  function flashBoard() {
    boardEl.style.transition = 'transform 90ms ease';
    boardEl.style.transform = 'translateY(-4px)';
    setTimeout(()=> { boardEl.style.transform = ''; setTimeout(()=> boardEl.style.transition = '', 200); }, 90);
  }

  // footer controls
  if (clearBtn) clearBtn.addEventListener('click', (e) => {
    e.preventDefault();
    const r = (selected.r !== null ? selected.r : lastSelected.r);
    const c = (selected.c !== null ? selected.c : lastSelected.c);
    if (r !== null && c !== null) clearCell(r,c);
    else flashBoard();
  });
  if (undoBtn) undoBtn.addEventListener('click', (e) => { e.preventDefault(); undo(); });

  if (newBtn) newBtn.addEventListener('click', () => {
    const diff = diffE && diffE.classList.contains('selected') ? 'easy'
               : diffH && diffH.classList.contains('selected') ? 'hard'
               : 'medium';
    restart(diff);
  });
  function setDifficultyChip(el) {
    if (!diffE || !diffM || !diffH) return;
    diffE.classList.remove('selected'); diffE.setAttribute('aria-pressed','false');
    diffM.classList.remove('selected'); diffM.setAttribute('aria-pressed','false');
    diffH.classList.remove('selected'); diffH.setAttribute('aria-pressed','false');
    el.classList.add('selected'); el.setAttribute('aria-pressed','true');
  }
  if (diffE) diffE.addEventListener('click', () => { setDifficultyChip(diffE); restart('easy'); });
  if (diffM) diffM.addEventListener('click', () => { setDifficultyChip(diffM); restart('medium'); });
  if (diffH) diffH.addEventListener('click', () => { setDifficultyChip(diffH); restart('hard'); });

  // ui helpers
  function updateAllCounts() {
    const counts = Array(9).fill(0);
    for (let r=0;r<9;r++) for (let c=0;c<9;c++) {
      const v = board[r][c];
      if (v>=1 && v<=9) counts[v-1]++;
    }
    digitBtns = Array.from(document.querySelectorAll('.digit-btn'));
    digitBtns.forEach(btn => {
      const n = Number(btn.dataset.digit);
      const countEl = btn.querySelector('.count');
      if (countEl) countEl.textContent = String(9 - counts[n-1]);
      btn.setAttribute('aria-pressed','false');
    });
  }

  function updateMistakes() {
    if (mistakesEl) mistakesEl.textContent = String(mistakes);
    if (mistakesMini) mistakesMini.textContent = String(mistakes);
  }

  function updateUndoButton() {
    if (!undoBtn) return;
    if (undoStack.length) undoBtn.removeAttribute('disabled'); else undoBtn.setAttribute('disabled', 'true');
  }

  // keyboard input intentionally DE-prioritized: digit bank is primary method.
  // (If you later want keyboard too, we can re-enable.)

  // init
  function init() {
    restart('medium');
    attachDigitBank();
    // recompute lines & overlays on resize
    let t;
    window.addEventListener('resize', () => {
      clearTimeout(t);
      t = setTimeout(() => { installGridLines(); positionOverlays(); }, 120);
    });
  }

  // expose restart for debugging
  window.sudokuRestart = restart;

  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', init);
  else init();

})(); 
