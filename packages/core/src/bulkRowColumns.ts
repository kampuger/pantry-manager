// Fixed column vocabulary shared by every bulk-intake path into the pantry
// add-items grid (typed rows, spreadsheet paste, CSV upload) — the order
// here is also the column order spreadsheet-style paste assumes.
export const CELL_COLUMNS = ['name', 'quantity', 'unit', 'storageLocation', 'isProduce', 'expirationDate', 'purchasePrice'] as const;
export type CellColumn = (typeof CELL_COLUMNS)[number];
