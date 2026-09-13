export interface OcrResult {
  rawText: string;
  confidence: number;
}

export interface IOcrProvider {
  extractText(input: OcrInput): Promise<OcrResult>;
}

export type OcrInput =
  | { kind: 'mobile-uri'; uri: string }
  | { kind: 'web-file'; file: File };
