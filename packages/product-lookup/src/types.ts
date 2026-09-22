export interface ProductLookupResult {
  name: string;
  brand?: string;
}

export interface IProductLookupProvider {
  lookup(barcode: string): Promise<ProductLookupResult | null>;
}
