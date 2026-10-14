import 'package:flutter_test/flutter_test.dart';
import 'package:jarvis_mobile/main.dart';

void main() {
  testWidgets('Jarvis app starts', (tester) async {
    await tester.pumpWidget(const JarvisApp());
    expect(find.text('Jarvis'), findsOneWidget);
  });
}
