// packages/ocr/src/contract.test.ts
import type { IOcrProvider, OcrInput, OcrResult } from './types';

class FakeOcrProvider implements IOcrProvider {
  public cleanupCalled = false;

  async extractText(input: OcrInput): Promise<OcrResult> {
    try {
      if (input.kind === 'mobile-uri') {
        return { rawText: `text-from:${input.uri}`, confidence: 1 };
      }
      return { rawText: `text-from:${input.file.name}`, confidence: 0.9 };
    } finally {
      this.cleanupCalled = true;
    }
  }
}

describe('IOcrProvider contract', () => {
  it('accepts a mobile-uri input and resolves an OcrResult', async () => {
    const provider = new FakeOcrProvider();
    const result = await provider.extractText({ kind: 'mobile-uri', uri: 'file:///tmp/x.jpg' });
    expect(result.rawText).toBe('text-from:file:///tmp/x.jpg');
    expect(provider.cleanupCalled).toBe(true);
  });

  it('accepts a web-file input and resolves an OcrResult', async () => {
    const provider = new FakeOcrProvider();
    const fakeFile = { name: 'recipe.png' } as File;
    const result = await provider.extractText({ kind: 'web-file', file: fakeFile });
    expect(result.rawText).toBe('text-from:recipe.png');
    expect(provider.cleanupCalled).toBe(true);
  });

  it('runs cleanup even when extraction throws', async () => {
    class ThrowingProvider implements IOcrProvider {
      public cleanupCalled = false;
      async extractText(_input: OcrInput): Promise<OcrResult> {
        try {
          throw new Error('blurry image');
        } finally {
          this.cleanupCalled = true;
        }
      }
    }
    const provider = new ThrowingProvider();
    await expect(provider.extractText({ kind: 'mobile-uri', uri: 'x' })).rejects.toThrow(
      'blurry image'
    );
    expect(provider.cleanupCalled).toBe(true);
  });
});
