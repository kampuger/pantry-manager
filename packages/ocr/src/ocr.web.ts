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
import { createWorker, PSM, type Worker } from 'tesseract.js';
import type { IOcrProvider, OcrInput, OcrResult } from './types';

// Memoize the in-flight promise (not the resolved worker) so concurrent
// callers await the same creation instead of each spawning their own worker.
let workerPromise: Promise<Worker> | null = null;

// The worker is intentionally never terminated — it's kept alive for the
// tab's lifetime since re-initializing costs several seconds. This is a
// deliberate tradeoff, not an oversight.
async function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const worker = await createWorker('eng', 1, {
        workerPath: '/tesseract/worker.min.js',
        // Directory form (no filename) lets tesseract.js's own getCore.js do
        // SIMD feature detection at runtime and pick tesseract-core-simd-lstm
        // or tesseract-core-lstm accordingly. Both must be present under
        // apps/web/public/tesseract/.
        corePath: '/tesseract',
        langPath: '/tesseract',
      });
      // The default page-segmentation mode (AUTO) runs full layout analysis,
      // which on tabular receipts (a vertical rule between the description
      // and price columns) tends to misread the rule/border as stray
      // characters injected at the start of each line. SINGLE_BLOCK (tried
      // first, on a live receipt with garbage prefixes "Ta ", "AN ", "| ")
      // did not fix it; SINGLE_COLUMN — which still assumes one column but
      // tolerates variable-width lines, closer to a receipt's actual shape —
      // is the next thing to try. This is the only OCR call site in the app
      // (receipt scanning), so it's safe to set globally rather than
      // per-call.
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_COLUMN });
      return worker;
    })();
  }
  return workerPromise;
}

// Normalizes an arbitrary camera photo to a fixed resolution and converts it
// to pure black-and-white before OCR. Tesseract's accuracy is sensitive to
// both text size (a very high- or low-resolution source photo hurts it) and
// contrast (faint thermal-printer ink reads worse than crisp black-on-white)
// — added after page-segmentation-mode tuning alone didn't resolve stray
// characters injected at a receipt's table border. Otsu's method picks the
// black/white split point from the photo's own brightness histogram rather
// than a fixed guess, since phone photos vary a lot in lighting and exposure.
const TARGET_LONG_EDGE_PX = 2200;

async function preprocessForOcr(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = TARGET_LONG_EDGE_PX / Math.max(bitmap.width, bitmap.height);
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 2D context unavailable — cannot preprocess the receipt photo');
  }
  ctx.drawImage(bitmap, 0, 0, width, height);

  const imageData = ctx.getImageData(0, 0, width, height);
  const { data } = imageData;
  const pixelCount = width * height;

  const gray = new Uint8ClampedArray(pixelCount);
  const histogram = new Array(256).fill(0);
  for (let p = 0; p < pixelCount; p++) {
    const i = p * 4;
    const value = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    gray[p] = value;
    histogram[value]++;
  }

  const threshold = otsuThreshold(histogram, pixelCount);

  for (let p = 0; p < pixelCount; p++) {
    const value = gray[p] > threshold ? 255 : 0;
    const i = p * 4;
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
  }
  ctx.putImageData(imageData, 0, 0);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Failed to encode the preprocessed receipt photo'));
    }, 'image/png');
  });
}

// Finds the brightness threshold that best splits an image into two classes
// (background/text) by maximizing the variance between them — standard
// Otsu's method over a 256-bucket grayscale histogram.
function otsuThreshold(histogram: number[], pixelCount: number): number {
  let totalIntensity = 0;
  for (let t = 0; t < 256; t++) totalIntensity += t * histogram[t];

  let backgroundIntensitySum = 0;
  let backgroundWeight = 0;
  let maxVariance = 0;
  let threshold = 0;

  for (let t = 0; t < 256; t++) {
    backgroundWeight += histogram[t];
    if (backgroundWeight === 0) continue;
    const foregroundWeight = pixelCount - backgroundWeight;
    if (foregroundWeight === 0) break;

    backgroundIntensitySum += t * histogram[t];
    const backgroundMean = backgroundIntensitySum / backgroundWeight;
    const foregroundMean = (totalIntensity - backgroundIntensitySum) / foregroundWeight;

    const betweenClassVariance = backgroundWeight * foregroundWeight * (backgroundMean - foregroundMean) ** 2;
    if (betweenClassVariance > maxVariance) {
      maxVariance = betweenClassVariance;
      threshold = t;
    }
  }
  return threshold;
}

export const ocrProvider: IOcrProvider = {
  async extractText(input: OcrInput): Promise<OcrResult> {
    if (input.kind !== 'web-file') {
      throw new Error('Web OCR provider requires a web-file input');
    }

    const { file } = input;
    let objectUrl: string | null = null;

    try {
      const preprocessed = await preprocessForOcr(file);
      objectUrl = URL.createObjectURL(preprocessed);
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
