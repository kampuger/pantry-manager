import { View, Text } from 'react-native';

export function RecipeOcrScreen() {
  // ocrProvider from '@pantry/ocr' resolves to ocr.native.ts here via Metro's
  // platform-suffix resolution — wired up fully in the Recipe OCR feature plan.
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Text>Recipe OCR Inspector</Text>
    </View>
  );
}
