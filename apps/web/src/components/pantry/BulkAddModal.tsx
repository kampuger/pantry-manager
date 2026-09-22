'use client';

import { useCallback, useRef, useState } from 'react';
import Papa from 'papaparse';
import { UNIT_OPTIONS, STORAGE_LOCATION_OPTIONS } from '@pantry/supabase-client';
import { computeExpiryDate, parseBulkPasteGrid, resolveCsvHeader, CELL_COLUMNS, type CellColumn } from '@pantry/core';
import { formatExpiryDate } from '@pantry/ui';
import { openFoodFactsProvider } from '@pantry/product-lookup';
import { useIsMobile } from '@/lib/useIsMobile';
import { color, radius, cardStyle, inputStyle, buttonStyle } from '@/lib/theme';
import { BarcodeScanner } from './BarcodeScanner';

export interface BulkItemInput {
  name: string;
  quantity: number;
  unit: string;
  storageLocation: string;
  isProduce: boolean;
  expirationDate: string | null;
  purchasePrice: number | null;
}

interface BulkRow {
  key: string;
  name: string;
  quantity: string;
  unit: string;
  storageLocation: string;
  isProduce: boolean;
  expirationDate: string;
  purchasePrice: string;
}

let rowKeySeq = 0;
function nextRowKey(): string {
  rowKeySeq += 1;
  return `row-${rowKeySeq}`;
}

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

const CELL_STYLE: React.CSSProperties = { padding: '6px 6px' };
const CELL_INPUT_STYLE: React.CSSProperties = { ...inputStyle, padding: '7px 8px', fontSize: 13 };
// Shared by both toolbar buttons ("+ Add row" and "Scan barcode") below the
// grid — both sit in the same flex row, so no alignSelf is needed here.
const TOOLBAR_BUTTON_STYLE: React.CSSProperties = { ...buttonStyle('secondary'), padding: '8px 14px', borderRadius: radius.pill };

interface RowsProps {
  rows: BulkRow[];
  updateRow: (key: string, changes: Partial<BulkRow>) => void;
  removeRow: (key: string) => void;
}

// A single paste creating more rows than this would be an accidental paste
// of a huge block of text (e.g. a whole document) — cap it rather than
// locking up the tab building thousands of grid rows.
const MAX_PASTE_ROWS = 200;

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
      return Number.isNaN(n) ? row : { ...row, quantity: String(n) };
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
      return Number.isNaN(n) ? row : { ...row, purchasePrice: String(n) };
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

// Table layout reads fine at desktop widths, but a table wrapped in
// overflow-x:auto inside a modal just clips columns off-screen on a phone —
// there's no room to scroll sideways within an already-narrow card. Mobile
// gets one stacked field-per-line card per row instead.
function MobileRows({ rows, updateRow, removeRow }: RowsProps) {
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {rows.map((row, index) => (
        <div
          key={row.key}
          style={{ background: color.muted, border: `1px solid ${color.border}`, borderRadius: radius.md, padding: 14, display: 'grid', gap: 10 }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: color.mutedForeground }}>Item {index + 1}</span>
            <button
              type="button"
              onClick={() => removeRow(row.key)}
              disabled={rows.length === 1}
              style={{
                background: 'none',
                border: 'none',
                cursor: rows.length === 1 ? 'default' : 'pointer',
                color: rows.length === 1 ? color.border : color.destructive,
                fontSize: 13,
                fontWeight: 600,
                fontFamily: 'inherit',
                padding: 0,
              }}
            >
              Remove
            </button>
          </div>

          <input
            value={row.name}
            onChange={(e) => updateRow(row.key, { name: e.target.value })}
            placeholder="Name"
            style={inputStyle}
          />

          <div style={{ display: 'flex', gap: 10 }}>
            <input
              type="number"
              min="0"
              step="any"
              value={row.quantity}
              onChange={(e) => updateRow(row.key, { quantity: e.target.value })}
              placeholder="Qty"
              style={{ ...inputStyle, width: 90, flexShrink: 0 }}
            />
            <select value={row.unit} onChange={(e) => updateRow(row.key, { unit: e.target.value })} style={{ ...inputStyle, flex: 1 }}>
              {UNIT_OPTIONS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </div>

          <select
            value={row.storageLocation}
            onChange={(e) => updateRow(row.key, { storageLocation: e.target.value })}
            style={inputStyle}
          >
            {STORAGE_LOCATION_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>

          <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: color.foreground }}>Produce (perishable)</span>
            <input
              type="checkbox"
              checked={row.isProduce}
              onChange={(e) =>
                updateRow(row.key, { isProduce: e.target.checked, expirationDate: e.target.checked ? '' : row.expirationDate })
              }
              style={{ width: 18, height: 18, accentColor: color.primary, cursor: 'pointer' }}
            />
          </label>

          {row.isProduce ? (
            <div style={{ ...inputStyle, background: color.card, color: color.mutedForeground, fontSize: 13 }}>
              Expires: {formatExpiryDate(computeExpiryDate({ isProduce: true }))} (auto)
            </div>
          ) : (
            <input
              type="date"
              value={row.expirationDate}
              onChange={(e) => updateRow(row.key, { expirationDate: e.target.value })}
              style={inputStyle}
            />
          )}

          <input
            type="number"
            min="0"
            step="0.01"
            placeholder="Price (₱, optional)"
            value={row.purchasePrice}
            onChange={(e) => updateRow(row.key, { purchasePrice: e.target.value })}
            style={inputStyle}
          />
        </div>
      ))}
    </div>
  );
}

interface DesktopRowsProps extends RowsProps {
  onPasteGrid: (startRowIndex: number, startColIndex: number, grid: string[][]) => void;
}

function DesktopRows({ rows, updateRow, removeRow, onPasteGrid }: DesktopRowsProps) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${color.border}`, textAlign: 'left' }}>
            <th style={{ ...CELL_STYLE, color: color.mutedForeground, fontWeight: 600, minWidth: 160 }}>Name</th>
            <th style={{ ...CELL_STYLE, color: color.mutedForeground, fontWeight: 600, minWidth: 70 }}>Qty</th>
            <th style={{ ...CELL_STYLE, color: color.mutedForeground, fontWeight: 600, minWidth: 90 }}>Unit</th>
            <th style={{ ...CELL_STYLE, color: color.mutedForeground, fontWeight: 600, minWidth: 110 }}>Location</th>
            <th style={{ ...CELL_STYLE, color: color.mutedForeground, fontWeight: 600, textAlign: 'center' }}>Produce</th>
            <th style={{ ...CELL_STYLE, color: color.mutedForeground, fontWeight: 600, minWidth: 150 }}>Expires</th>
            <th style={{ ...CELL_STYLE, color: color.mutedForeground, fontWeight: 600, minWidth: 100 }}>Price (₱)</th>
            <th style={CELL_STYLE} />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={row.key} style={{ borderBottom: `1px solid ${color.border}` }}>
              <td style={CELL_STYLE}>
                <input
                  value={row.name}
                  onChange={(e) => updateRow(row.key, { name: e.target.value })}
                  onPaste={(e) => handleCellPaste(e, rowIndex, 'name', onPasteGrid)}
                  placeholder="e.g. Strawberries"
                  style={{ ...CELL_INPUT_STYLE, minWidth: 150 }}
                />
              </td>
              <td style={CELL_STYLE}>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={row.quantity}
                  onChange={(e) => updateRow(row.key, { quantity: e.target.value })}
                  onPaste={(e) => handleCellPaste(e, rowIndex, 'quantity', onPasteGrid)}
                  style={{ ...CELL_INPUT_STYLE, width: 64 }}
                />
              </td>
              <td style={CELL_STYLE}>
                <select
                  value={row.unit}
                  onChange={(e) => updateRow(row.key, { unit: e.target.value })}
                  onPaste={(e) => handleCellPaste(e, rowIndex, 'unit', onPasteGrid)}
                  style={{ ...CELL_INPUT_STYLE, width: 80 }}
                >
                  {UNIT_OPTIONS.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </td>
              <td style={CELL_STYLE}>
                <select
                  value={row.storageLocation}
                  onChange={(e) => updateRow(row.key, { storageLocation: e.target.value })}
                  onPaste={(e) => handleCellPaste(e, rowIndex, 'storageLocation', onPasteGrid)}
                  style={{ ...CELL_INPUT_STYLE, width: 100 }}
                >
                  {STORAGE_LOCATION_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </td>
              <td style={{ ...CELL_STYLE, textAlign: 'center' }}>
                <input
                  type="checkbox"
                  checked={row.isProduce}
                  onChange={(e) =>
                    updateRow(row.key, {
                      isProduce: e.target.checked,
                      expirationDate: e.target.checked ? '' : row.expirationDate,
                    })
                  }
                  style={{ width: 16, height: 16, accentColor: color.primary, cursor: 'pointer' }}
                />
              </td>
              <td style={CELL_STYLE}>
                {row.isProduce ? (
                  <span style={{ color: color.mutedForeground, fontSize: 12, whiteSpace: 'nowrap' }}>
                    {formatExpiryDate(computeExpiryDate({ isProduce: true }))} (auto)
                  </span>
                ) : (
                  <input
                    type="date"
                    value={row.expirationDate}
                    onChange={(e) => updateRow(row.key, { expirationDate: e.target.value })}
                    onPaste={(e) => handleCellPaste(e, rowIndex, 'expirationDate', onPasteGrid)}
                    style={{ ...CELL_INPUT_STYLE, width: 140 }}
                  />
                )}
              </td>
              <td style={CELL_STYLE}>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={row.purchasePrice}
                  onChange={(e) => updateRow(row.key, { purchasePrice: e.target.value })}
                  onPaste={(e) => handleCellPaste(e, rowIndex, 'purchasePrice', onPasteGrid)}
                  style={{ ...CELL_INPUT_STYLE, width: 84 }}
                />
              </td>
              <td style={CELL_STYLE}>
                <button
                  type="button"
                  onClick={() => removeRow(row.key)}
                  disabled={rows.length === 1}
                  aria-label="Remove row"
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: rows.length === 1 ? 'default' : 'pointer',
                    color: rows.length === 1 ? color.border : color.mutedForeground,
                    fontSize: 16,
                    padding: 4,
                  }}
                >
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function BulkAddModal({
  onSubmit,
  onCancel,
}: {
  onSubmit: (items: BulkItemInput[]) => Promise<void>;
  onCancel: () => void;
}) {
  const isMobile = useIsMobile();
  const [rows, setRows] = useState<BulkRow[]>(() => [emptyRow()]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showScanner, setShowScanner] = useState(false);
  const csvInputRef = useRef<HTMLInputElement>(null);

  function updateRow(key: string, changes: Partial<BulkRow>) {
    setRows((prev) => prev.map((row) => (row.key === key ? { ...row, ...changes } : row)));
  }

  function addRow() {
    setRows((prev) => [...prev, emptyRow(prev[prev.length - 1])]);
  }

  function removeRow(key: string) {
    setRows((prev) => (prev.length > 1 ? prev.filter((row) => row.key !== key) : prev));
  }

  // Must stay referentially stable (empty deps) — BarcodeScanner's camera
  // effect depends on `onDetect`'s identity, and an unstable reference here
  // would tear down and re-acquire the camera on every parent re-render.
  const handleBarcodeDetected = useCallback(async (barcode: string): Promise<string> => {
    const result = await openFoodFactsProvider.lookup(barcode);
    // Open Food Facts names are frequently generic/unbranded (e.g. "Whole
    // Milk"), so the brand is often what actually distinguishes a product —
    // combine them when both are present.
    const resolvedName = [result?.brand, result?.name].filter(Boolean).join(' ');
    const displayName = resolvedName || `Unknown item (${barcode})`;
    setRows((prev) => {
      const last = prev[prev.length - 1];
      // The modal always starts with (and "+ Add row" always leaves) one
      // blank scratch row at the end — fill that one first rather than
      // always appending, so the very first scan doesn't skip row 1.
      if (last.name.trim() === '') {
        return [...prev.slice(0, -1), { ...last, name: displayName }];
      }
      return [...prev, { ...emptyRow(last), name: displayName }];
    });
    return displayName;
  }, []);

  function handlePasteGrid(startRowIndex: number, startColIndex: number, grid: string[][]) {
    // Truncation only depends on the paste's own shape (not on how many
    // rows already exist), so it can be decided before touching state —
    // keeps the setRows updater itself free of side effects.
    if (startRowIndex + grid.length > MAX_PASTE_ROWS) {
      setError(`Paste truncated to ${MAX_PASTE_ROWS} rows — that's more than fits in one add.`);
      grid = grid.slice(0, Math.max(0, MAX_PASTE_ROWS - startRowIndex));
    }

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

  async function handleCsvUpload(file: File) {
    setError(null);
    const text = await file.text();
    const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });

    const headerColumns = (parsed.meta.fields ?? []).map((header) => [header, resolveCsvHeader(header)] as const);
    if (!headerColumns.some(([, column]) => column === 'name')) {
      setError(
        "Couldn't find a Name column in this CSV — expected a header row with columns like Name, Qty, Unit, Location, Expiry, Price."
      );
      return;
    }

    // Truncation depends on the current row count (CSV rows always append,
    // unlike paste which targets a specific start position independent of
    // it), so it's decided here against the render's own `rows` rather than
    // inside the setRows updater — keeps that updater free of side effects.
    let records = parsed.data;
    if (rows.length + records.length > MAX_PASTE_ROWS) {
      setError(`CSV truncated to ${MAX_PASTE_ROWS} rows total — that's more than fits in one add.`);
      records = records.slice(0, Math.max(0, MAX_PASTE_ROWS - rows.length));
    }

    setRows((prev) => {
      let next = [...prev];
      for (const record of records) {
        let row = emptyRow(next[next.length - 1]);
        for (const [header, column] of headerColumns) {
          if (!column) continue;
          row = applyPastedCell(row, column, (record[header] ?? '').trim());
        }
        next = [...next, row];
      }
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Blank rows (no name typed) are just unused scratch rows, not errors —
    // silently dropped rather than forcing the user to delete them by hand.
    const filled = rows.filter((row) => row.name.trim() !== '');
    if (filled.length === 0) {
      setError('Add at least one item (fill in a name for at least one row).');
      return;
    }

    const missingExpiry = filled.find((row) => !row.isProduce && !row.expirationDate);
    if (missingExpiry) {
      setError(`"${missingExpiry.name.trim()}" needs an expiration date (non-produce items can't auto-compute one).`);
      return;
    }

    const items: BulkItemInput[] = filled.map((row) => ({
      name: row.name.trim(),
      quantity: Number(row.quantity) || 0,
      unit: row.unit,
      storageLocation: row.storageLocation,
      isProduce: row.isProduce,
      expirationDate: row.isProduce ? computeExpiryDate({ isProduce: true }) : row.expirationDate,
      purchasePrice: row.purchasePrice ? Number(row.purchasePrice) : null,
    }));

    setSubmitting(true);
    try {
      await onSubmit(items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add items');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ ...cardStyle, width: '100%', maxWidth: 920, maxHeight: '90vh', overflowY: 'auto', padding: 24, display: 'grid', gap: 16, boxSizing: 'border-box' }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: color.foreground }}>Add items</h2>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: color.mutedForeground }}>
          {isMobile
            ? 'Fill in a row per item, upload a CSV, or use Scan barcode to add items by camera — add more rows as you need them, then save them all at once.'
            : 'Fill in a row per item, upload a CSV, or paste a list from a spreadsheet straight into the grid — add more rows as you need them, then save them all at once.'}
        </p>
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 16 }}>
        {isMobile ? (
          <MobileRows rows={rows} updateRow={updateRow} removeRow={removeRow} />
        ) : (
          <DesktopRows rows={rows} updateRow={updateRow} removeRow={removeRow} onPasteGrid={handlePasteGrid} />
        )}

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button type="button" onClick={addRow} style={TOOLBAR_BUTTON_STYLE}>
            + Add row
          </button>
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
          {isMobile && (
            <button type="button" onClick={() => setShowScanner(true)} style={TOOLBAR_BUTTON_STYLE}>
              Scan barcode
            </button>
          )}
        </div>

        {showScanner && (
          <BarcodeScanner onDetect={handleBarcodeDetected} onClose={() => setShowScanner(false)} />
        )}

        {error && (
          <p
            role="alert"
            style={{
              margin: 0,
              padding: '10px 14px',
              borderRadius: radius.sm,
              background: color.destructiveBg,
              color: color.destructive,
              fontSize: 13,
            }}
          >
            {error}
          </p>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, paddingTop: 8, borderTop: `1px solid ${color.border}` }}>
          <button type="button" onClick={onCancel} style={buttonStyle('secondary')}>
            Cancel
          </button>
          <button type="submit" disabled={submitting} style={buttonStyle('primary')}>
            {submitting ? 'Saving…' : 'Save all'}
          </button>
        </div>
      </form>
    </div>
  );
}
