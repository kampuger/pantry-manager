import { View, Text } from 'react-native';

export function RecipeOcrScreen() {
  // ocrProvider from '@pantry/ocr' resolves to ocr.native.ts here via Metro's
  // "react-native" package.json field (not file-suffix resolution — see
  // packages/ocr/package.json). The Next.js web build has a separate,
  // still-unresolved issue where its server compiler picks the wrong
  // adapter for client components; that's deferred to the OCR feature task.
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Text>Recipe OCR Inspector</Text>
    </View>
  );
}
