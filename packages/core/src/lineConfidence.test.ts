import { estimateLineConfidence, LOW_CONFIDENCE_THRESHOLD } from './lineConfidence';

describe('estimateLineConfidence', () => {
  it('returns the confidence of the OCR line containing the name', () => {
    const ocrLines = [
      { text: 'Spicy Fearles 400.00 1 400.00 V', confidence: 42 },
      { text: 'Clam Chowder 230.00 1 230.00 V', confidence: 91 },
    ];
    expect(estimateLineConfidence('Spicy Fearles', ocrLines)).toBe(42);
    expect(estimateLineConfidence('Clam Chowder', ocrLines)).toBe(91);
  });

  it('returns undefined when no OCR line contains the name', () => {
    const ocrLines = [{ text: 'Clam Chowder 230.00 1 230.00 V', confidence: 91 }];
    expect(estimateLineConfidence('Spicy Fearles', ocrLines)).toBeUndefined();
  });

  it('returns undefined for an empty name', () => {
    expect(estimateLineConfidence('', [{ text: 'Clam Chowder', confidence: 91 }])).toBeUndefined();
  });

  it('factors in the following numeric line for a two-line stitched item', () => {
    const ocrLines = [
      { text: "CUPPKEYK YEMA TOPPS 10'S", confidence: 88 },
      { text: '1   4800092555008                  56.50    56.50', confidence: 30 },
    ];
    expect(estimateLineConfidence("CUPPKEYK YEMA TOPPS 10'S", ocrLines)).toBe(30);
  });

  it('ignores a following line with no digits (unrelated to the item)', () => {
    const ocrLines = [
      { text: 'ITEM ONE 4.99', confidence: 88 },
      { text: 'THANK YOU FOR SHOPPING', confidence: 20 },
    ];
    expect(estimateLineConfidence('ITEM ONE', ocrLines)).toBe(88);
  });

  it('exposes a usable low-confidence threshold', () => {
    expect(LOW_CONFIDENCE_THRESHOLD).toBeGreaterThan(0);
    expect(LOW_CONFIDENCE_THRESHOLD).toBeLessThan(100);
  });
});
