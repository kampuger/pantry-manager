// packages/ocr/src/ocr.native.ts
import * as FileSystem from 'expo-file-system';
import TextRecognition from '@react-native-ml-kit/text-recognition';
import type { IOcrProvider, OcrInput, OcrResult } from './types';

export const ocrProvider: IOcrProvider = {
  async extractText(input: OcrInput): Promise<OcrResult> {
    if (input.kind !== 'mobile-uri') {
      throw new Error('Native OCR provider requires a mobile-uri input');
    }

    const { uri } = input;

    try {
      const recognitionResult = await TextRecognition.recognize(uri);
      return {
        rawText: recognitionResult.text,
        confidence: 1.0,
      };
    } finally {
      const fileInfo = await FileSystem.getInfoAsync(uri);
      if (fileInfo.exists) {
        await FileSystem.deleteAsync(uri, { idempotent: true });
      }
    }
  },
};
