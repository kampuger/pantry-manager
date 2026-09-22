import type { IProductLookupProvider, ProductLookupResult } from './types';

class FakeProductLookupProvider implements IProductLookupProvider {
  constructor(private readonly result: ProductLookupResult | null) {}

  async lookup(_barcode: string): Promise<ProductLookupResult | null> {
    return this.result;
  }
}

describe('IProductLookupProvider contract', () => {
  it('resolves a product result on a hit', async () => {
    const provider = new FakeProductLookupProvider({ name: 'Oat Milk', brand: 'Silk' });
    const result = await provider.lookup('0123456789012');
    expect(result).toEqual({ name: 'Oat Milk', brand: 'Silk' });
  });

  it('resolves null on a miss', async () => {
    const provider = new FakeProductLookupProvider(null);
    const result = await provider.lookup('0000000000000');
    expect(result).toBeNull();
  });
});
