import type { CellColumn } from './bulkRowColumns';

const HEADER_ALIASES: Record<string, CellColumn> = {
  name: 'name',
  qty: 'quantity',
  quantity: 'quantity',
  unit: 'unit',
  location: 'storageLocation',
  'storage location': 'storageLocation',
  produce: 'isProduce',
  'is produce': 'isProduce',
  perishable: 'isProduce',
  expiry: 'expirationDate',
  expiration: 'expirationDate',
  'expiration date': 'expirationDate',
  price: 'purchasePrice',
  'purchase price': 'purchasePrice',
};

// Matches a CSV header cell (case/whitespace-insensitively) against the
// known bulk-row columns. Unrecognized headers resolve to null and are
// just ignored rather than treated as an error — a CSV export commonly has
// extra columns (SKU, notes, ...) nothing here cares about.
export function resolveCsvHeader(header: string): CellColumn | null {
  const key = header.trim().toLowerCase();
  return HEADER_ALIASES[key] ?? null;
}
