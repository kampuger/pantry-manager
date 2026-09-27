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
      // characters injected at the start of each line. SINGLE_BLOCK treats
      // the whole image as one block of uniform text and reads it line by
      // line without that layout analysis — found via a live test on a
      // receipt where AUTO produced garbage prefixes ("Ta ", "AN ", "| ")
      // on every item line. This is the only OCR call site in the app
      // (receipt scanning), so it's safe to set globally rather than
      // per-call.
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
      return worker;
    })();
  }
  return workerPromise;
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
