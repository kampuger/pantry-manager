import type { IProductLookupProvider, ProductLookupResult } from './types';

interface OpenFoodFactsResponse {
  status: number;
  product?: {
    product_name?: string;
    brands?: string;
  };
}

async function fetchByCode(code: string): Promise<ProductLookupResult | null> {
  const response = await fetch(
    `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=product_name,brands`
  );
  if (!response.ok) return null;

  const data = (await response.json()) as OpenFoodFactsResponse;
  if (data.status !== 1 || !data.product?.product_name) return null;

  const result: ProductLookupResult = { name: data.product.product_name };
  if (data.product.brands) result.brand = data.product.brands;
  return result;
}

// Some barcode scanners (including this app's) report a UPC-E-encoded
// barcode as its expanded 12-digit UPC-A form rather than the original
// 8-digit compressed code. Open Food Facts entries for these products are
// frequently indexed under the original compressed code only (e.g. a can
// printed with UPC-E "07846001" is stored as "07846001", not the expanded
// "078000004601"), so an expanded-only lookup can miss a product that's
// genuinely in the database. This reverses the standard UPC-E expansion
// (zero-suppression) rules to recover the likely original 8-digit code,
// returning null when upcA isn't a plausible compression of anything.
function upcAToUpcE(upcA: string): string | null {
  if (!/^\d{12}$/.test(upcA)) return null;
  const numberSystem = upcA[0];
  if (numberSystem !== '0' && numberSystem !== '1') return null;
  const checkDigit = upcA[11];
  const mfr = upcA.slice(1, 6);
  const product = upcA.slice(6, 11);

  if (['0', '1', '2'].includes(mfr[2]) && mfr[3] === '0' && mfr[4] === '0' && product[0] === '0' && product[1] === '0') {
    return `${numberSystem}${mfr[0]}${mfr[1]}${product[2]}${product[3]}${product[4]}${mfr[2]}${checkDigit}`;
  }
  if (mfr[2] !== '0' && mfr[3] === '0' && mfr[4] === '0' && product.slice(0, 3) === '000') {
    return `${numberSystem}${mfr[0]}${mfr[1]}${mfr[2]}${product[3]}${product[4]}3${checkDigit}`;
  }
  if (mfr[3] !== '0' && mfr[4] === '0' && product.slice(0, 4) === '0000') {
    return `${numberSystem}${mfr[0]}${mfr[1]}${mfr[2]}${mfr[3]}${product[4]}4${checkDigit}`;
  }
  if (mfr[4] !== '0' && product.slice(0, 4) === '0000' && ['5', '6', '7', '8', '9'].includes(product[4])) {
    return `${numberSystem}${mfr[0]}${mfr[1]}${mfr[2]}${mfr[3]}${mfr[4]}${product[4]}${checkDigit}`;
  }
  return null;
}

export const openFoodFactsProvider: IProductLookupProvider = {
  async lookup(barcode: string): Promise<ProductLookupResult | null> {
    try {
      const hit = await fetchByCode(barcode);
      if (hit) return hit;

      const upcE = upcAToUpcE(barcode);
      if (upcE) return await fetchByCode(upcE);

      return null;
    } catch {
      // Network failure, timeout, or malformed response — treated as a
      // miss, never surfaced as an error, so a lookup problem degrades to
      // "type the name yourself" rather than blocking the scan flow.
      return null;
    }
  },
};
