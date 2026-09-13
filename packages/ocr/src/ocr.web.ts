// packages/ocr/src/ocr.web.ts
import { createWorker, type Worker } from 'tesseract.js';
import type { IOcrProvider, OcrInput, OcrResult } from './types';

let workerSingleton: Worker | null = null;

async function getWorker(): Promise<Worker> {
  if (!workerSingleton) {
    workerSingleton = await createWorker('eng', 1, {
      workerPath: '/tesseract/worker.min.js',
      corePath: '/tesseract/tesseract-core.wasm.js',
    });
  }
  return workerSingleton;
}

export const ocrProvider: IOcrProvider = {
  async extractText(input: OcrInput): Promise<OcrResult> {
    if (input.kind !== 'web-file') {
      throw new Error('Web OCR provider requires a web-file input');
    }

    const { file } = input;
    let objectUrl: string | null = null;

    try {
      objectUrl = URL.createObjectURL(file);
      const worker = await getWorker();
      const { data } = await worker.recognize(objectUrl);
      return {
        rawText: data.text,
        confidence: data.confidence / 100,
      };
    } finally {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    }
  },
};
