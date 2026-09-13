export type Dimension = 'WEIGHT' | 'VOLUME' | 'DISCRETE';

export type AvailabilityStatus = 'FULLY_AVAILABLE' | 'PARTIALLY_AVAILABLE' | 'MISSING';

const WEIGHT_TO_GRAMS: Record<string, number> = {
  kg: 1000,
  g: 1,
  lbs: 453.592,
  oz: 28.3495,
};

const VOLUME_TO_ML: Record<string, number> = {
  L: 1000,
  ml: 1,
  cups: 236.588,
  tbsp: 14.7868,
  tsp: 4.92892,
};

// Density (g/ml) for common ingredients, enabling volume<->weight bridging.
// Extensible; falls back to "cannot compare" (MISSING) if absent.
export const INGREDIENT_DENSITY_G_PER_ML: Record<string, number> = {
  butter: 0.911,
  'cooking oil': 0.92,
  water: 1.0,
  milk: 1.03,
  flour: 0.593,
  sugar: 0.845,
};

function dimensionOf(unit: string): Dimension {
  if (unit in WEIGHT_TO_GRAMS) return 'WEIGHT';
  if (unit in VOLUME_TO_ML) return 'VOLUME';
  return 'DISCRETE';
}

export function toCanonical(
  quantity: number,
  unit: string
): { value: number; dimension: Dimension } | null {
  const dim = dimensionOf(unit);

  if (dim === 'WEIGHT') return { value: quantity * WEIGHT_TO_GRAMS[unit], dimension: 'WEIGHT' };
  if (dim === 'VOLUME') return { value: quantity * VOLUME_TO_ML[unit], dimension: 'VOLUME' };

  return { value: quantity, dimension: 'DISCRETE' };
}

export function compareAvailability(
  requiredQty: number,
  requiredUnit: string,
  stockQty: number,
  stockUnit: string,
  ingredientName: string
): AvailabilityStatus {
  const required = toCanonical(requiredQty, requiredUnit);
  const stock = toCanonical(stockQty, stockUnit);
  if (!required || !stock) return 'MISSING';

  let requiredInStockDimension = required.value;

  if (required.dimension !== stock.dimension) {
    const density = INGREDIENT_DENSITY_G_PER_ML[ingredientName.toLowerCase()];
    if (!density) return 'MISSING';

    requiredInStockDimension =
      required.dimension === 'VOLUME'
        ? required.value * density // ml -> g
        : required.value / density; // g -> ml
  }

  if (stock.value >= requiredInStockDimension) return 'FULLY_AVAILABLE';
  if (stock.value > 0) return 'PARTIALLY_AVAILABLE';
  return 'MISSING';
}
