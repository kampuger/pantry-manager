import { openFoodFactsProvider } from './openFoodFacts';

describe('openFoodFactsProvider', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('returns the product name and brand on a hit', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 1, product: { product_name: 'Oat Milk', brands: 'Silk' } }),
    }) as unknown as typeof fetch;

    const result = await openFoodFactsProvider.lookup('0123456789012');
    expect(result).toEqual({ name: 'Oat Milk', brand: 'Silk' });
  });

  it('returns null when the API reports the product as not found', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 0 }),
    }) as unknown as typeof fetch;

    const result = await openFoodFactsProvider.lookup('0000000000000');
    expect(result).toBeNull();
  });

  it('returns null when the HTTP response is not ok', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      json: async () => ({}),
    }) as unknown as typeof fetch;

    const result = await openFoodFactsProvider.lookup('0000000000000');
    expect(result).toBeNull();
  });

  it('returns null when fetch itself throws (network error)', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch;

    const result = await openFoodFactsProvider.lookup('0000000000000');
    expect(result).toBeNull();
  });

  it('returns null when the product has no name', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 1, product: {} }),
    }) as unknown as typeof fetch;

    const result = await openFoodFactsProvider.lookup('0123456789012');
    expect(result).toBeNull();
  });

  it('omits brand when the product has none', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 1, product: { product_name: 'Generic Rice' } }),
    }) as unknown as typeof fetch;

    const result = await openFoodFactsProvider.lookup('0123456789012');
    expect(result).toEqual({ name: 'Generic Rice' });
  });
});
