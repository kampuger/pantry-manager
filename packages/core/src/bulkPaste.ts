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
