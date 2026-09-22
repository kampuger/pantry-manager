# Pantry Bulk Intake Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make adding a long grocery list to the pantry faster by letting users paste a spreadsheet-style list directly into the bulk-add grid, carry row defaults forward, and scan barcodes on mobile web to auto-fill product names via Open Food Facts.

**Architecture:** All UI changes are scoped to `apps/web/src/components/pantry/BulkAddModal.tsx`. A new pure parsing function lives in `packages/core` (paste-grid splitting). A new small package `packages/product-lookup` wraps the Open Food Facts HTTP call behind a typed interface, following the same shape as the existing `packages/ocr` package. A new `BarcodeScanner.tsx` component owns the camera + decode loop and is only rendered on mobile viewports.

**Tech Stack:** Next.js 16 / React 19 (`apps/web`), TypeScript, Jest + ts-jest (package unit tests), `barcode-detector` (ZXing-wasm barcode decoding ponyfill), Open Food Facts public REST API (no key).

**Spec:** [docs/superpowers/specs/2026-09-22-pantry-bulk-intake-design.md](../specs/2026-09-22-pantry-bulk-intake-design.md)

## Global Constraints

- Web only — `apps/mobile` (the Expo app) is not touched anywhere in this plan.
- The barcode scanner is gated to mobile-viewport web (`useIsMobile()`) and must not appear on desktop.
- No barcode is ever persisted — `pantry_items` gets no schema change. A scanned barcode is used once for a lookup, then discarded.
- Product lookups only hit Open Food Facts (no paid/authenticated API, no other provider).
- No CSV file upload — paste into the grid is the only bulk-input mechanism besides typing.
- `apps/web` has no component test harness today. Verification for every `apps/web` task is: TypeScript typecheck (`tsc --noEmit`, via `npm run build`) + a manual check described in the task, not an automated component test. `packages/core` and `packages/product-lookup` do have Jest and get real automated tests.

---

### Task 1: `parseBulkPasteGrid` pure function

**Files:**
- Create: `packages/core/src/bulkPaste.ts`
- Create: `packages/core/src/bulkPaste.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Produces: `parseBulkPasteGrid(text: string): string[][]` — splits pasted clipboard text into a grid of trimmed cell strings. Tab-delimited if any line contains a tab, else comma-delimited. Normalizes `\r\n` to `\n`. Drops a single trailing blank line (an artifact of copying a full row from a spreadsheet). Returns `[]` for empty/whitespace-only input. Task 3 (`BulkAddModal`'s paste handler) calls this directly.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/core/src/bulkPaste.test.ts
import { parseBulkPasteGrid } from './bulkPaste';

describe('parseBulkPasteGrid', () => {
  it('returns an empty grid for empty input', () => {
    expect(parseBulkPasteGrid('')).toEqual([]);
  });

  it('parses a single pasted value as a 1x1 grid', () => {
    expect(parseBulkPasteGrid('Milk')).toEqual([['Milk']]);
  });

  it('splits newline-separated values into one row per line', () => {
    expect(parseBulkPasteGrid('Milk\nEggs\nBread')).toEqual([['Milk'], ['Eggs'], ['Bread']]);
  });

  it('splits tab-delimited lines into columns', () => {
    expect(parseBulkPasteGrid('Milk\t2\tpcs\nEggs\t12\tpcs')).toEqual([
      ['Milk', '2', 'pcs'],
      ['Eggs', '12', 'pcs'],
    ]);
  });

  it('falls back to comma-delimited columns when no line has a tab', () => {
    expect(parseBulkPasteGrid('Milk,2,pcs\nEggs,12,pcs')).toEqual([
      ['Milk', '2', 'pcs'],
      ['Eggs', '12', 'pcs'],
    ]);
  });

  it('normalizes CRLF line endings', () => {
    expect(parseBulkPasteGrid('Milk\r\nEggs')).toEqual([['Milk'], ['Eggs']]);
  });

  it('drops a single trailing blank line but keeps interior blank lines', () => {
    expect(parseBulkPasteGrid('Milk\nEggs\n')).toEqual([['Milk'], ['Eggs']]);
    expect(parseBulkPasteGrid('Milk\n\nEggs')).toEqual([['Milk'], [''], ['Eggs']]);
  });

  it('trims whitespace around each cell', () => {
    expect(parseBulkPasteGrid('  Milk \t 2 \nEggs\t12')).toEqual([
      ['Milk', '2'],
      ['Eggs', '12'],
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test --workspace=packages/core -- bulkPaste`
Expected: FAIL with "Cannot find module './bulkPaste'"

- [ ] **Step 3: Implement `parseBulkPasteGrid`**

```ts
// packages/core/src/bulkPaste.ts
export function parseBulkPasteGrid(text: string): string[][] {
  const normalized = text.replace(/\r\n/g, '\n');
  if (normalized.trim() === '') return [];

  const lines = normalized.split('\n');

  // A trailing blank line is an artifact of copying a full row (including
  // its line break) from a spreadsheet, not an intentionally blank row.
  if (lines.length > 1 && lines[lines.length - 1] === '') {
    lines.pop();
  }

  const delimiter = lines.some((line) => line.includes('\t')) ? '\t' : ',';
  return lines.map((line) => line.split(delimiter).map((cell) => cell.trim()));
}
```

- [ ] **Step 4: Export it from the package index**

In `packages/core/src/index.ts`, add alongside the other exports:

```ts
export * from './bulkPaste';
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test --workspace=packages/core -- bulkPaste`
Expected: PASS, all 8 tests green

- [ ] **Step 6: Typecheck the package**

Run: `npm run typecheck --workspace=packages/core`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/bulkPaste.ts packages/core/src/bulkPaste.test.ts packages/core/src/index.ts
git commit -m "feat(core): add parseBulkPasteGrid for pasting a list into the bulk-add grid"
```

---

### Task 2: Smart per-row defaults in `BulkAddModal`

**Files:**
- Modify: `apps/web/src/components/pantry/BulkAddModal.tsx:37-48` (`emptyRow`), `:313-315` (`addRow`)
- Test: none (no `apps/web` test harness) — typecheck + manual check below

**Interfaces:**
- Consumes: nothing new.
- Produces: `emptyRow(previous?: BulkRow): BulkRow` — the new signature Task 3's paste-overflow logic will call.

- [ ] **Step 1: Change `emptyRow` to accept an optional previous row**

Replace:

```ts
function emptyRow(): BulkRow {
  return {
    key: nextRowKey(),
    name: '',
    quantity: '1',
    unit: UNIT_OPTIONS[0],
    storageLocation: STORAGE_LOCATION_OPTIONS[0],
    isProduce: true,
    expirationDate: '',
    purchasePrice: '',
  };
}
```

With:

```ts
function emptyRow(previous?: BulkRow): BulkRow {
  return {
    key: nextRowKey(),
    name: '',
    quantity: '1',
    unit: previous?.unit ?? UNIT_OPTIONS[0],
    storageLocation: previous?.storageLocation ?? STORAGE_LOCATION_OPTIONS[0],
    isProduce: previous?.isProduce ?? true,
    expirationDate: '',
    purchasePrice: '',
  };
}
```

`name`, `quantity`, `expirationDate`, and `purchasePrice` still reset to their blank/default values — those aren't usually repeated between consecutive grocery items, only unit/location/produce tend to be.

- [ ] **Step 2: Seed new rows from the last row**

Replace:

```ts
function addRow() {
  setRows((prev) => [...prev, emptyRow()]);
}
```

With:

```ts
function addRow() {
  setRows((prev) => [...prev, emptyRow(prev[prev.length - 1])]);
}
```

(The initial `useState<BulkRow[]>(() => [emptyRow()])` on line 305 stays unchanged — there's no previous row for the very first one.)

- [ ] **Step 3: Typecheck**

Run: `npm run build --workspace=apps/web`
Expected: build succeeds with no type errors

- [ ] **Step 4: Manual verification**

Using the `run-web` skill, start the dev server and sign in with an existing account that has a household. Go to `/pantry`, click "+ Add item", then:
1. In the first row, change **Unit** to `kg` and **Location** to `FREEZER`, and switch off **Produce** (leave its date blank for now — that's fine, you're not submitting).
2. Click "+ Add row".
3. Confirm the new second row already shows **Unit: kg**, **Location: FREEZER**, **Produce: off** — inherited from row 1 — while **Name** and **Qty** are still blank/default.

Cancel out of the modal when done (no need to save).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/pantry/BulkAddModal.tsx
git commit -m "feat(web): new bulk-add rows inherit unit/location/produce from the row above"
```

---

### Task 3: Spreadsheet-style paste into the desktop grid

**Files:**
- Modify: `apps/web/src/components/pantry/BulkAddModal.tsx` (imports, adds `CELL_COLUMNS`/`applyPastedCell`/`handleCellPaste` at module scope, `DesktopRowsProps`, `DesktopRows` JSX, and `handlePasteGrid` in `BulkAddModal`)
- Test: none (no `apps/web` test harness) — typecheck + manual check below

**Interfaces:**
- Consumes: `parseBulkPasteGrid` (Task 1, from `@pantry/core`), `emptyRow(previous?)` (Task 2).
- Produces: nothing consumed by later tasks — this is the last change to the paste/defaults part of the file before Part 3 (barcode) tasks add their own, separate button.

- [ ] **Step 1: Import `parseBulkPasteGrid`**

In `BulkAddModal.tsx`, change:

```ts
import { computeExpiryDate } from '@pantry/core';
```

to:

```ts
import { computeExpiryDate, parseBulkPasteGrid } from '@pantry/core';
```

- [ ] **Step 2: Add the fixed column order and per-cell paste logic (module scope, above `DesktopRows`)**

Insert this block right after the existing `RowsProps` interface (before `function MobileRows`):

```ts
const CELL_COLUMNS = ['name', 'quantity', 'unit', 'storageLocation', 'isProduce', 'expirationDate', 'purchasePrice'] as const;
type CellColumn = (typeof CELL_COLUMNS)[number];

// Applies one pasted cell's raw text to a row, for the fixed column order
// above. Ambiguous or unparsable values leave the existing cell alone
// rather than guessing — the user fixes it by hand in the grid afterward.
function applyPastedCell(row: BulkRow, column: CellColumn, value: string): BulkRow {
  if (value === '') return row;

  switch (column) {
    case 'name':
      return { ...row, name: value };
    case 'quantity': {
      const n = Number(value);
      return { ...row, quantity: Number.isNaN(n) ? '' : String(n) };
    }
    case 'unit': {
      const match = UNIT_OPTIONS.find((u) => u.toLowerCase() === value.toLowerCase());
      return match ? { ...row, unit: match } : row;
    }
    case 'storageLocation': {
      const match = STORAGE_LOCATION_OPTIONS.find((s) => s.toLowerCase() === value.toLowerCase());
      return match ? { ...row, storageLocation: match } : row;
    }
    case 'isProduce': {
      const lower = value.toLowerCase();
      if (lower === 'yes' || lower === 'y' || lower === 'true') {
        return { ...row, isProduce: true, expirationDate: '' };
      }
      if (lower === 'no' || lower === 'n' || lower === 'false') {
        return { ...row, isProduce: false };
      }
      return row;
    }
    case 'expirationDate': {
      if (row.isProduce) return row;
      return /^\d{4}-\d{2}-\d{2}$/.test(value) ? { ...row, expirationDate: value } : row;
    }
    case 'purchasePrice': {
      const n = Number(value);
      return { ...row, purchasePrice: Number.isNaN(n) ? '' : String(n) };
    }
    default:
      return row;
  }
}

// A single-cell paste (no tabs/commas, one line) is left to the browser's
// normal paste behavior. Anything bigger is a spreadsheet-style paste: we
// take over and spread it across the grid starting at the focused cell.
function handleCellPaste(
  e: React.ClipboardEvent,
  rowIndex: number,
  column: CellColumn,
  onPasteGrid: (startRowIndex: number, startColIndex: number, grid: string[][]) => void
) {
  const text = e.clipboardData.getData('text');
  if (!text) return;
  const grid = parseBulkPasteGrid(text);
  const isSingleCell = grid.length === 1 && grid[0].length === 1;
  if (grid.length === 0 || isSingleCell) return;
  e.preventDefault();
  onPasteGrid(rowIndex, CELL_COLUMNS.indexOf(column), grid);
}
```

- [ ] **Step 3: Give `DesktopRows` an `onPasteGrid` prop**

Replace:

```ts
interface RowsProps {
  rows: BulkRow[];
  updateRow: (key: string, changes: Partial<BulkRow>) => void;
  removeRow: (key: string) => void;
}
```

(keep `RowsProps` as-is, `MobileRows` keeps using it unchanged) and add right below it:

```ts
interface DesktopRowsProps extends RowsProps {
  onPasteGrid: (startRowIndex: number, startColIndex: number, grid: string[][]) => void;
}
```

Then change the `DesktopRows` function signature from:

```ts
function DesktopRows({ rows, updateRow, removeRow }: RowsProps) {
```

to:

```ts
function DesktopRows({ rows, updateRow, removeRow, onPasteGrid }: DesktopRowsProps) {
```

- [ ] **Step 4: Wire `onPaste` onto the enterable cells**

Inside `DesktopRows`'s `rows.map((row) => ( ... ))`, the row's index is not currently captured — change `rows.map((row) => (` to `rows.map((row, rowIndex) => (` (matches the existing pattern already used in `MobileRows`). Then add an `onPaste` handler to each of these six inputs/selects (the checkbox and the produce "(auto)" label are left as-is — they're updated as pass-through columns by a paste that started elsewhere in the row, not a paste target themselves):

- Name input: add `onPaste={(e) => handleCellPaste(e, rowIndex, 'name', onPasteGrid)}`
- Quantity input: add `onPaste={(e) => handleCellPaste(e, rowIndex, 'quantity', onPasteGrid)}`
- Unit select: add `onPaste={(e) => handleCellPaste(e, rowIndex, 'unit', onPasteGrid)}`
- Location select: add `onPaste={(e) => handleCellPaste(e, rowIndex, 'storageLocation', onPasteGrid)}`
- Expiry date input (the non-produce branch): add `onPaste={(e) => handleCellPaste(e, rowIndex, 'expirationDate', onPasteGrid)}`
- Price input: add `onPaste={(e) => handleCellPaste(e, rowIndex, 'purchasePrice', onPasteGrid)}`

For example, the name cell goes from:

```tsx
<input
  value={row.name}
  onChange={(e) => updateRow(row.key, { name: e.target.value })}
  placeholder="e.g. Strawberries"
  style={{ ...CELL_INPUT_STYLE, minWidth: 150 }}
/>
```

to:

```tsx
<input
  value={row.name}
  onChange={(e) => updateRow(row.key, { name: e.target.value })}
  onPaste={(e) => handleCellPaste(e, rowIndex, 'name', onPasteGrid)}
  placeholder="e.g. Strawberries"
  style={{ ...CELL_INPUT_STYLE, minWidth: 150 }}
/>
```

Apply the same one-line addition to the other five cells listed above, each with its own column name.

- [ ] **Step 5: Add `handlePasteGrid` to `BulkAddModal` and pass it to `DesktopRows`**

Inside the `BulkAddModal` component function, add this alongside `updateRow`/`addRow`/`removeRow`:

```ts
function handlePasteGrid(startRowIndex: number, startColIndex: number, grid: string[][]) {
  setRows((prev) => {
    const next = [...prev];
    grid.forEach((gridRow, i) => {
      const rowIndex = startRowIndex + i;
      while (rowIndex >= next.length) {
        next.push(emptyRow(next[next.length - 1]));
      }
      let row = next[rowIndex];
      gridRow.forEach((cellValue, j) => {
        const column = CELL_COLUMNS[startColIndex + j];
        if (!column) return; // paste extended past the last known column; ignore extra columns
        row = applyPastedCell(row, column, cellValue);
      });
      next[rowIndex] = row;
    });
    return next;
  });
}
```

Then change the desktop branch of the render:

```tsx
<DesktopRows rows={rows} updateRow={updateRow} removeRow={removeRow} />
```

to:

```tsx
<DesktopRows rows={rows} updateRow={updateRow} removeRow={removeRow} onPasteGrid={handlePasteGrid} />
```

(`MobileRows` stays exactly as it is — untouched by this task.)

- [ ] **Step 6: Typecheck**

Run: `npm run build --workspace=apps/web`
Expected: build succeeds with no type errors

- [ ] **Step 7: Manual verification**

Using the `run-web` skill, start the dev server, sign in, go to `/pantry`, click "+ Add item". With the first row's **Name** cell focused, paste this tab-separated text (copy it from here — your editor/terminal paste will preserve the tabs):

```
Milk	2	L	FRIDGE	no	2026-10-01	120
Eggs	12	pcs	FRIDGE	no	2026-10-15	180
Rice	1	kg	PANTRY	no	2027-01-01	95
```

Confirm: three rows now exist (two new ones were created), each with Name/Qty/Unit/Location/Produce(off)/Expiry/Price filled in exactly as pasted, and Unit/Location values matched case-insensitively into the existing dropdowns.

Then test the single-cell case: click into an empty **Name** field and paste just `Bananas` (no tabs/newlines) — confirm it behaves like a normal single-field paste (only that cell changes, no new rows).

Cancel out of the modal when done.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/pantry/BulkAddModal.tsx
git commit -m "feat(web): support spreadsheet-style paste into the bulk-add grid"
```

---

### Task 4: `@pantry/product-lookup` package scaffold and contract

**Files:**
- Create: `packages/product-lookup/package.json`
- Create: `packages/product-lookup/tsconfig.json`
- Create: `packages/product-lookup/jest.config.js`
- Create: `packages/product-lookup/src/types.ts`
- Create: `packages/product-lookup/src/index.ts`
- Create: `packages/product-lookup/src/contract.test.ts`

**Interfaces:**
- Produces: `ProductLookupResult { name: string; brand?: string }`, `IProductLookupProvider { lookup(barcode: string): Promise<ProductLookupResult | null> }`. Task 5's `openFoodFactsProvider` implements this interface; Task 7's `BulkAddModal` consumes it only through this shape.

- [ ] **Step 1: Package manifest**

```json
{
  "name": "@pantry/product-lookup",
  "version": "0.1.0",
  "private": true,
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "test": "jest",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@types/jest": "^29.5.12",
    "jest": "^29.7.0",
    "ts-jest": "^29.1.2",
    "typescript": "^5.4.5"
  }
}
```

Save as `packages/product-lookup/package.json`.

- [ ] **Step 2: TypeScript and Jest config**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "lib": ["ES2020", "DOM"]
  },
  "include": ["src"]
}
```

Save as `packages/product-lookup/tsconfig.json`. `lib: DOM` is needed for the ambient `fetch`/`Response` types Task 5 uses.

```js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
};
```

Save as `packages/product-lookup/jest.config.js`.

- [ ] **Step 3: Types**

```ts
// packages/product-lookup/src/types.ts
export interface ProductLookupResult {
  name: string;
  brand?: string;
}

export interface IProductLookupProvider {
  lookup(barcode: string): Promise<ProductLookupResult | null>;
}
```

- [ ] **Step 4: Package entry point**

```ts
// packages/product-lookup/src/index.ts
export * from './types';
```

(Task 5 adds an `openFoodFacts` export here.)

- [ ] **Step 5: Write the contract test**

```ts
// packages/product-lookup/src/contract.test.ts
import type { IProductLookupProvider, ProductLookupResult } from './types';

class FakeProductLookupProvider implements IProductLookupProvider {
  constructor(private readonly result: ProductLookupResult | null) {}

  async lookup(_barcode: string): Promise<ProductLookupResult | null> {
    return this.result;
  }
}

describe('IProductLookupProvider contract', () => {
  it('resolves a product result on a hit', async () => {
    const provider = new FakeProductLookupProvider({ name: 'Oat Milk', brand: 'Silk' });
    const result = await provider.lookup('0123456789012');
    expect(result).toEqual({ name: 'Oat Milk', brand: 'Silk' });
  });

  it('resolves null on a miss', async () => {
    const provider = new FakeProductLookupProvider(null);
    const result = await provider.lookup('0000000000000');
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 6: Install and run the tests**

Run: `npm install` (from repo root — registers the new workspace)
Run: `npm test --workspace=packages/product-lookup`
Expected: PASS, both tests green

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck --workspace=packages/product-lookup`
Expected: no errors

- [ ] **Step 8: Commit**

```bash
git add packages/product-lookup/
git commit -m "feat(product-lookup): scaffold @pantry/product-lookup with its provider contract"
```

---

### Task 5: Open Food Facts provider

**Files:**
- Create: `packages/product-lookup/src/openFoodFacts.ts`
- Create: `packages/product-lookup/src/openFoodFacts.test.ts`
- Modify: `packages/product-lookup/src/index.ts`

**Interfaces:**
- Consumes: `IProductLookupProvider`, `ProductLookupResult` (Task 4).
- Produces: `openFoodFactsProvider: IProductLookupProvider` — what Task 7's `BulkAddModal` imports and calls.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/product-lookup/src/openFoodFacts.test.ts
import { openFoodFactsProvider } from './openFoodFacts';

describe('openFoodFactsProvider', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('returns the product name and brand on a hit', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 1, product: { product_name: 'Oat Milk', brands: 'Silk' } }),
    }) as unknown as typeof fetch;

    const result = await openFoodFactsProvider.lookup('0123456789012');
    expect(result).toEqual({ name: 'Oat Milk', brand: 'Silk' });
  });

  it('returns null when the API reports the product as not found', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 0 }),
    }) as unknown as typeof fetch;

    const result = await openFoodFactsProvider.lookup('0000000000000');
    expect(result).toBeNull();
  });

  it('returns null when the HTTP response is not ok', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      json: async () => ({}),
    }) as unknown as typeof fetch;

    const result = await openFoodFactsProvider.lookup('0000000000000');
    expect(result).toBeNull();
  });

  it('returns null when fetch itself throws (network error)', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch;

    const result = await openFoodFactsProvider.lookup('0000000000000');
    expect(result).toBeNull();
  });

  it('returns null when the product has no name', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 1, product: {} }),
    }) as unknown as typeof fetch;

    const result = await openFoodFactsProvider.lookup('0123456789012');
    expect(result).toBeNull();
  });

  it('omits brand when the product has none', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 1, product: { product_name: 'Generic Rice' } }),
    }) as unknown as typeof fetch;

    const result = await openFoodFactsProvider.lookup('0123456789012');
    expect(result).toEqual({ name: 'Generic Rice' });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test --workspace=packages/product-lookup -- openFoodFacts`
Expected: FAIL with "Cannot find module './openFoodFacts'"

- [ ] **Step 3: Implement the provider**

```ts
// packages/product-lookup/src/openFoodFacts.ts
import type { IProductLookupProvider, ProductLookupResult } from './types';

interface OpenFoodFactsResponse {
  status: number;
  product?: {
    product_name?: string;
    brands?: string;
  };
}

export const openFoodFactsProvider: IProductLookupProvider = {
  async lookup(barcode: string): Promise<ProductLookupResult | null> {
    try {
      const response = await fetch(
        `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json?fields=product_name,brands`
      );
      if (!response.ok) return null;

      const data = (await response.json()) as OpenFoodFactsResponse;
      if (data.status !== 1 || !data.product?.product_name) return null;

      const result: ProductLookupResult = { name: data.product.product_name };
      if (data.product.brands) result.brand = data.product.brands;
      return result;
    } catch {
      // Network failure, timeout, or malformed response — treated as a
      // miss, never surfaced as an error, so a lookup problem degrades to
      // "type the name yourself" rather than blocking the scan flow.
      return null;
    }
  },
};
```

- [ ] **Step 4: Export it from the package index**

In `packages/product-lookup/src/index.ts`:

```ts
export * from './types';
export * from './openFoodFacts';
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test --workspace=packages/product-lookup -- openFoodFacts`
Expected: PASS, all 6 tests green

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck --workspace=packages/product-lookup`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add packages/product-lookup/src/openFoodFacts.ts packages/product-lookup/src/openFoodFacts.test.ts packages/product-lookup/src/index.ts
git commit -m "feat(product-lookup): add Open Food Facts provider"
```

---

### Task 6: `BarcodeScanner` component

**Files:**
- Modify: `apps/web/package.json` (add the `barcode-detector` dependency)
- Create: `apps/web/src/components/pantry/BarcodeScanner.tsx`
- Test: none (camera access can't be unit tested) — typecheck + manual check below

**Interfaces:**
- Produces: `BarcodeScanner({ onDetect: (barcode: string) => void; onClose: () => void })` — the component Task 7 renders from `BulkAddModal`.

- [ ] **Step 1: Add the new dependency**

Run from the repo root:

```bash
npm install barcode-detector@^3.2.2 --workspace=apps/web
```

This adds it to `apps/web/package.json`'s `dependencies` and updates the lockfile. `barcode-detector` is a spec-compliant `BarcodeDetector` ponyfill (ZXing compiled to WASM) — needed because Safari/iOS, the most likely mobile browser for this app's users, has no native `BarcodeDetector` API. Its `/ponyfill` subpath exports `BarcodeDetector` without touching any browser globals; the WASM binary itself is fetched from a CDN at runtime by default, no bundler configuration required. (`@pantry/product-lookup` is added as a dependency in Task 7, which is the task that actually imports it.)

- [ ] **Step 2: Implement the component**

```tsx
// apps/web/src/components/pantry/BarcodeScanner.tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { BarcodeDetector } from 'barcode-detector/ponyfill';
import { color, radius, cardStyle, buttonStyle } from '@/lib/theme';

const DEDUPE_WINDOW_MS = 2000;
const PRODUCT_BARCODE_FORMATS = ['upc_a', 'upc_e', 'ean_13', 'ean_8'] as const;

export function BarcodeScanner({
  onDetect,
  onClose,
}: {
  onDetect: (barcode: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastDetection = useRef<{ code: string; at: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let rafId = 0;
    let stream: MediaStream | null = null;

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        const detector = new BarcodeDetector({ formats: [...PRODUCT_BARCODE_FORMATS] });

        const tick = async () => {
          if (cancelled || !videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            const code = codes[0]?.rawValue;
            if (code) {
              const now = Date.now();
              const last = lastDetection.current;
              if (!last || last.code !== code || now - last.at > DEDUPE_WINDOW_MS) {
                lastDetection.current = { code, at: now };
                setFlash(true);
                setTimeout(() => setFlash(false), 200);
                onDetect(code);
              }
            }
          } catch {
            // A single failed decode pass (e.g. a blurry mid-motion frame)
            // isn't fatal — the loop just tries again next frame.
          }
          rafId = requestAnimationFrame(tick);
        };
        rafId = requestAnimationFrame(tick);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not access the camera.');
        }
      }
    }

    start();

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [onDetect]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.4)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '40px 16px',
        overflowY: 'auto',
        zIndex: 60,
      }}
    >
      <div style={{ ...cardStyle, width: '100%', maxWidth: 480, padding: 24, display: 'grid', gap: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: color.foreground }}>Scan barcode</h2>
          <button type="button" onClick={onClose} style={buttonStyle('secondary')}>
            Done
          </button>
        </div>

        {error ? (
          <p style={{ margin: 0, fontSize: 13, color: color.destructive }}>{error}</p>
        ) : (
          <div
            style={{
              position: 'relative',
              borderRadius: radius.md,
              overflow: 'hidden',
              border: `2px solid ${flash ? color.primary : color.border}`,
              transition: 'border-color 150ms ease',
            }}
          >
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video ref={videoRef} muted playsInline style={{ width: '100%', display: 'block' }} />
          </div>
        )}

        <p style={{ margin: 0, fontSize: 13, color: color.mutedForeground }}>
          Point the camera at a barcode. Each scan adds a row — tap Done when you&rsquo;re finished.
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run build --workspace=apps/web`
Expected: build succeeds with no type errors

- [ ] **Step 4: Commit**

```bash
git add apps/web/package.json apps/web/package-lock.json apps/web/src/components/pantry/BarcodeScanner.tsx
git commit -m "feat(web): add BarcodeScanner component (camera + ZXing decode loop)"
```

(Manual verification of the actual camera/decode behavior happens in Task 7, once it's reachable from the pantry page.)

---

### Task 7: Wire barcode scanning into `BulkAddModal`

**Files:**
- Modify: `apps/web/package.json` (add the `@pantry/product-lookup` dependency)
- Modify: `apps/web/src/components/pantry/BulkAddModal.tsx` (imports, new state, new handler, new button, renders `BarcodeScanner`)

**Interfaces:**
- Consumes: `BarcodeScanner` (Task 6), `openFoodFactsProvider` (Task 5), `emptyRow(previous?)` (Task 2), `useIsMobile()` (existing).

- [ ] **Step 1: Add the new dependency**

Run from the repo root:

```bash
npm install @pantry/product-lookup@"*" --workspace=apps/web
```

- [ ] **Step 2: Import the new pieces**

Add near the top of `BulkAddModal.tsx`, alongside the existing imports:

```ts
import { useCallback, useState } from 'react';
```

(replaces the existing `import { useState } from 'react';` — `useCallback` is now needed too).

```ts
import { openFoodFactsProvider } from '@pantry/product-lookup';
import { BarcodeScanner } from './BarcodeScanner';
```

- [ ] **Step 3: Add scanner state and the detection handler**

Inside the `BulkAddModal` component function, alongside the existing `useState` calls:

```ts
const [showScanner, setShowScanner] = useState(false);
```

And alongside `updateRow`/`addRow`/`removeRow`/`handlePasteGrid`:

```ts
const handleBarcodeDetected = useCallback(async (barcode: string) => {
  const result = await openFoodFactsProvider.lookup(barcode);
  setRows((prev) => [
    ...prev,
    { ...emptyRow(prev[prev.length - 1]), name: result?.name ?? `Unknown item (${barcode})` },
  ]);
}, []);
```

`useCallback` with an empty dependency array keeps this function's identity stable across renders — without it, every scanned item would re-render `BulkAddModal`, hand `BarcodeScanner` a new `onDetect` function, and retrigger its camera-setup `useEffect` (see Task 6), restarting the camera stream after every single scan.

- [ ] **Step 4: Add the "Scan barcode" button (mobile-only) and render the scanner**

Find the existing "+ Add row" button:

```tsx
<button
  type="button"
  onClick={addRow}
  style={{ ...buttonStyle('secondary'), alignSelf: 'flex-start', padding: '8px 14px', borderRadius: radius.pill }}
>
  + Add row
</button>
```

Replace it with:

```tsx
<div style={{ display: 'flex', gap: 10 }}>
  <button
    type="button"
    onClick={addRow}
    style={{ ...buttonStyle('secondary'), alignSelf: 'flex-start', padding: '8px 14px', borderRadius: radius.pill }}
  >
    + Add row
  </button>
  {isMobile && (
    <button
      type="button"
      onClick={() => setShowScanner(true)}
      style={{ ...buttonStyle('secondary'), alignSelf: 'flex-start', padding: '8px 14px', borderRadius: radius.pill }}
    >
      Scan barcode
    </button>
  )}
</div>

{showScanner && (
  <BarcodeScanner onDetect={handleBarcodeDetected} onClose={() => setShowScanner(false)} />
)}
```

(`isMobile` is already in scope — `BulkAddModal` already calls `useIsMobile()` to switch between `DesktopRows`/`MobileRows`.)

- [ ] **Step 5: Typecheck**

Run: `npm run build --workspace=apps/web`
Expected: build succeeds with no type errors

- [ ] **Step 6: Manual verification (requires a real phone)**

Using the `run-web` skill, start the dev server so it's reachable from your phone on the same network (`npm run dev` binds to all interfaces by default; find your machine's LAN IP and use `http://<lan-ip>:3000` on the phone). On your phone's browser:
1. Sign in, go to `/pantry`, tap "+ Add item".
2. Confirm the "Scan barcode" button is visible (mobile viewport) and that it is **not** visible when you open the same modal on a desktop browser window.
3. Tap "Scan barcode", grant camera permission, and point it at a real product barcode (any packaged grocery item). Confirm a new row appears with a real product name filled in, and that the camera keeps running (doesn't need to be reopened) so you can scan a second, different item right after.
4. Point it at a barcode unlikely to be in Open Food Facts (or cover part of it to force a decode of a bogus-looking code) and confirm a row still gets added, with a name like "Unknown item (<the number>)" rather than the scan being silently dropped.
5. Tap "Done" and confirm the scanner closes and the grid still shows every row added so far (typed, pasted, and scanned).

Cancel out of the modal when done (no need to save).

- [ ] **Step 7: Commit**

```bash
git add apps/web/package.json apps/web/package-lock.json apps/web/src/components/pantry/BulkAddModal.tsx
git commit -m "feat(web): wire barcode scanning into the bulk-add grid"
```

---

## Self-Review Notes

- **Spec coverage:** Part 1 (paste) → Task 3; Part 2 (defaults) → Task 2; Part 3 (barcode) → Tasks 4–7. All spec sections have a corresponding task.
- **Type consistency checked:** `emptyRow(previous?: BulkRow)` (Task 2) is used identically in Task 3's `handlePasteGrid` and Task 7's `handleBarcodeDetected`. `CellColumn`/`CELL_COLUMNS` (Task 3) are used consistently in `applyPastedCell` and `handleCellPaste`. `IProductLookupProvider`/`ProductLookupResult` (Task 4) match what `openFoodFactsProvider` (Task 5) implements and what `BulkAddModal` (Task 7) consumes.
- **No schema changes** anywhere in this plan, matching the spec's non-goal.
