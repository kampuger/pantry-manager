# Pantry Bulk Intake: Spreadsheet Paste, Smart Defaults, and Barcode Scanning

Status: Approved for planning
Date: 2026-09-22

## Problem

Adding a long grocery list to the pantry is cumbersome. `apps/web/src/components/pantry/BulkAddModal.tsx` already supports multi-row entry (a grid on desktop, stacked cards on mobile), but every field of every row still has to be typed by hand — there's no way to paste a list from elsewhere, no smart default for repeated fields, and no way to use a barcode to skip typing the product name entirely.

This spec covers three additions, all scoped to the web app's `BulkAddModal`:

1. Spreadsheet-style paste directly into the desktop grid.
2. New rows inheriting unit/location/produce from the row above.
3. A mobile-web "Scan barcode" continuous-scan mode that looks up product names via Open Food Facts.

(1) and (2) were approved as a bounded change to the existing modal in the same conversation as this spec, ahead of it needing a design doc of its own. (3) is architecturally new (camera access, an external API, a new package) and is what this spec exists to pin down before planning. None of the three is implemented yet; this doc covers all three so the implementation plan can treat them as one coherent piece of work.

## Non-goals

- `apps/mobile` is untouched — mobile app work is paused per current direction. "Mobile" in this doc means the web app rendered in a mobile browser (`useIsMobile()` true), not the Expo app.
- No barcode persistence. The scanned code is used once to look up a product, then discarded — `pantry_items` gets no new column, no migration.
- No paid/authenticated barcode database. Open Food Facts only; a miss just leaves the row with the barcode as a placeholder name for the user to fill in.
- No autocomplete-from-past-items and no keyboard-first grid navigation — explored and deliberately deferred to a future iteration.
- No CSV file upload — paste-only (matches how a user would actually copy a list out of a spreadsheet or notes app).
- No changes to `ItemForm.tsx` (single-item add/edit) or to `grocery_list_entries` — this is pantry-intake-only.

## Current state (for reference)

- `apps/web/src/components/pantry/BulkAddModal.tsx`: `BulkRow` state array rendered by `DesktopRows` (a `<table>`, one `<input>`/`<select>` per cell) or `MobileRows` (stacked cards), switched on `useIsMobile()`. `emptyRow()` (line 37) hardcodes `unit: UNIT_OPTIONS[0]`, `storageLocation: STORAGE_LOCATION_OPTIONS[0]`, `isProduce: true`. `addRow()` (line 313) appends one `emptyRow()`. `handleSubmit` drops blank rows, requires an explicit `expirationDate` for non-produce rows, and calls `onSubmit(items)` → `addPantryItems` (bulk insert, `packages/supabase-client/src/pantry.ts:47`).
- `apps/web/src/lib/useIsMobile.ts`: a `matchMedia('(max-width: 768px)')`-driven hook — viewport width, not real device detection. Already used to switch `BulkAddModal` between grid and cards; the barcode-scan button reuses this same signal.
- `packages/supabase-client/src/constants.ts`: `UNIT_OPTIONS` (`kg, g, lbs, pcs, packs, tbsp, tsp, ml, L, cups, stick, oz`) and `STORAGE_LOCATION_OPTIONS` (`FRIDGE, FREEZER, PANTRY, COUNTER, OTHER`) — the fixed vocabularies both paste-matching and any future lookup-derived values must map onto.
- `packages/ocr/` (`types.ts`, `ocr.web.ts`, `ocr.native.ts`, `contract.test.ts`): the existing pattern for wrapping an external capability behind a typed interface with a contract test using a fake implementation. `product-lookup` (new, below) follows this same shape.
- No barcode-scanning or product-lookup dependency exists anywhere in the repo today.

## Part 1: Spreadsheet-style paste (bounded)

- New pure function `parseBulkPasteGrid(text: string): string[][]` in `packages/core` (e.g. `packages/core/src/bulkPaste.ts`): splits on newlines (normalizing `\r\n`), then splits each line on `\t` if any line contains a tab, else on `,`. Trims a single trailing blank line (common when copying from a spreadsheet). Unit-tested alongside the other `packages/core` pure functions.
- `DesktopRows` cells get an `onPaste` handler. A single-cell paste (1 row × 1 column) is left to the browser's default behavior. A multi-cell paste is intercepted (`preventDefault()`) and spread starting at the focused cell across the fixed column order — name, quantity, unit, storageLocation, isProduce, expirationDate, purchasePrice — creating new rows (seeded per Part 2 below) if the pasted grid has more rows than exist from the focus point onward.
  - `unit`/`storageLocation` cells: case-insensitive match against `UNIT_OPTIONS`/`STORAGE_LOCATION_OPTIONS`; no match leaves the cell's current value unchanged rather than guessing.
  - `isProduce`: accepts `yes/no/y/n/true/false` case-insensitively; unrecognized text leaves the cell unchanged.
  - `expirationDate`: only applied when the row's `isProduce` is `false` (produce stays auto-computed, matching existing behavior); must be `YYYY-MM-DD` or it's skipped.
  - `quantity`/`purchasePrice`: `Number()`-parsed; non-numeric left blank.
- `MobileRows` is untouched — its stacked cards aren't a grid, so a paste into the `Name` field behaves as an ordinary single-field paste.

## Part 2: Smart per-row defaults (bounded)

- `emptyRow(previous?: BulkRow)`: when `previous` is passed, seeds `unit`, `storageLocation`, and `isProduce` from it instead of the hardcoded first option / `true`. `name`, `quantity` (`'1'`), `expirationDate`, and `purchasePrice` still reset to blank/default — those aren't usually repeated between consecutive items.
- `addRow()` calls `emptyRow(rows[rows.length - 1])`.
- Rows created by paste-overflow (Part 1) are seeded the same way before the pasted columns overwrite them.

## Part 3: Barcode scanning (architectural — this is the part under review)

### New package: `packages/product-lookup`

Mirrors `packages/ocr`'s shape:

- `types.ts`: `ProductLookupResult { name: string; brand?: string }` and `IProductLookupProvider { lookup(barcode: string): Promise<ProductLookupResult | null> }`.
- `openFoodFacts.ts`: `class OpenFoodFactsProvider implements IProductLookupProvider` — calls `https://world.openfoodfacts.org/api/v2/product/{barcode}.json?fields=product_name,brands`. Returns `null` when the response's `status` field indicates not-found, or on any network/parse error (a miss is not an exception — see Error handling).
- `contract.test.ts`: same pattern as `packages/ocr/src/contract.test.ts` — a `FakeProductLookupProvider` verifying the interface contract independent of the real HTTP implementation.
- `openFoodFacts.test.ts`: unit tests mocking `fetch` for a hit, a miss (`status: 0`), and a network error, asserting the provider normalizes all of these to `null` except the hit.

### New component: `apps/web/src/components/pantry/BarcodeScanner.tsx`

- Props: `onDetect: (barcode: string) => void`, `onClose: () => void`.
- Opens the rear camera via `getUserMedia({ video: { facingMode: 'environment' } })` into a `<video>` element.
- Decodes frames using the `barcode-detector` npm package (new dependency) — it wraps the native `BarcodeDetector` API where available (Chrome/Android) and falls back to a WASM decoder where it isn't (Safari/iOS), which matters here since this needs to work in iPhone Safari, the most likely mobile browser for this app's users.
- Runs a `requestAnimationFrame` detect loop. On a hit, de-dupes the same code within a 2-second window (so an item held steady in frame isn't added repeatedly), fires a brief visual flash, and calls `onDetect(barcode)` — the loop keeps running afterward so the next item can be scanned immediately.
- Camera permission denial or a `getUserMedia` rejection is shown inline in the overlay; `onClose` (a "Done"/"X" affordance) is always available regardless of camera state.
- Stops all `MediaStreamTrack`s on unmount.

### `BulkAddModal` integration

- A "Scan barcode" button appears next to "+ Add row" only when `useIsMobile()` is true.
- Clicking it opens `BarcodeScanner` in the existing overlay pattern (`MODAL_OVERLAY_STYLE`, stacked over the bulk-add card).
- `onDetect(barcode)`: calls `productLookup.lookup(barcode)`.
  - Hit: appends a new row via `emptyRow(rows[rows.length - 1])` (Part 2's seeding) with `name` set to the looked-up product name.
  - Miss (lookup returns `null`, including network failure): still appends a row, with `name` set to a placeholder like `Unknown item (${barcode})` — the scan isn't lost, and the user retypes the name manually. The scan loop is not interrupted by a miss.
- Scanning continues until the user taps "Done" on the scanner overlay, which calls `onClose` and returns to the grid showing all rows added so far (including any manually typed or pasted earlier).

### Data flow

`BarcodeScanner` → barcode string → `productLookup.lookup(barcode)` → `ProductLookupResult | null` → append `BulkRow`. Nothing is written to Supabase until "Save all" is pressed — identical to today's manual/paste flow from that point on. No schema changes.

### Error handling

- Camera permission denied / no camera: inline message in the `BarcodeScanner` overlay; the "Done" close control remains available so the user is never stuck.
- `OpenFoodFactsProvider.lookup` never throws — network errors, timeouts, and not-found responses all normalize to `null` (a miss), so a lookup problem degrades to "type the name yourself" rather than blocking or erroring the scan session.
- No rate-limit handling is added — Open Food Facts' public API has no key/auth for reasonable manual-scanning volumes; each `lookup` call is independent and doesn't block the camera loop from continuing to the next scan while a previous lookup is still in flight.

### Testing

- `packages/product-lookup`: contract test (fake provider) + `openFoodFacts.test.ts` (mocked `fetch`, hit/miss/error cases) — both follow the existing jest pattern used across `packages/*`.
- `parseBulkPasteGrid` (Part 1): pure-function unit tests in `packages/core` — empty input, single cell, multi-row/column, mixed line endings, trailing blank line.
- Camera access, the `requestAnimationFrame` decode loop, and the end-to-end "scan → row appended" flow cannot be meaningfully unit tested and `apps/web` has no existing test suite — verified manually on an actual mobile browser (live check, `run-web` pattern where applicable, but the camera portion specifically needs a real phone).
