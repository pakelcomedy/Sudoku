// lib/sudoku_vm.dart
//
// SudokuViewModel - single VM for a Sudoku game
// - generates puzzles (attempts unique solution)
// - solver & solution-check
// - undo stack
// - candidates (notes)
// - conflict detection
// - elapsed timer
// - local persistence (SharedPreferences JSON)
//

import 'dart:async';
import 'dart:convert';
import 'dart:math';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

enum SudokuDifficulty { easy, medium, hard }

class SudokuViewModel extends ChangeNotifier {
  // Public state read by the view
  late List<List<int>> board; // 9x9, 0 = empty
  late List<List<bool>> fixed; // if given (cannot change)
  List<List<Set<int>>> candidates = List.generate(9, (_) => List.generate(9, (_) => <int>{}));
  int? selectedRow;
  int? selectedCol;
  bool isNoteMode = false;
  bool isSolved = false;
  int elapsedSeconds = 0;
  int mistakes = 0;

  // Internal
  late List<List<int>> _solution; // full solved grid backing this puzzle
  final List<_UndoState> _undoStack = [];
  Timer? _timer;
  final Random _rng = Random();

  // Persistence key
  static const String _prefsKey = 'sudoku_save_v1';

  // Constructor: auto-start a new puzzle, then attempt to load any saved game
  SudokuViewModel({SudokuDifficulty difficulty = SudokuDifficulty.medium}) {
    restart(difficulty: difficulty);
    // try to load saved game asynchronously; if found it'll override current state and notifyListeners
    _tryLoadFromDisk();
  }

  // -------------------------
  // Public API (used by view)
  // -------------------------

  bool get canUndo => _undoStack.isNotEmpty;

  /// Expose whether there is a saved game on disk
  Future<bool> get hasSavedGame async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.containsKey(_prefsKey);
  }

  /// Force-save current game state to disk
  Future<void> saveToDisk() async {
    await _saveToPrefs();
  }

  /// Force-load saved game (if present). Returns true if loaded.
  Future<bool> loadFromDisk() async {
    return await _loadFromPrefs();
  }

  /// Remove saved game on disk (if any)
  Future<void> clearSavedGame() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_prefsKey);
  }

  // Restart (generate new puzzle)
  void restart({SudokuDifficulty difficulty = SudokuDifficulty.medium}) {
    _stopTimer();
    elapsedSeconds = 0;
    mistakes = 0;
    selectedRow = null;
    selectedCol = null;
    isNoteMode = false;
    _undoStack.clear();
    _generatePuzzle(difficulty);
    isSolved = _checkSolved();
    _startTimer();
    notifyListeners();
    // persist new game automatically
    _saveToPrefs();
  }

  // Undo last move
  void undo() {
    if (_undoStack.isEmpty) return;
    final state = _undoStack.removeLast();
    board = _deepCopyGrid(state.board);
    // restore candidates
    candidates = state.candidates.map((row) => row.map((s) => Set<int>.from(s)).toList()).toList();
    mistakes = state.mistakes;
    selectedRow = state.selectedRow;
    selectedCol = state.selectedCol;
    isSolved = _checkSolved();
    notifyListeners();
    _saveToPrefs();
  }

  // Select / toggle selection
  void selectCell(int r, int c) {
    if (selectedRow == r && selectedCol == c) {
      selectedRow = null;
      selectedCol = null;
    } else {
      selectedRow = r;
      selectedCol = c;
    }
    notifyListeners();
    // selection does not alter saved game
  }

  // Toggle note mode
  void toggleNoteMode() {
    isNoteMode = !isNoteMode;
    notifyListeners();
    // preference-like, save it
    _saveToPrefs();
  }

  // Toggle candidate (note) in a cell
  void toggleCandidate(int r, int c, int value) {
    if (!_inBounds(r, c) || value < 1 || value > 9) return;
    if (fixed[r][c]) return;
    final set = candidates[r][c];
    _pushUndo();
    if (set.contains(value)) {
      set.remove(value);
    } else {
      set.add(value);
    }
    notifyListeners();
    _saveToPrefs();
  }

  // Clear a cell (only if not fixed). Pushes undo.
  void clearCell(int r, int c) {
    if (!_inBounds(r, c)) return;
    if (fixed[r][c]) return;
    _pushUndo();
    board[r][c] = 0;
    candidates[r][c].clear();
    isSolved = _checkSolved();
    notifyListeners();
    _saveToPrefs();
  }

  // Set a number (normal input). If note mode enabled, toggle candidate instead.
  void setNumber(int r, int c, int value) {
    if (!_inBounds(r, c) || value < 1 || value > 9) return;
    if (fixed[r][c]) return;

    if (isNoteMode) {
      toggleCandidate(r, c, value);
      return;
    }

    _pushUndo();
    board[r][c] = value;
    // clear candidate list for that cell
    candidates[r][c].clear();

    // Mistake counting: compare with generated solution
    if (_solution[r][c] != value) {
      mistakes++;
    }

    isSolved = _checkSolved();
    notifyListeners();
    _saveToPrefs();
  }

  // Check if there is a duplicate conflict at r,c (row/col/box duplicate excluding zero)
  bool hasConflictAt(int r, int c) {
    if (!_inBounds(r, c)) return false;
    final val = board[r][c];
    if (val == 0) return false;

    // Row
    for (int cc = 0; cc < 9; cc++) {
      if (cc == c) continue;
      if (board[r][cc] == val) return true;
    }

    // Column
    for (int rr = 0; rr < 9; rr++) {
      if (rr == r) continue;
      if (board[rr][c] == val) return true;
    }

    // Box
    final br = (r ~/ 3) * 3;
    final bc = (c ~/ 3) * 3;
    for (int rr = br; rr < br + 3; rr++) {
      for (int cc = bc; cc < bc + 3; cc++) {
        if (rr == r && cc == c) continue;
        if (board[rr][cc] == val) return true;
      }
    }

    return false;
  }

  // -------------------------
  // Internal helpers
  // -------------------------

  void _generatePuzzle(SudokuDifficulty difficulty) {
    // 1) create a full solved grid
    _solution = _createSolvedGrid();

    // 2) copy solution to board and mark fixed
    board = _deepCopyGrid(_solution);
    fixed = List.generate(9, (r) => List.generate(9, (c) => true));

    // 3) remove cells based on difficulty while attempting to keep unique solution
    int removalTarget;
    switch (difficulty) {
      case SudokuDifficulty.easy:
        removalTarget = 36; // approx remaining 45
        break;
      case SudokuDifficulty.medium:
        removalTarget = 44; // approx remaining 37
        break;
      case SudokuDifficulty.hard:
        removalTarget = 52; // approx remaining 29
        break;
    }

    _removeCellsWithUniquenessCheck(removalTarget);

    // any remaining candidates cleared
    candidates = List.generate(9, (_) => List.generate(9, (_) => <int>{}));

    // mark fixed: true if non-zero
    for (int r = 0; r < 9; r++) {
      for (int c = 0; c < 9; c++) {
        fixed[r][c] = board[r][c] != 0;
      }
    }
  }

  // Create a fully filled solved grid using randomized backtracking
  List<List<int>> _createSolvedGrid() {
    final grid = List.generate(9, (_) => List<int>.filled(9, 0));
    // Fill with backtracking
    bool fillCell(int r, int c) {
      if (r == 9) return true;
      final nextR = c == 8 ? r + 1 : r;
      final nextC = c == 8 ? 0 : c + 1;

      // shuffle numbers 1..9
      final nums = List<int>.generate(9, (i) => i + 1)..shuffle(_rng);
      for (int n in nums) {
        if (_canPlace(grid, r, c, n)) {
          grid[r][c] = n;
          if (fillCell(nextR, nextC)) return true;
          grid[r][c] = 0;
        }
      }
      return false;
    }

    final success = fillCell(0, 0);
    if (!success) {
      // Should not normally happen, but fallback to a deterministic fill
      throw StateError('Failed to generate solved grid');
    }
    return grid;
  }

  // Check if placing number n at r,c is valid considering current grid
  bool _canPlace(List<List<int>> g, int r, int c, int n) {
    // row/col
    for (int i = 0; i < 9; i++) {
      if (g[r][i] == n) return false;
      if (g[i][c] == n) return false;
    }
    // box
    final br = (r ~/ 3) * 3;
    final bc = (c ~/ 3) * 3;
    for (int rr = br; rr < br + 3; rr++) {
      for (int cc = bc; cc < bc + 3; cc++) {
        if (g[rr][cc] == n) return false;
      }
    }
    return true;
  }

  // Attempt to remove `target` cells while keeping uniqueness as much as possible.
  // This may fail to achieve exact target in rare cases; it's ok.
  void _removeCellsWithUniquenessCheck(int targetRemovals) {
    // list of all positions shuffled
    final pos = List.generate(81, (i) => i)..shuffle(_rng);
    int removed = 0;

    for (int idx in pos) {
      if (removed >= targetRemovals) break;
      final r = idx ~/ 9;
      final c = idx % 9;
      if (board[r][c] == 0) continue;

      final backup = board[r][c];
      board[r][c] = 0;

      // Quick heuristic: check if puzzle still has unique solution with solver limited to 2 solutions
      final copy = _deepCopyGrid(board);
      int solutions = _countSolutions(copy, limit: 2);
      if (solutions != 1) {
        // revert removal if not unique
        board[r][c] = backup;
      } else {
        removed++;
      }
    }

    // If we didn't remove enough (due to uniqueness constraints), do additional blind removals
    if (removed < targetRemovals) {
      for (int idx in pos) {
        if (removed >= targetRemovals) break;
        final r = idx ~/ 9;
        final c = idx % 9;
        if (board[r][c] != 0) {
          board[r][c] = 0;
          removed++;
        }
      }
    }
  }

  // Count number of solutions of a partially-filled grid, stop early if >= limit
  int _countSolutions(List<List<int>> g, {int limit = 2}) {
    int count = 0;

    bool solveNext() {
      // find empty
      int rr = -1, cc = -1;
      for (int r = 0; r < 9; r++) {
        for (int c = 0; c < 9; c++) {
          if (g[r][c] == 0) {
            rr = r;
            cc = c;
            break;
          }
        }
        if (rr != -1) break;
      }

      if (rr == -1) {
        count++;
        return count >= limit;
      }

      // try candidates 1..9 in some fixed order
      for (int n = 1; n <= 9; n++) {
        if (_canPlace(g, rr, cc, n)) {
          g[rr][cc] = n;
          final stop = solveNext();
          g[rr][cc] = 0;
          if (stop) return true;
        }
      }
      return false;
    }

    solveNext();
    return count;
  }

  // Check whether board matches solution fully
  bool _checkSolved() {
    for (int r = 0; r < 9; r++) {
      for (int c = 0; c < 9; c++) {
        if (board[r][c] != _solution[r][c]) return false;
      }
    }
    return true;
  }

  // -------------------------
  // Utility & Undo management
  // -------------------------

  void _pushUndo() {
    // push deep copy of board and candidates
    _undoStack.add(_UndoState(
      board: _deepCopyGrid(board),
      candidates: candidates.map((row) => row.map((s) => Set<int>.from(s)).toList()).toList(),
      mistakes: mistakes,
      selectedRow: selectedRow,
      selectedCol: selectedCol,
    ));

    // keep undo depth reasonable
    if (_undoStack.length > 100) {
      _undoStack.removeAt(0);
    }
  }

  List<List<int>> _deepCopyGrid(List<List<int>> src) {
    return List.generate(9, (r) => List<int>.from(src[r]));
  }

  bool _inBounds(int r, int c) => r >= 0 && r < 9 && c >= 0 && c < 9;

  // -------------------------
  // Timer
  // -------------------------
  void _startTimer() {
    _timer?.cancel();
    _timer = Timer.periodic(const Duration(seconds: 1), (_) {
      elapsedSeconds++;
      // avoid too many notifications: only notify each second (UI needs it)
      notifyListeners();
      // persist timer occasionally (every 5 seconds) to avoid excessive writes
      if (elapsedSeconds % 5 == 0) {
        _saveToPrefs();
      }
    });
  }

  void _stopTimer() {
    _timer?.cancel();
    _timer = null;
  }

  @override
  void dispose() {
    _stopTimer();
    super.dispose();
  }

  // -------------------------
  // Persistence (SharedPreferences JSON)
  // -------------------------

  Future<void> _saveToPrefs() async {
    try {
      final prefs = await SharedPreferences.getInstance();

      final map = <String, dynamic>{
        'board': board,
        'fixed': fixed.map((r) => r.map((b) => b ? 1 : 0).toList()).toList(),
        // candidates -> convert Set<int> to List<int>
        'candidates': candidates
            .map((row) => row.map((s) => s.toList()).toList())
            .toList(),
        'solution': _solution,
        'selectedRow': selectedRow,
        'selectedCol': selectedCol,
        'isNoteMode': isNoteMode ? 1 : 0,
        'isSolved': isSolved ? 1 : 0,
        'elapsedSeconds': elapsedSeconds,
        'mistakes': mistakes,
      };

      final jsonStr = jsonEncode(map);
      await prefs.setString(_prefsKey, jsonStr);
    } catch (e) {
      // non-fatal: notify in debug
      if (kDebugMode) {
        print('Failed to save sudoku state: $e');
      }
    }
  }

  Future<bool> _loadFromPrefs() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      if (!prefs.containsKey(_prefsKey)) return false;
      final jsonStr = prefs.getString(_prefsKey);
      if (jsonStr == null) return false;
      final dynamic decoded = jsonDecode(jsonStr);
      if (decoded is! Map) return false;
      final Map<String, dynamic> map = Map<String, dynamic>.from(decoded);

      // parse board
      final rawBoard = map['board'] as List<dynamic>;
      final newBoard = List<List<int>>.generate(9, (r) {
        final row = rawBoard[r] as List<dynamic>;
        return List<int>.generate(9, (c) => (row[c] as num).toInt());
      });

      // parse fixed
      final rawFixed = map['fixed'] as List<dynamic>;
      final newFixed = List<List<bool>>.generate(9, (r) {
        final row = rawFixed[r] as List<dynamic>;
        return List<bool>.generate(9, (c) => (row[c] as num).toInt() != 0);
      });

      // parse candidates
      final rawCands = map['candidates'] as List<dynamic>;
      final newCands = List<List<Set<int>>>.generate(9, (r) {
        final row = rawCands[r] as List<dynamic>;
        return List<Set<int>>.generate(9, (c) {
          final list = row[c] as List<dynamic>;
          return Set<int>.from(list.map((e) => (e as num).toInt()));
        });
      });

      // parse solution
      final rawSol = map['solution'] as List<dynamic>;
      final newSol = List<List<int>>.generate(9, (r) {
        final row = rawSol[r] as List<dynamic>;
        return List<int>.generate(9, (c) => (row[c] as num).toInt());
      });

      // parse scalars
      final newSelectedRow = map['selectedRow'] == null ? null : (map['selectedRow'] as num).toInt();
      final newSelectedCol = map['selectedCol'] == null ? null : (map['selectedCol'] as num).toInt();
      final newIsNoteMode = (map['isNoteMode'] ?? 0) as num != 0;
      final newIsSolved = (map['isSolved'] ?? 0) as num != 0;
      final newElapsed = (map['elapsedSeconds'] ?? 0) as num;
      final newMistakes = (map['mistakes'] ?? 0) as num;

      // apply loaded state (replace current)
      _stopTimer();
      board = newBoard;
      fixed = newFixed;
      candidates = newCands;
      _solution = newSol;
      selectedRow = newSelectedRow;
      selectedCol = newSelectedCol;
      isNoteMode = newIsNoteMode;
      isSolved = newIsSolved;
      elapsedSeconds = newElapsed.toInt();
      mistakes = newMistakes.toInt();

      // clear undo (we don't persist undo stack)
      _undoStack.clear();

      // restart timer and notify
      _startTimer();
      notifyListeners();
      return true;
    } catch (e) {
      if (kDebugMode) print('Failed to load sudoku state: $e');
      return false;
    }
  }

  // Async attempt to load saved game at startup - doesn't block constructor
  void _tryLoadFromDisk() {
    _loadFromPrefs().then((loaded) {
      if (loaded) {
        if (kDebugMode) print('Loaded saved sudoku state from disk.');
      }
    });
  }
}

// Internal undo snapshot
class _UndoState {
  final List<List<int>> board;
  final List<List<Set<int>>> candidates;
  final int mistakes;
  final int? selectedRow;
  final int? selectedCol;

  _UndoState({
    required this.board,
    required this.candidates,
    required this.mistakes,
    required this.selectedRow,
    required this.selectedCol,
  });
}
