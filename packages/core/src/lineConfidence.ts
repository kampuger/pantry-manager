export interface OcrLineConfidence {
  text: string;
  confidence: number;
}

// Below this OCR confidence (0-100 scale, as tesseract.js reports it), a
// row is flagged for the user to double-check rather than trusted silently.
// Picked from live tests: cleanly-read lines scored 85+, badly garbled ones
// (dropped columns, fused numbers) scored well under 60.
export const LOW_CONFIDENCE_THRESHOLD = 60;

// Best-effort: finds the OCR line(s) that most likely produced a parsed
// item's name, and returns the lowest confidence among them. Used only to
// flag rows for review — imprecision here just means a bad flag, never a
// change to the actual parsed name/price/quantity, so a simple substring
// search is good enough (no need to thread line indices through the parser
// itself).
export function estimateLineConfidence(parsedName: string, ocrLines: OcrLineConfidence[]): number | undefined {
  const needle = parsedName.trim().toLowerCase();
  if (needle === '') return undefined;

  const index = ocrLines.findIndex((line) => line.text.toLowerCase().includes(needle));
  if (index === -1) return undefined;

  let confidence = ocrLines[index].confidence;

  // Two-line "name, then Qty/Code/Price/Amount" receipts (see
  // DATA_LINE_PATTERN in receiptParser) pull the actual price/quantity from
  // the line right after the name — factor its confidence in too, so a
  // garbled data line still gets flagged even when the name line itself
  // read cleanly. Guarded by "looks numeric" so an unrelated next line
  // (e.g. the next item's name) doesn't drag the score down for no reason.
  const next = ocrLines[index + 1];
  if (next && /\d/.test(next.text)) {
    confidence = Math.min(confidence, next.confidence);
  }

  return confidence;
}
