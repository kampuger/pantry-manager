# Receipt OCR Intake Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user snap or upload a photo of a grocery receipt in the bulk-add grid and have its line items (name + price) extracted automatically into rows, using free client-side OCR.

**Architecture:** Fixes a real, previously-unresolved bug that blocks `@pantry/ocr` from working in the Next.js web build at all (Next's webpack ignores the package's `browser` field and pulls in React-Native-only code), self-hosts the OCR engine's runtime assets (mirroring how the barcode scanner's WASM binary was self-hosted), adds a small heuristic text parser, and wires a file-input button into the existing bulk-add grid the same way CSV upload already works.

**Tech Stack:** `tesseract.js` (already a dependency of `packages/ocr`, wrapped by its existing `IOcrProvider` abstraction), `@tesseract.js-data/eng` (new — provides the English trained-data file as an installable package instead of a CDN fetch).

**Spec:** [docs/superpowers/specs/2026-09-27-receipt-ocr-intake-design.md](../specs/2026-09-27-receipt-ocr-intake-design.md)

## Global Constraints

- Free only — no paid OCR or receipt-parsing API of any kind.
- Web only — no `apps/mobile` feature changes; the only mobile-side touch is correcting one stale code comment (see Task 1).
- No quantity detection or subtotal/total cross-checking in this iteration — only `{ name, price }` extraction.
- No custom live camera view — a single `<input type="file" accept="image/*" capture="environment">` covers photo capture and file upload with one control.
- Web code MUST import the OCR provider as `@pantry/ocr/src/ocr.web` (a direct file path), never the bare `@pantry/ocr` specifier — verified during spec investigation that the bare specifier resolves to `src/ocr.native.ts` under Next.js's webpack regardless of `transpilePackages`, pulling in React-Native-only dependencies that fail to parse.
- `apps/web` has no component test harness — verification for `apps/web`-side tasks is typecheck/build, not Jest. `packages/core`'s pure functions get real Jest tests.

---

### Task 1: Self-host the OCR web assets and fix the Next.js resolution bug

**Files:**
- Modify: `packages/ocr/package.json` (add `@tesseract.js-data/eng` dependency)
- Modify: `packages/ocr/src/ocr.web.ts:1-16` (add `langPath` option)
- Create (binary/asset copies, not source): `apps/web/public/tesseract/worker.min.js`, `apps/web/public/tesseract/tesseract-core.wasm.js`, `apps/web/public/tesseract/tesseract-core.wasm`, `apps/web/public/tesseract/eng.traineddata.gz`
- Modify: `apps/mobile/src/screens/RecipeOcrScreen.tsx:1-4` (correct a stale comment)

**Interfaces:**
- Produces: a working `ocrProvider.extractText({ kind: 'web-file', file })` callable from web code, importable **only** as `import { ocrProvider } from '@pantry/ocr/src/ocr.web';` — this exact import path is what Task 3 uses.

- [ ] **Step 1: Add the `@tesseract.js-data/eng` dependency**

Run from the repo root:

```bash
npm install -D @tesseract.js-data/eng@^1.0.0 --workspace=packages/ocr
```

This is only needed so `eng.traineddata.gz` is fetched reproducibly via `npm install` rather than a manual one-off download — it is never imported by any code (only read once via a `cp` command in Step 2), so it goes in `devDependencies`, not `dependencies`. (Note: `@tesseract.js-data` alone, without `/eng`, is not an installable package — it's a scope, and each language ships as its own `@tesseract.js-data/<lang>` package.)

- [ ] **Step 2: Copy the four self-hosted asset files**

Run from the repo root:

```bash
mkdir -p apps/web/public/tesseract
cp node_modules/tesseract.js/dist/worker.min.js apps/web/public/tesseract/worker.min.js
cp node_modules/tesseract.js-core/tesseract-core.wasm.js apps/web/public/tesseract/tesseract-core.wasm.js
cp node_modules/tesseract.js-core/tesseract-core.wasm apps/web/public/tesseract/tesseract-core.wasm
cp node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz apps/web/public/tesseract/eng.traineddata.gz
```

**This exact subfolder matters**: `node_modules/@tesseract.js-data/eng/` contains two variants — `4.0.0/eng.traineddata.gz` (10.9MB, the full Tesseract+LSTM model) and `4.0.0_best_int/eng.traineddata.gz` (2.9MB, LSTM-only). `ocr.web.ts` already calls `createWorker('eng', 1, ...)`, and engine mode `1` is `OEM.LSTM_ONLY` — only the LSTM-only variant is ever used, so copying the full 10.9MB file would bloat the app for a model that's never read. Verify after copying:

```bash
ls -la apps/web/public/tesseract/
```

Expected: `eng.traineddata.gz` is approximately 2.9MB (roughly 2,900,000–3,000,000 bytes), not ~10.9MB. If it's the larger size, you copied the wrong source subfolder — redo Step 2's last line with `4.0.0_best_int` (not `4.0.0`).

- [ ] **Step 3: Point `ocr.web.ts` at the self-hosted language data**

In `packages/ocr/src/ocr.web.ts`, find:

```ts
    workerSingleton = await createWorker('eng', 1, {
      workerPath: '/tesseract/worker.min.js',
      corePath: '/tesseract/tesseract-core.wasm.js',
    });
```

Replace with:

```ts
    workerSingleton = await createWorker('eng', 1, {
      workerPath: '/tesseract/worker.min.js',
      corePath: '/tesseract/tesseract-core.wasm.js',
      langPath: '/tesseract',
    });
```

`tesseract.js` resolves language data as `${langPath}/${lang}.traineddata.gz` — this makes it request `/tesseract/eng.traineddata.gz`, matching where Step 2 placed the file, instead of its default behavior of fetching from `cdn.jsdelivr.net` at runtime.

- [ ] **Step 4: Correct the stale comment in `RecipeOcrScreen.tsx`**

In `apps/mobile/src/screens/RecipeOcrScreen.tsx`, the file currently opens with:

```ts
// Photo/OCR capture is on hold — @pantry/ocr's package.json resolution has a
// known, still-open issue on the Next.js web build (see packages/ocr) and
// wiring up the camera flow is separate scope. This screen instead accepts
// pasted recipe text directly, which needs no OCR at all.
```

Replace with:

```ts
// Photo/OCR capture is on hold — not because of a package.json resolution
// bug (that's now understood and fixed: web code must import
// `@pantry/ocr/src/ocr.web` directly rather than the bare `@pantry/ocr`
// specifier, since Next.js's webpack ignores the package's `browser` field
// and otherwise pulls in React-Native-only code — see
// docs/superpowers/specs/2026-09-27-receipt-ocr-intake-design.md) — but
// because wiring up an actual camera-capture flow for this screen is
// separate, unstarted scope. This screen instead accepts pasted recipe
// text directly, which needs no OCR at all.
```

This is a comment-only change — nothing else on this screen is modified. The screen's actual behavior (accepting pasted text) is unchanged.

- [ ] **Step 5: Verify**

Run:

```bash
npm run typecheck --workspace=packages/ocr
```

Expected: no errors.

Run:

```bash
npm run build --workspace=apps/web
```

Expected: build succeeds (this task doesn't yet add any web code that imports the OCR provider, so this just confirms nothing broke — Task 3 is where the actual import is exercised).

- [ ] **Step 6: Commit**

```bash
git add packages/ocr/package.json package-lock.json packages/ocr/src/ocr.web.ts apps/web/public/tesseract apps/mobile/src/screens/RecipeOcrScreen.tsx
git commit -m "fix(ocr): self-host tesseract assets and document the Next.js resolution fix"
```

---

### Task 2: `parseReceiptText` pure function

**Files:**
- Create: `packages/core/src/receiptParser.ts`
- Create: `packages/core/src/receiptParser.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Produces: `interface ParsedReceiptLine { name: string; price: number }` and `parseReceiptText(rawText: string): ParsedReceiptLine[]`, exported from `@pantry/core`. Task 3 imports and calls this directly.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/core/src/receiptParser.test.ts
import { parseReceiptText } from './receiptParser';

describe('parseReceiptText', () => {
  it('extracts name and price from a clean multi-line receipt', () => {
    const text = 'MILK 2%\n4.99\nEGGS LARGE 12CT 3.49\nBREAD WHOLE WHEAT 2.99';
    // Note: the first two lines simulate a wrapped OCR line (name and price
    // split across lines) — this simple parser does NOT stitch those back
    // together, it only extracts price-terminated lines. "MILK 2%" has no
    // trailing price, so it's skipped; "4.99" alone has no name, so it's
    // also skipped. This is expected behavior for a first version.
    expect(parseReceiptText(text)).toEqual([
      { name: 'EGGS LARGE 12CT', price: 3.49 },
      { name: 'BREAD WHOLE WHEAT', price: 2.99 },
    ]);
  });

  it('strips dotted fill characters between name and price', () => {
    expect(parseReceiptText('MILK ..............4.99')).toEqual([{ name: 'MILK', price: 4.99 }]);
    expect(parseReceiptText('BREAD -------- 2.99')).toEqual([{ name: 'BREAD', price: 2.99 }]);
  });

  it('accepts a currency symbol before the price', () => {
    expect(parseReceiptText('MILK $4.99')).toEqual([{ name: 'MILK', price: 4.99 }]);
    expect(parseReceiptText('RICE ₱95.00')).toEqual([{ name: 'RICE', price: 95.0 }]);
  });

  it('accepts a comma as the decimal separator', () => {
    expect(parseReceiptText('MILK 4,99')).toEqual([{ name: 'MILK', price: 4.99 }]);
  });

  it('skips lines with no trailing price', () => {
    expect(parseReceiptText('THANK YOU FOR SHOPPING')).toEqual([]);
  });

  it('skips lines whose name is empty after stripping fill characters', () => {
    expect(parseReceiptText('.......... 4.99')).toEqual([]);
  });

  it.each(['TOTAL 45.99', 'SUBTOTAL 42.00', 'TAX 3.99', 'CASH 50.00', 'CHANGE 4.01', 'BALANCE 0.00', 'CARD 45.99', 'VISA 45.99', 'MASTERCARD 45.99', 'AMOUNT DUE 45.99'])(
    'skips denylisted line: %s',
    (line) => {
      expect(parseReceiptText(line)).toEqual([]);
    }
  );

  it('is case-insensitive when matching denylisted keywords', () => {
    expect(parseReceiptText('Total 45.99')).toEqual([]);
    expect(parseReceiptText('total 45.99')).toEqual([]);
  });

  it('returns an empty array for empty input', () => {
    expect(parseReceiptText('')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test --workspace=packages/core -- receiptParser`
Expected: FAIL with "Cannot find module './receiptParser'"

- [ ] **Step 3: Implement `parseReceiptText`**

```ts
// packages/core/src/receiptParser.ts
export interface ParsedReceiptLine {
  name: string;
  price: number;
}

const PRICE_PATTERN = /(?:[$₱]\s*)?(\d+)[.,](\d{2})\s*$/;

const DENYLIST_KEYWORDS = [
  'total',
  'subtotal',
  'tax',
  'cash',
  'change',
  'balance',
  'card',
  'visa',
  'mastercard',
  'amount due',
];

function containsDenylistedKeyword(line: string): boolean {
  const lower = line.toLowerCase();
  return DENYLIST_KEYWORDS.some((keyword) => lower.includes(keyword));
}

// Strips receipt-style fill characters (repeated dots, dashes, spaces) that
// commonly separate a name from its price, e.g. "MILK ..............4.99".
function stripFillCharacters(name: string): string {
  return name.replace(/[\s.\-]+$/, '').trim();
}

export function parseReceiptText(rawText: string): ParsedReceiptLine[] {
  const lines = rawText.split('\n');
  const results: ParsedReceiptLine[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (containsDenylistedKeyword(line)) continue;

    const match = line.match(PRICE_PATTERN);
    if (!match) continue;

    const name = stripFillCharacters(line.slice(0, match.index));
    if (name === '') continue;

    const price = Number(`${match[1]}.${match[2]}`);
    results.push({ name, price });
  }

  return results;
}
```

- [ ] **Step 4: Export it from the package index**

In `packages/core/src/index.ts`, add alongside the other exports:

```ts
export * from './receiptParser';
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test --workspace=packages/core -- receiptParser`
Expected: PASS, all tests green

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck --workspace=packages/core`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/receiptParser.ts packages/core/src/receiptParser.test.ts packages/core/src/index.ts
git commit -m "feat(core): add parseReceiptText for extracting name/price lines from OCR text"
```

---

### Task 3: Wire receipt scanning into `BulkAddModal`

**Files:**
- Modify: `apps/web/src/components/pantry/BulkAddModal.tsx`

**Interfaces:**
- Consumes: `ocrProvider` from `@pantry/ocr/src/ocr.web` (Task 1), `parseReceiptText` from `@pantry/core` (Task 2), `emptyRow(previous?)` (existing), `MAX_PASTE_ROWS` (existing, `apps/web/src/components/pantry/BulkAddModal.tsx:82`).

- [ ] **Step 1: Add the new imports**

At the top of `BulkAddModal.tsx`, change:

```ts
import { computeExpiryDate, parseBulkPasteGrid, resolveCsvHeader, CELL_COLUMNS, type CellColumn } from '@pantry/core';
```

to:

```ts
import { computeExpiryDate, parseBulkPasteGrid, resolveCsvHeader, parseReceiptText, CELL_COLUMNS, type CellColumn } from '@pantry/core';
```

Add a new import line right after the `@pantry/product-lookup` import:

```ts
import { ocrProvider } from '@pantry/ocr/src/ocr.web';
```

(This exact deep-import path is required — see this plan's Global Constraints.)

- [ ] **Step 2: Add `receiptInputRef` and `processingReceipt` state**

Find:

```ts
  const csvInputRef = useRef<HTMLInputElement>(null);
```

Add right after it:

```ts
  const receiptInputRef = useRef<HTMLInputElement>(null);
  const [processingReceipt, setProcessingReceipt] = useState(false);
```

- [ ] **Step 3: Add `handleReceiptUpload`**

Add this function right after `handleCsvUpload` (defined a few lines above `handleSubmit`):

```ts
  async function handleReceiptUpload(file: File) {
    setError(null);
    setProcessingReceipt(true);
    try {
      const { rawText } = await ocrProvider.extractText({ kind: 'web-file', file });
      const lines = parseReceiptText(rawText);

      if (lines.length === 0) {
        setError("Couldn't find any priced line items in this receipt — try a clearer photo, or add items manually.");
        return;
      }

      // Truncation depends on the current row count (receipt rows always
      // append, like CSV upload), so it's decided here against the render's
      // own `rows` rather than inside the setRows updater.
      let toAdd = lines;
      if (rows.length + toAdd.length > MAX_PASTE_ROWS) {
        setError(`Receipt truncated to ${MAX_PASTE_ROWS} rows total — that's more than fits in one add.`);
        toAdd = toAdd.slice(0, Math.max(0, MAX_PASTE_ROWS - rows.length));
      }

      setRows((prev) => {
        let next = [...prev];
        for (const line of toAdd) {
          const row = { ...emptyRow(next[next.length - 1]), name: line.name, purchasePrice: String(line.price) };
          next = [...next, row];
        }
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to read that receipt image.');
    } finally {
      setProcessingReceipt(false);
    }
  }
```

- [ ] **Step 4: Update the modal's description copy**

Find:

```tsx
        <p style={{ margin: '4px 0 0', fontSize: 13, color: color.mutedForeground }}>
          {isMobile
            ? 'Fill in a row per item, upload a CSV, or use Scan barcode to add items by camera — add more rows as you need them, then save them all at once.'
            : 'Fill in a row per item, upload a CSV, or paste a list from a spreadsheet straight into the grid — add more rows as you need them, then save them all at once.'}
        </p>
```

Replace with:

```tsx
        <p style={{ margin: '4px 0 0', fontSize: 13, color: color.mutedForeground }}>
          {isMobile
            ? 'Fill in a row per item, upload a CSV, scan a receipt, or use Scan barcode to add items by camera — add more rows as you need them, then save them all at once.'
            : 'Fill in a row per item, upload a CSV, scan a receipt, or paste a list from a spreadsheet straight into the grid — add more rows as you need them, then save them all at once.'}
        </p>
```

- [ ] **Step 5: Add the "Scan receipt" button and hidden file input**

Find the CSV upload button block:

```tsx
          <button type="button" onClick={() => csvInputRef.current?.click()} style={TOOLBAR_BUTTON_STYLE}>
            Upload CSV
          </button>
          <input
            ref={csvInputRef}
            type="file"
            accept=".csv,text/csv"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = ''; // reset so selecting the same file again still fires onChange
              if (file) void handleCsvUpload(file);
            }}
          />
```

Add right after it (still inside the same toolbar `<div>`):

```tsx
          <button
            type="button"
            onClick={() => receiptInputRef.current?.click()}
            disabled={processingReceipt}
            style={TOOLBAR_BUTTON_STYLE}
          >
            {processingReceipt ? 'Processing receipt…' : 'Scan receipt'}
          </button>
          <input
            ref={receiptInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = ''; // reset so selecting the same file again still fires onChange
              if (file) void handleReceiptUpload(file);
            }}
          />
```

- [ ] **Step 6: Typecheck and build**

Run:

```bash
npm run build --workspace=apps/web
```

Expected: build succeeds with no type errors. This is the first real exercise of the `@pantry/ocr/src/ocr.web` deep import — if this build fails with errors mentioning `@react-native-ml-kit` or `expo-file-system`, the import in Step 1 was written as the bare `@pantry/ocr` specifier by mistake; fix it to the exact deep-import path shown in Step 1.

- [ ] **Step 7: Manual verification (requires a real device and a real receipt)**

This cannot be meaningfully unit tested — OCR accuracy and the file/camera picker both require a real browser and a real photo. Using the `run-web` skill, start the dev server, sign in, go to `/pantry`, open "+ Add item":

1. Confirm "Scan receipt" is visible on both a desktop-width and mobile-width browser window (unlike "Scan barcode", it isn't mobile-only).
2. Click "Scan receipt" and select a photo of a real grocery receipt (or take one with your phone's camera). Confirm the button shows "Processing receipt…" and becomes disabled while OCR runs.
3. Confirm at least one row is added with a plausible name and price once processing finishes.
4. Try a photo that is not a receipt (e.g. a blank page) and confirm the "Couldn't find any priced line items" error appears rather than the app hanging or crashing.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/pantry/BulkAddModal.tsx
git commit -m "feat(web): add receipt scanning to the bulk-add grid"
```

## Self-Review Notes

- **Spec coverage:** Part 1 (self-hosting + resolution fix) → Task 1; Part 2 (parser) → Task 2; Part 3 (UI wiring) → Task 3. The RecipeOcrScreen.tsx comment correction and the `langPath` fix are both covered in Task 1, matching the spec's "Current state" section.
- **Type consistency checked:** `ParsedReceiptLine { name: string; price: number }` (Task 2) is consumed identically in Task 3's `handleReceiptUpload` (`line.name`, `line.price`). The `@pantry/ocr/src/ocr.web` import path and `OcrInput`'s `{ kind: 'web-file', file }` shape (Task 1's existing `types.ts`, unchanged) match exactly what Task 3 calls.
- **No `next.config.js` changes anywhere** in this plan, matching the spec's explicit finding that none are needed.
