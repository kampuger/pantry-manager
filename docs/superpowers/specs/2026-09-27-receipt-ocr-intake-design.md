# Receipt OCR Intake

Status: Approved for planning
Date: 2026-09-27

## Problem

The bulk-add grid (`apps/web/src/components/pantry/BulkAddModal.tsx`) already supports typing rows, pasting a spreadsheet selection, uploading a `.csv`, and scanning barcodes — but every one of those requires either typing, an existing structured file, or a product that has a scannable barcode. A paper grocery receipt has neither: it's an unstructured photo, and most of its line items (produce, deli, bakery, house-brand goods) were never barcode-scanned by the store's own system in a way that would help here.

This spec adds a fifth intake path: snap or upload a photo of a receipt, run it through free, client-side OCR, and heuristically extract name+price line items straight into the grid — the same "extracted rows land in the grid, user reviews before saving" pattern every other intake path already uses.

**Hard constraint:** free only. No paid OCR API (Google Vision paid tier, AWS Textract, Azure Computer Vision) and no paid receipt-parsing service (Veryfi, Taggun, Nanonets). The repo already has `packages/ocr`, a cross-platform OCR abstraction (`IOcrProvider`) whose web implementation wraps `tesseract.js` — free, client-side, open-source. This spec reuses it rather than introducing a new OCR engine.

## Non-goals

- No quantity detection or subtotal/total cross-checking. A first version only extracts `{ name, price }` pairs; the user fixes anything wrong in the grid before saving, same as every other intake path's error-tolerance story.
- No custom live camera view. Unlike barcode scanning (which needs continuous frame-by-frame detection), this only needs one still photo — a plain `<input type="file" accept="image/*" capture="environment">` covers both "take a photo" (mobile) and "pick a file" (any device) with one control, no `getUserMedia` code needed.
- No changes to `apps/mobile` or its `RecipeOcrScreen.tsx` beyond correcting one stale code comment (see below) — this is a web-only feature, matching every other bulk-intake addition so far.
- No structured receipt-format detection (store-specific templates, line-item categories, discount handling). One generic heuristic for all receipts.

## Current state (for reference)

- `packages/ocr/src/types.ts`: `IOcrProvider.extractText(input: OcrInput): Promise<OcrResult>`, where `OcrInput` is `{ kind: 'mobile-uri'; uri: string } | { kind: 'web-file'; file: File }` and `OcrResult` is `{ rawText: string; confidence: number }`.
- `packages/ocr/src/ocr.web.ts`: wraps `tesseract.js`, calling `createWorker('eng', 1, { workerPath: '/tesseract/worker.min.js', corePath: '/tesseract/tesseract-core.wasm.js' })` — engine mode `1` is `OEM.LSTM_ONLY`. **These two paths don't currently exist under `apps/web/public/`** (confirmed: no `apps/web/public/tesseract/` directory) — this is a pre-existing, previously-flagged-but-unfixed bug; nothing has ever successfully run OCR on web before this feature, since nothing on web imports this module today.
- **Newly discovered and fixed during this spec's investigation:** `apps/mobile/src/screens/RecipeOcrScreen.tsx:1-4` carries a comment describing "a known, still-open issue" where `@pantry/ocr`'s package.json resolution breaks the Next.js web build. Root-caused: Next.js's webpack does not honor the `browser` field in `packages/ocr/package.json` when resolving the bare `@pantry/ocr` specifier — it resolves via `main` (`src/ocr.native.ts`) regardless, pulling in `@react-native-ml-kit/text-recognition` and `expo-file-system`, which fail to parse under Next's webpack loaders. Verified fix (isolated test build, both with and without `@pantry/ocr` in `transpilePackages` — neither the package.json fields nor `transpilePackages` matter here): **web code must import the file directly — `@pantry/ocr/src/ocr.web` — bypassing `main`/`browser` resolution entirely.** No `next.config.js` change needed.
- `apps/web/src/components/pantry/BulkAddModal.tsx`: `emptyRow(previous?: BulkRow)` (seeds unit/storageLocation/isProduce from the row above), `MAX_PASTE_ROWS = 200` (existing safety cap, reused here), and the CSV-upload pattern (`csvInputRef`, a hidden `<input type="file">`, a toolbar button that calls `.click()` on it, an `async handleXUpload(file: File)` function) — this feature follows that exact same shape.
- `packages/core/src/ingredientParser.ts`: existing precedent for a small regex-based text-line parser living in `packages/core` with its own Jest tests — `receiptParser.ts` follows the same convention.

## Part 1: Self-hosting the OCR assets (prerequisite fix)

Three files, all copied from already-resolvable npm packages into `apps/web/public/tesseract/` — mirrors exactly how the barcode scanner's `zxing_reader.wasm` was self-hosted:

1. `worker.min.js` ← `node_modules/tesseract.js/dist/worker.min.js`
2. `tesseract-core.wasm.js` and `tesseract-core.wasm` ← `node_modules/tesseract.js-core/tesseract-core.wasm.js` / `tesseract-core.wasm`
3. `eng.traineddata.gz` ← **the LSTM-only variant**, at `node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz` (verified by downloading and inspecting the actual npm tarball: the package contains both `4.0.0/eng.traineddata.gz`, 10.9MB, the full Tesseract+LSTM model, and `4.0.0_best_int/eng.traineddata.gz`, 2.9MB, LSTM-only — since `ocr.web.ts` already passes engine mode `1` = `OEM.LSTM_ONLY` to `createWorker`, only the LSTM-only variant is ever used, so that's the one to bundle). `@tesseract.js-data` is added as a new dependency of `packages/ocr` purely so this file is fetched reproducibly via `npm install`, the same way `zxing-wasm`'s binary came from an already-resolved transitive dependency.

`packages/ocr/src/ocr.web.ts`'s `createWorker` call gains one more option: `langPath: '/tesseract'`. Tesseract.js's own resolution rule (verified by reading its source) is `${langPath}/${lang}.traineddata.gz` — so this makes it request `/tesseract/eng.traineddata.gz`, matching where the file lands. Without an explicit `langPath`, tesseract.js falls back to fetching from `cdn.jsdelivr.net` at runtime — free, but the same "silent failure if the CDN is blocked" risk class already fixed once for barcode scanning; self-hosting closes it here too.

Separately: `apps/mobile/src/screens/RecipeOcrScreen.tsx:1-4`'s comment is corrected to reflect the resolution found above (the underlying resolution bug is real and now understood, but actually wiring a camera-capture UI into that screen remains its own separate, unstarted scope — only the comment's now-inaccurate "still-open issue" framing is corrected, nothing else on that screen changes).

## Part 2: Receipt line-item parser

New file `packages/core/src/receiptParser.ts`:

```ts
export interface ParsedReceiptLine {
  name: string;
  price: number;
}

export function parseReceiptText(rawText: string): ParsedReceiptLine[]
```

For each line of `rawText` (split on `\n`, trimmed): match a trailing price-like number — `(?:[$₱]\s*)?(\d+)[.,](\d{2})\s*$` — allowing an optional leading currency symbol and either `.` or `,` as the decimal separator (OCR and locale variance both happen in practice). Everything before the match is the candidate name; strip trailing fill characters receipts commonly use (repeated `.`, `-`, or spaces, e.g. `MILK .......4.99`) and re-trim. A line is skipped (contributes no result) when:
- there's no trailing price match at all, or
- the stripped name is empty after removing fill characters, or
- the line (case-insensitively) contains one of a small denylist of non-item keywords: `total`, `subtotal`, `tax`, `cash`, `change`, `balance`, `card`, `visa`, `mastercard`, `amount due`.

Real Jest unit tests cover: a clean multi-line receipt, dotted-fill lines, a `$`-prefixed price, a comma-decimal price, each denylist keyword individually, a line with no price (skipped), and empty input.

## Part 3: UI wiring

Follows the CSV-upload pattern in `BulkAddModal.tsx` exactly:

- A `receiptInputRef` (hidden `<input type="file" accept="image/*" capture="environment" />`) and a "Scan receipt" toolbar button (visible on both mobile and desktop, like "Upload CSV" — there's no reason to restrict a file/camera input to one platform).
- `async function handleReceiptUpload(file: File)`:
  1. Sets a `processingReceipt` boolean state to `true` (client-side OCR on a phone can take several seconds — the button becomes disabled and shows "Processing receipt…" so the user isn't left wondering if anything happened).
  2. Calls `ocrProvider.extractText({ kind: 'web-file', file })`, imported as `import { ocrProvider } from '@pantry/ocr/src/ocr.web';` (the direct-file-import workaround from Part 1's investigation — a bare `@pantry/ocr` import would break the build).
  3. Runs the result's `rawText` through `parseReceiptText`.
  4. If zero lines were extracted, sets the existing `error` state: `"Couldn't find any priced line items in this receipt — try a clearer photo, or add items manually."` and stops.
  5. Otherwise, applies the same `MAX_PASTE_ROWS` truncation check already used by paste/CSV (computed against the current `rows.length`, outside the state updater, same reasoning already documented on the CSV path), then appends one row per parsed line via the grid's existing row-placement helper (`emptyRow(previous)` seeded, `name` and `purchasePrice` set from the parsed line; `unit`/`storageLocation`/`isProduce` fall back to whatever the row above has, same as every other intake path when a field isn't in the source data).
  6. Clears `processingReceipt`.
- The file input's `value` is reset after reading, same as CSV's, so re-selecting the same photo still fires `onChange`.

## Error handling

- OCR extraction throwing (e.g. a corrupted image) is caught and surfaces through the existing `error` banner with the thrown message.
- Zero extracted lines is treated as a soft error (see above), not an exception — matches the "never block the user, just tell them nothing usable was found" tone the barcode-miss and CSV-no-Name-column paths already use.
- No retry/progress-percentage UI for the OCR pass itself — `processingReceipt` is a simple boolean, not a percentage; `tesseract.js` does support progress callbacks but wiring that through is deferred as unnecessary polish for a first version.

## Testing

- `parseReceiptText`: real Jest unit tests in `packages/core`, covering the cases listed in Part 2.
- The self-hosted asset paths (Part 1): typecheck/build confirms nothing is broken; the actual OCR pass can only be verified by running it against a real receipt photo, live, in a browser — same caveat already accepted for the barcode camera and video-based flows, `apps/web` has no test harness for this kind of thing.
- Live verification checklist for the implementer: confirm `apps/web/public/tesseract/eng.traineddata.gz` is the 2.9MB LSTM-only variant (not the 10.9MB full model) before committing it, and confirm a real photo of a real receipt produces at least one correctly-named, correctly-priced row in the grid.
