// lib/sudoku_view.dart
// Clean, flat Sudoku board with pure black grid lines, thick separators for 3x3,
// no outer border, zero spacing between cells, two-row number input, large borderless digits,
// controls: New game + difficulty (E/M/H) placed top-right above the board, Clear + Undo + Mistakes in footer.
// Added: lightweight sound effects (no external assets) using SystemSound.

import 'dart:async';
import 'dart:math';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'sudoku_vm.dart';

/// Simple sound service using built-in SystemSound (no external assets).
/// Provides sequences to represent different events (tap, correct, wrong, complete, new).
class SoundService {
  static bool enabled = true;

  static void _playClick() {
    if (!enabled) return;
    SystemSound.play(SystemSoundType.click);
  }

  // Play a sequence of clicks with given gaps (ms). Non-blocking.
  static Future<void> _playSequence(List<int> gapsMs) async {
    if (!enabled) return;
    for (int i = 0; i < gapsMs.length; i++) {
      _playClick();
      await Future.delayed(Duration(milliseconds: gapsMs[i]));
    }
  }

  // Public helpers
  static void playTap() {
    // single short click
    _playClick();
  }

  static void playCorrect() {
    // pleasant two-click burst + light haptic
    _playSequence([140]);
    HapticFeedback.lightImpact();
  }

  static void playWrong() {
    // three quick clicks + heavier haptic
    _playSequence([90, 90]);
    HapticFeedback.vibrate();
  }

  static void playComplete() {
    // celebratory four clicks with gaps
    _playSequence([100, 120, 140]);
    HapticFeedback.heavyImpact();
  }

  static void playNew() {
    // short pattern for new game
    _playSequence([90, 90]);
    HapticFeedback.selectionClick();
  }
}

class SudokuView extends StatefulWidget {
  const SudokuView({super.key});

  @override
  State<SudokuView> createState() => _SudokuViewState();
}

class _SudokuViewState extends State<SudokuView> {
  // keep selected difficulty in UI state so "New Game" uses last choice
  SudokuDifficulty _difficulty = SudokuDifficulty.medium;

  @override
  Widget build(BuildContext context) {
    return Consumer<SudokuViewModel>(builder: (context, vm, _) {
      return Scaffold(
        backgroundColor: const Color(0xFFFDF9F4),
        body: SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              children: [
                // Top controls row: placed above the board, aligned to the right.
                // Enlarged: refresh icon + difficulty chips (E/M/H).
                _TopControls(
                  difficulty: _difficulty,
                  onDifficultyChanged: (d) {
                    // play small feedback, change difficulty and immediately start new game
                    SoundService.playTap();
                    setState(() => _difficulty = d);
                    vm.restart(difficulty: d);
                  },
                  onNewPressed: () {
                    SoundService.playNew();
                    vm.restart(difficulty: _difficulty);
                  },
                ),

                const SizedBox(height: 8),

                // Board area (expanded)
                Expanded(
                  child: Center(
                    child: LayoutBuilder(builder: (context, constraints) {
                      final size = min(constraints.maxWidth, constraints.maxHeight);
                      return SizedBox(
                        width: size,
                        height: size,
                        child: _ClassicBoard(vm: vm),
                      );
                    }),
                  ),
                ),
                const SizedBox(height: 10),
                // Footer: Clear + Undo + Mistakes (compact)
                _TinyFooter(vm: vm),
                const SizedBox(height: 8),
                // Two-row number input (large, borderless digits)
                _NumberInputRow(vm: vm),
              ],
            ),
          ),
        ),
      );
    });
  }
}

// -------------------------
// Top controls widget (bigger & right-aligned)
// -------------------------
class _TopControls extends StatelessWidget {
  final SudokuDifficulty difficulty;
  final ValueChanged<SudokuDifficulty> onDifficultyChanged;
  final VoidCallback onNewPressed;

  const _TopControls({
    required this.difficulty,
    required this.onDifficultyChanged,
    required this.onNewPressed,
  });

  Widget _diffChip(String label, SudokuDifficulty d, bool selected, ValueChanged<SudokuDifficulty> onTap) {
    return InkWell(
      onTap: () => onTap(d),
      borderRadius: BorderRadius.circular(10),
      child: Container(
        width: 42,
        height: 34,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: selected ? Colors.black : Colors.transparent,
          borderRadius: BorderRadius.circular(10),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 16,
            fontWeight: FontWeight.w900,
            color: selected ? Colors.white : Colors.black,
            height: 1.0,
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    // Align to the right, larger controls
    return SizedBox(
      height: 44,
      child: Row(
        children: [
          const Spacer(),
          // New game button (larger icon)
          SizedBox(
            width: 46,
            height: 36,
            child: Material(
              color: Colors.transparent,
              child: IconButton(
                padding: EdgeInsets.zero,
                iconSize: 24,
                splashRadius: 22,
                onPressed: onNewPressed,
                icon: const Icon(Icons.refresh),
                tooltip: 'New',
              ),
            ),
          ),
          const SizedBox(width: 12),
          // Difficulty chips (E / M / H) — made larger and easier to tap
          _diffChip('E', SudokuDifficulty.easy, difficulty == SudokuDifficulty.easy, onDifficultyChanged),
          const SizedBox(width: 8),
          _diffChip('M', SudokuDifficulty.medium, difficulty == SudokuDifficulty.medium, onDifficultyChanged),
          const SizedBox(width: 8),
          _diffChip('H', SudokuDifficulty.hard, difficulty == SudokuDifficulty.hard, onDifficultyChanged),
        ],
      ),
    );
  }
}

// -------------------------
// Board (unchanged visual logic + animations)
// -------------------------
class _ClassicBoard extends StatefulWidget {
  final SudokuViewModel vm;
  const _ClassicBoard({required this.vm});

  @override
  State<_ClassicBoard> createState() => _ClassicBoardState();
}

class _ClassicBoardState extends State<_ClassicBoard> with TickerProviderStateMixin {
  late AnimationController _selectCtrl;
  late AnimationController _completePulseCtrl;

  late List<List<int>> _prevBoard;
  int _prevMistakes = 0;
  final Map<String, double> _cellScale = {};

  @override
  void initState() {
    super.initState();
    _selectCtrl = AnimationController(vsync: this, duration: const Duration(milliseconds: 200));
    _completePulseCtrl = AnimationController(vsync: this, duration: const Duration(milliseconds: 420));
    widget.vm.addListener(_onVmChanged);
    _prevBoard = _deepCopyGrid(widget.vm.board);
    _prevMistakes = widget.vm.mistakes;
    if (widget.vm.selectedRow != null && widget.vm.selectedCol != null) {
      _selectCtrl.value = 1.0;
    }
  }

  @override
  void didUpdateWidget(covariant _ClassicBoard oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.vm != widget.vm) {
      oldWidget.vm.removeListener(_onVmChanged);
      widget.vm.addListener(_onVmChanged);
      _prevBoard = _deepCopyGrid(widget.vm.board);
      _prevMistakes = widget.vm.mistakes;
    }
  }

  void _onVmChanged() {
    final sr = widget.vm.selectedRow;
    final sc = widget.vm.selectedCol;
    if (sr != null && sc != null) {
      _selectCtrl.forward();
    } else {
      _selectCtrl.reverse();
    }

    final currBoard = widget.vm.board;
    int? changedR;
    int? changedC;
    int prevVal = 0;
    int currVal = 0;

    outer:
    for (int r = 0; r < 9; r++) {
      for (int c = 0; c < 9; c++) {
        if (_prevBoard[r][c] != currBoard[r][c]) {
          changedR = r;
          changedC = c;
          prevVal = _prevBoard[r][c];
          currVal = currBoard[r][c];
          break outer;
        }
      }
    }

    final rowCompleteBefore = _isRowComplete(_prevBoard, widget.vm.selectedRow);
    final colCompleteBefore = _isColComplete(_prevBoard, widget.vm.selectedCol);
    final boxCompleteBefore = _isBoxCompleteForSelection(_prevBoard, widget.vm.selectedRow, widget.vm.selectedCol);

    final rowCompleteNow = _isRowComplete(currBoard, widget.vm.selectedRow);
    final colCompleteNow = _isColComplete(currBoard, widget.vm.selectedCol);
    final boxCompleteNow = _isBoxCompleteForSelection(currBoard, widget.vm.selectedRow, widget.vm.selectedCol);

    if ((!rowCompleteBefore && rowCompleteNow) ||
        (!colCompleteBefore && colCompleteNow) ||
        (!boxCompleteBefore && boxCompleteNow)) {
      _completePulseCtrl.forward(from: 0.0);
      SoundService.playComplete();
    }

    // detect wrong placement (mistake increment) BEFORE updating prev snapshot
    if (widget.vm.mistakes > _prevMistakes) {
      SoundService.playWrong();
    } else if (changedR != null && changedC != null) {
      // if placed and mistakes didn't increase, it's correct
      final wasCorrect = widget.vm.mistakes == _prevMistakes && currVal != 0;
      if (wasCorrect) {
        SoundService.playCorrect();
      }
    }

    if (changedR != null && changedC != null) {
      final newMistakes = widget.vm.mistakes;
      final wasCorrect = newMistakes == _prevMistakes;
      if (wasCorrect && currVal != 0) {
        _triggerCellPulse(changedR, changedC);
      }
    }

    _prevBoard = _deepCopyGrid(currBoard);
    _prevMistakes = widget.vm.mistakes;

    if (mounted) setState(() {});
  }

  void _triggerCellPulse(int r, int c) {
    final key = '${r}_$c';
    _cellScale[key] = 1.14;
    if (mounted) setState(() {});
    Future.delayed(const Duration(milliseconds: 220), () {
      _cellScale[key] = 1.0;
      if (mounted) setState(() {});
      Future.delayed(const Duration(milliseconds: 220), () {
        _cellScale.remove(key);
        if (mounted) setState(() {});
      });
    });
  }

  List<List<int>> _deepCopyGrid(List<List<int>> src) {
    return List.generate(9, (r) => List<int>.from(src[r]));
  }

  bool _isRowComplete(List<List<int>> board, int? r) {
    if (r == null) return false;
    for (int c = 0; c < 9; c++) if (board[r][c] == 0) return false;
    return true;
  }

  bool _isColComplete(List<List<int>> board, int? c) {
    if (c == null) return false;
    for (int r = 0; r < 9; r++) if (board[r][c] == 0) return false;
    return true;
  }

  bool _isBoxCompleteForSelection(List<List<int>> board, int? selR, int? selC) {
    if (selR == null || selC == null) return false;
    final br = (selR ~/ 3) * 3;
    final bc = (selC ~/ 3) * 3;
    for (int r = br; r < br + 3; r++) {
      for (int c = bc; c < bc + 3; c++) {
        if (board[r][c] == 0) return false;
      }
    }
    return true;
  }

  @override
  void dispose() {
    widget.vm.removeListener(_onVmChanged);
    _selectCtrl.dispose();
    _completePulseCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final board = widget.vm.board;
    final selectedRow = widget.vm.selectedRow;
    final selectedCol = widget.vm.selectedCol;

    return LayoutBuilder(builder: (context, constraints) {
      final boardSize = min(constraints.maxWidth, constraints.maxHeight);
      final cellSize = boardSize / 9.0;

      return Stack(
        children: [
          Positioned.fill(
            child: Column(
              children: List.generate(9, (r) {
                return SizedBox(
                  height: cellSize,
                  child: Row(
                    children: List.generate(9, (c) {
                      final val = board[r][c];
                      final fixed = widget.vm.fixed[r][c];
                      final isSelected = selectedRow == r && selectedCol == c;
                      final hasConflict = widget.vm.hasConflictAt(r, c);

                      final key = '${r}_$c';
                      final scale = _cellScale.containsKey(key) ? _cellScale[key]! : 1.0;

                      return SizedBox(
                        width: cellSize,
                        height: cellSize,
                        child: GestureDetector(
                          onTap: () {
                            SoundService.playTap();
                            widget.vm.selectCell(r, c);
                          },
                          onLongPress: () {
                            SoundService.playTap();
                            if (!fixed) widget.vm.clearCell(r, c);
                          },
                          child: Container(
                            color: Colors.white,
                            alignment: Alignment.center,
                            child: Stack(
                              children: [
                                Positioned.fill(
                                  child: Center(
                                    child: AnimatedScale(
                                      scale: scale,
                                      duration: const Duration(milliseconds: 180),
                                      curve: Curves.easeOutBack,
                                      child: FittedBox(
                                        fit: BoxFit.scaleDown,
                                        child: Text(
                                          val == 0 ? '' : val.toString(),
                                          style: TextStyle(
                                            fontSize: 72,
                                            fontWeight: fixed ? FontWeight.w700 : FontWeight.w500,
                                            color: hasConflict ? Colors.red : Colors.black,
                                            height: 1.0,
                                          ),
                                        ),
                                      ),
                                    ),
                                  ),
                                ),
                                if (isSelected)
                                  Positioned.fill(
                                    child: IgnorePointer(
                                      child: Container(
                                        color: Colors.black.withOpacity(0.04),
                                      ),
                                    ),
                                  ),
                              ],
                            ),
                          ),
                        ),
                      );
                    }),
                  ),
                );
              }),
            ),
          ),
          Positioned.fill(
            child: IgnorePointer(
              child: AnimatedBuilder(
                animation: Listenable.merge([_selectCtrl, _completePulseCtrl]),
                builder: (context, _) {
                  return CustomPaint(
                    painter: _HighlightGridPainter(
                      selectionOpacity: Curves.easeOut.transform(_selectCtrl.value) * 0.12,
                      pulseValue: Curves.easeOut.transform(_completePulseCtrl.value),
                      selectedRow: selectedRow,
                      selectedCol: selectedCol,
                    ),
                  );
                },
              ),
            ),
          ),
        ],
      );
    });
  }
}

class _HighlightGridPainter extends CustomPainter {
  final double selectionOpacity;
  final double pulseValue;
  final int? selectedRow;
  final int? selectedCol;

  _HighlightGridPainter({
    required this.selectionOpacity,
    required this.pulseValue,
    required this.selectedRow,
    required this.selectedCol,
  });

  final Color _lineColor = Colors.black;

  @override
  void paint(Canvas canvas, Size size) {
    final thinWidth = max(1.0, size.width * 0.0025);
    final thickWidth = max(2.4, size.width * 0.009);
    final paintThin = Paint()
      ..color = _lineColor
      ..strokeWidth = thinWidth
      ..style = PaintingStyle.stroke
      ..isAntiAlias = true;
    final paintThick = Paint()
      ..color = _lineColor
      ..strokeWidth = thickWidth
      ..style = PaintingStyle.stroke
      ..isAntiAlias = true;

    final cell = size.width / 9.0;

    if (selectedRow != null && selectedCol != null) {
      final sr = selectedRow!;
      final sc = selectedCol!;
      final rowRect = Rect.fromLTWH(0, sr * cell, size.width, cell);
      final colRect = Rect.fromLTWH(sc * cell, 0, cell, size.height);
      final br = (sr ~/ 3) * 3;
      final bc = (sc ~/ 3) * 3;
      final boxRect = Rect.fromLTWH(bc * cell, br * cell, cell * 3, cell * 3);

      final rowPaint = Paint()..color = Colors.black.withOpacity(selectionOpacity * 0.6);
      final colPaint = Paint()..color = Colors.black.withOpacity(selectionOpacity * 0.6);
      canvas.drawRect(rowRect, rowPaint);
      canvas.drawRect(colRect, colPaint);

      final boxPaint = Paint()..color = Colors.black.withOpacity(selectionOpacity * 0.92);
      canvas.drawRect(boxRect, boxPaint);

      final center = Offset((sc + 0.5) * cell, (sr + 0.5) * cell);
      canvas.drawCircle(center, cell * 0.06, Paint()..color = Colors.black.withOpacity(selectionOpacity * 0.9));

      if (pulseValue > 0.001) {
        final glowAlpha = 0.28 * (1.0 - pulseValue) + 0.06;
        final glow = Paint()..color = Colors.green.withOpacity(glowAlpha);
        final expand = cell * 0.6 * pulseValue;
        canvas.drawRect(rowRect.inflate(expand), glow);
        canvas.drawRect(colRect.inflate(expand), glow);
        canvas.drawRect(boxRect.inflate(expand * 0.6), glow);
      }
    }

    for (int i = 1; i < 9; i++) {
      final offset = cell * i;
      canvas.drawLine(Offset(offset, 0), Offset(offset, size.height), paintThin);
      canvas.drawLine(Offset(0, offset), Offset(size.width, offset), paintThin);
    }

    for (int i = 1; i < 9; i++) {
      if (i % 3 != 0) continue;
      final offset = cell * i;
      canvas.drawLine(Offset(offset, 0), Offset(offset, size.height), paintThick);
      canvas.drawLine(Offset(0, offset), Offset(size.width, offset), paintThick);
    }
  }

  @override
  bool shouldRepaint(covariant _HighlightGridPainter old) {
    return old.selectionOpacity != selectionOpacity ||
        old.pulseValue != pulseValue ||
        old.selectedRow != selectedRow ||
        old.selectedCol != selectedCol;
  }
}

// -------------------------
// Footer: Clear + Undo + Mistakes
// compact and minimal
// -------------------------
class _TinyFooter extends StatelessWidget {
  final SudokuViewModel vm;
  const _TinyFooter({required this.vm});

  @override
  Widget build(BuildContext context) {
    // layout: [left small padding] [Clear] [small gap] [Undo] [spacer] [mistakes]
    return SizedBox(
      height: 44,
      child: Row(
        children: [
          const SizedBox(width: 6),
          // Clear selected
          IconButton(
            onPressed: () {
              SoundService.playTap();
              final r = vm.selectedRow;
              final c = vm.selectedCol;
              if (r != null && c != null) vm.clearCell(r, c);
            },
            icon: const Icon(Icons.backspace_outlined),
            tooltip: 'Clear',
            splashRadius: 18,
          ),
          const SizedBox(width: 6),
          // Undo
          IconButton(
            onPressed: vm.canUndo
                ? () {
                    SoundService.playTap();
                    vm.undo();
                  }
                : null,
            icon: const Icon(Icons.undo),
            tooltip: 'Undo',
            splashRadius: 18,
          ),
          const Spacer(),
          // Mistakes (single number, minimal)
          Padding(
            padding: const EdgeInsets.only(right: 8.0),
            child: Text(
              '${vm.mistakes}',
              style: const TextStyle(fontSize: 14, color: Colors.black87, fontWeight: FontWeight.w700),
            ),
          ),
        ],
      ),
    );
  }
}

// -------------------------
// Number input: two rows, LARGE borderless digits (no boxes), small remaining under digit
// -------------------------
class _NumberInputRow extends StatelessWidget {
  final SudokuViewModel vm;
  const _NumberInputRow({required this.vm});

  // remaining per number (9 - count in board)
  List<int> _remainingPerNumber(List<List<int>> board) {
    final counts = List<int>.filled(9, 0);
    for (var r = 0; r < 9; r++) {
      for (var c = 0; c < 9; c++) {
        final v = board[r][c];
        if (v >= 1 && v <= 9) counts[v - 1]++;
      }
    }
    return List<int>.generate(9, (i) => 9 - counts[i]);
  }

  @override
  Widget build(BuildContext context) {
    final remaining = _remainingPerNumber(vm.board);
    final selectedRow = vm.selectedRow;
    final selectedCol = vm.selectedCol;

    return LayoutBuilder(builder: (context, constraints) {
      final maxWidth = constraints.maxWidth;
      const spacing = 8.0;
      final totalSpacing = spacing * 8;
      final cand = (maxWidth - totalSpacing) / 9.0;
      final tileWidth = max(48.0, min(80.0, cand));
      final tileHeight = 64.0;

      Widget buildTile(int n) {
        final rem = remaining[n - 1];
        final enabled = (selectedRow != null && selectedCol != null) || vm.isNoteMode;
        // visual: large digit, no border, subtle background when enabled
        final bg = enabled ? Colors.white : const Color(0xFFF6F6F6);

        return SizedBox(
          width: tileWidth,
          height: tileHeight,
          child: Material(
            color: bg,
            child: InkWell(
              borderRadius: BorderRadius.circular(6),
              onTap: (enabled && selectedRow != null && selectedCol != null)
                  ? () {
                      SoundService.playTap();
                      vm.setNumber(selectedRow!, selectedCol!, n);
                    }
                  : null,
              onLongPress: (enabled && selectedRow != null && selectedCol != null)
                  ? () {
                      SoundService.playTap();
                      if (vm.fixed[selectedRow!][selectedCol!]) return;
                      vm.toggleCandidate(selectedRow!, selectedCol!, n);
                    }
                  : null,
              splashFactory: InkRipple.splashFactory,
              child: Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    // Big digit (use FittedBox to avoid overflow)
                    Flexible(
                      child: FittedBox(
                        fit: BoxFit.scaleDown,
                        child: Text(
                          n.toString(),
                          style: TextStyle(
                            fontSize: tileHeight * 0.62,
                            fontWeight: FontWeight.w800,
                            color: enabled ? Colors.black : Colors.black38,
                            height: 1.0,
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(height: 4),
                    // small remaining count (minimal)
                    SizedBox(
                      height: 14,
                      child: FittedBox(
                        fit: BoxFit.scaleDown,
                        child: Text(
                          rem.toString(),
                          style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: enabled ? Colors.black54 : Colors.black26),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        );
      }

      final top = List.generate(5, (i) => i + 1);
      final bottom = List.generate(4, (i) => i + 6);

      return Column(
        children: [
          // top row (1..5)
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: top.map((n) {
              final isLast = n == top.last;
              return Padding(
                padding: EdgeInsets.only(right: isLast ? 0 : spacing),
                child: buildTile(n),
              );
            }).toList(),
          ),
          const SizedBox(height: 8),
          // bottom row (6..9) centered
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: bottom.map((n) {
              final isLast = n == bottom.last;
              return Padding(
                padding: EdgeInsets.only(right: isLast ? 0 : spacing),
                child: buildTile(n),
              );
            }).toList(),
          ),
          const SizedBox(height: 6),
        ],
      );
    });
  }
}
