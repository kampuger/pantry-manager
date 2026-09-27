export interface OcrResult {
  rawText: string;
  confidence: number;
  /** Per-line text + confidence (0-100), in reading order, when the provider
   * can supply it — used to flag individual low-confidence rows for review
   * rather than trusting every line equally. Undefined on providers that
   * don't expose line-level detail (currently: the native/mobile provider). */
  lines?: { text: string; confidence: number }[];
}

export interface IOcrProvider {
  extractText(input: OcrInput): Promise<OcrResult>;
}

export type OcrInput =
  | { kind: 'mobile-uri'; uri: string }
  | { kind: 'web-file'; file: File };
