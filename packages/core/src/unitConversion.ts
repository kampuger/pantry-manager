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

function fromCanonical(value: number, dimension: Dimension, unit: string): number {
  if (dimension === 'WEIGHT') return value / WEIGHT_TO_GRAMS[unit];
  if (dimension === 'VOLUME') return value / VOLUME_TO_ML[unit];
  return value;
}

// Rounded to 2 decimals for display — pantry quantities carry more precision
// (numeric(12,3) in the DB) than is useful to show as a "buy this much more"
// recommendation.
function roundForDisplay(value: number): number {
  return Math.round(value * 100) / 100;
}

export interface AvailabilityShortfall {
  quantity: number;
  unit: string;
}

export interface AvailabilityResult {
  status: AvailabilityStatus;
  shortfall: AvailabilityShortfall | null;
}

/**
 * Like compareAvailability, but also computes how much more of an ingredient
 * is needed — expressed in the pantry's own stock unit, since that's the unit
 * you'd actually go buy or weigh out more of. Returns a null shortfall (rather
 * than a fabricated number) when the two units' dimensions can't be bridged
 * for this ingredient — that's a "can't compare, check manually" case, not a
 * computable deficit.
 */
export function evaluateAvailability(
  requiredQty: number,
  requiredUnit: string,
  stockQty: number,
  stockUnit: string,
  ingredientName: string
): AvailabilityResult {
  const required = toCanonical(requiredQty, requiredUnit);
  const stock = toCanonical(stockQty, stockUnit);
  if (!required || !stock) return { status: 'MISSING', shortfall: null };

  let requiredInStockDimension = required.value;

  if (required.dimension !== stock.dimension) {
    const density = INGREDIENT_DENSITY_G_PER_ML[ingredientName.toLowerCase()];
    if (!density) return { status: 'MISSING', shortfall: null };

    requiredInStockDimension =
      required.dimension === 'VOLUME'
        ? required.value * density // ml -> g
        : required.value / density; // g -> ml
  }

  if (stock.value >= requiredInStockDimension) return { status: 'FULLY_AVAILABLE', shortfall: null };

  const shortfallCanonical = requiredInStockDimension - stock.value;
  const shortfall: AvailabilityShortfall = {
    quantity: roundForDisplay(fromCanonical(shortfallCanonical, stock.dimension, stockUnit)),
    unit: stockUnit,
  };

  return { status: stock.value > 0 ? 'PARTIALLY_AVAILABLE' : 'MISSING', shortfall };
}

export function compareAvailability(
  requiredQty: number,
  requiredUnit: string,
  stockQty: number,
  stockUnit: string,
  ingredientName: string
): AvailabilityStatus {
  return evaluateAvailability(requiredQty, requiredUnit, stockQty, stockUnit, ingredientName).status;
}
