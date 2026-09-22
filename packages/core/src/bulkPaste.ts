export function parseBulkPasteGrid(text: string): string[][] {
  const normalized = text.replace(/\r\n/g, '\n');
  if (normalized.trim() === '') return [];

  const lines = normalized.split('\n');

  // A trailing blank line is an artifact of copying a full row (including
  // its line break) from a spreadsheet, not an intentionally blank row.
  if (lines.length > 1 && lines[lines.length - 1] === '') {
    lines.pop();
  }

  const hasTab = lines.some((line) => line.includes('\t'));
  // Comma-delimiting is only a safe guess for a genuine multi-item list
  // (multiple lines, no tabs). A single line with no tabs is one pasted
  // value — splitting it on commas would mangle a product name like
  // "Hershey's Cocoa, Unsweetened" into two bogus columns.
  const delimiter = hasTab ? '\t' : lines.length > 1 ? ',' : null;
  if (delimiter === null) return [[lines[0].trim()]];
  return lines.map((line) => line.split(delimiter).map((cell) => cell.trim()));
}
