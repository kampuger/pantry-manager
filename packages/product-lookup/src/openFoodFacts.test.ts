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

  it('falls back to the compressed UPC-E code when the expanded UPC-A form misses (real-world case: Canada Dry Strawberry Ginger Ale, printed UPC-E 07846001)', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 0 }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 1, product: { product_name: 'Strawberry ginger ale', brands: 'Canada Dry' } }),
      });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await openFoodFactsProvider.lookup('078000004601');

    expect(result).toEqual({ name: 'Strawberry ginger ale', brand: 'Canada Dry' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toContain('078000004601');
    expect(fetchMock.mock.calls[1][0]).toContain('07846001');
  });

  it('does not retry when the first lookup already hits', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 1, product: { product_name: 'Nutella', brands: 'Ferrero' } }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await openFoodFactsProvider.lookup('3017620425035');

    expect(result).toEqual({ name: 'Nutella', brand: 'Ferrero' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns null without a second request when the code has no plausible UPC-E form', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 0 }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    // 13-digit EAN codes and 8-digit codes are never UPC-A-shaped, so no
    // UPC-E candidate exists to retry with.
    const result = await openFoodFactsProvider.lookup('4000000000000');

    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
