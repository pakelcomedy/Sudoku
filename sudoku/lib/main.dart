import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'sudoku_view.dart';
import 'sudoku_vm.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const SudokuApp());
}

class SudokuApp extends StatelessWidget {
  const SudokuApp({super.key});

  @override
  Widget build(BuildContext context) {
    return ChangeNotifierProvider<SudokuViewModel>(
      create: (_) => SudokuViewModel(),
      child: MaterialApp(
        debugShowCheckedModeBanner: false,
        title: 'Sudoku',
        theme: ThemeData(
          useMaterial3: true,
          brightness: Brightness.light,
          scaffoldBackgroundColor: const Color(0xFFF7F7F2),
          textTheme: const TextTheme(
            headlineSmall: TextStyle(fontWeight: FontWeight.w900),
            titleMedium: TextStyle(fontWeight: FontWeight.w700),
            labelSmall: TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w600,
              letterSpacing: 0.6,
            ),
          ),
        ),
        home: const SudokuView(),
      ),
    );
  }
}
