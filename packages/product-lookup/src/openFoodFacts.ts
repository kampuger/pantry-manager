import type { IProductLookupProvider, ProductLookupResult } from './types';

interface OpenFoodFactsResponse {
  status: number;
  product?: {
    product_name?: string;
    brands?: string;
  };
}

export const openFoodFactsProvider: IProductLookupProvider = {
  async lookup(barcode: string): Promise<ProductLookupResult | null> {
    try {
      const response = await fetch(
        `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json?fields=product_name,brands`
      );
      if (!response.ok) return null;

      const data = (await response.json()) as OpenFoodFactsResponse;
      if (data.status !== 1 || !data.product?.product_name) return null;

      const result: ProductLookupResult = { name: data.product.product_name };
      if (data.product.brands) result.brand = data.product.brands;
      return result;
    } catch {
      // Network failure, timeout, or malformed response — treated as a
      // miss, never surfaced as an error, so a lookup problem degrades to
      // "type the name yourself" rather than blocking the scan flow.
      return null;
    }
  },
};
