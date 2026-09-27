// packages/ocr/src/ocr.web.ts
//
// This file must be deep-imported by web consumers (`@pantry/ocr/src/ocr.web`),
// never via the bare `@pantry/ocr` package name. The `browser` field below in
// package.json is NOT sufficient on its own — Next.js's SSR bundle resolves
// the bare specifier via `main`, not `browser`, for this package.
//
// The assets under apps/web/public/tesseract/ (worker.min.js and the two
// tesseract-core*.wasm.js files) are hand-copied from this package's
// tesseract.js / tesseract.js-core dependencies at their currently-pinned
// version (5.1.1). If those deps are ever upgraded, re-copy the assets —
// a version mismatch surfaces as a confusing runtime failure, not a build error.
import { createWorker, type Worker } from 'tesseract.js';
import type { IOcrProvider, OcrInput, OcrResult } from './types';

// Memoize the in-flight promise (not the resolved worker) so concurrent
// callers await the same creation instead of each spawning their own worker.
let workerPromise: Promise<Worker> | null = null;

// The worker is intentionally never terminated — it's kept alive for the
// tab's lifetime since re-initializing costs several seconds. This is a
// deliberate tradeoff, not an oversight.
//
// Page-segmentation mode is deliberately left at Tesseract's default (AUTO),
// not overridden. SINGLE_BLOCK and SINGLE_COLUMN were both tried live against
// a receipt with a garbled table border, on the theory that AUTO's full
// layout analysis was misreading the column rule as stray characters.
// Neither improved it, and SINGLE_COLUMN combined with the binarization
// below (see preprocessForOcr) made real columns unreadable that AUTO had
// read correctly. AUTO is the best-tested option for this app.
async function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = createWorker('eng', 1, {
      workerPath: '/tesseract/worker.min.js',
      // Directory form (no filename) lets tesseract.js's own getCore.js do
      // SIMD feature detection at runtime and pick tesseract-core-simd-lstm
      // or tesseract-core-lstm accordingly. Both must be present under
      // apps/web/public/tesseract/.
      corePath: '/tesseract',
      langPath: '/tesseract',
    });
  }
  return workerPromise;
}

// Resizes an arbitrary camera photo to a consistent target resolution before
// OCR — very large or very small source photos both hurt Tesseract's LSTM
// engine, which expects text around a particular pixel height. This does
// NOT convert to grayscale or binarize (no thresholding to pure
// black-and-white): a live test on a receipt with uneven lighting showed
// that a global black/white threshold destroys columns the LSTM engine
// could otherwise read from the original color/grayscale data — the LSTM
// model does its own internal adaptive binarization tuned for how it was
// trained, and a naive threshold on top of that throws away information
// rather than adding it.
const TARGET_LONG_EDGE_PX = 2200;

async function resizeForOcr(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = TARGET_LONG_EDGE_PX / Math.max(bitmap.width, bitmap.height);
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 2D context unavailable — cannot resize the receipt photo');
  }
  ctx.drawImage(bitmap, 0, 0, width, height);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Failed to encode the resized receipt photo'));
    }, 'image/png');
  });
}

export const ocrProvider: IOcrProvider = {
  async extractText(input: OcrInput): Promise<OcrResult> {
    if (input.kind !== 'web-file') {
      throw new Error('Web OCR provider requires a web-file input');
    }

    const { file } = input;
    let objectUrl: string | null = null;

    try {
      const resized = await resizeForOcr(file);
      objectUrl = URL.createObjectURL(resized);
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
