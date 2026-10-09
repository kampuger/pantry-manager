import { parseIngredientLine } from './ingredientParser';
import { evaluateAvailability, type AvailabilityShortfall, type AvailabilityStatus } from './unitConversion';

export interface PantryStockItem {
  name: string;
  quantity: number;
  unit: string;
}

export interface MatchedIngredient {
  rawLine: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  status: AvailabilityStatus;
  /** How much more is needed, in the pantry's stock unit (or the recipe's own unit if nothing is in stock at all). Null when fully available, when the recipe line has no parseable quantity, or when the units can't be compared. */
  shortfall: AvailabilityShortfall | null;
  matchedStock?: PantryStockItem;
}

function normalize(name: string): string {
  return name.trim().toLowerCase();
}

function findMatch(name: string, stock: PantryStockItem[]): PantryStockItem | undefined {
  const normalized = normalize(name);
  if (!normalized) return undefined;

  return stock.find((item) => {
    const stockName = normalize(item.name);
    return stockName === normalized || stockName.includes(normalized) || normalized.includes(stockName);
  });
}

export function matchRecipeIngredients(recipeText: string, stock: PantryStockItem[]): MatchedIngredient[] {
  const lines = recipeText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  return lines.map((rawLine) => {
    const { quantity, unit, name } = parseIngredientLine(rawLine);
    const matchedStock = findMatch(name, stock);

    if (!matchedStock) {
      const shortfall = quantity !== null && unit !== null ? { quantity, unit } : null;
      return { rawLine, name, quantity, unit, status: 'MISSING' as const, shortfall };
    }

    if (quantity !== null && unit !== null) {
      const { status, shortfall } = evaluateAvailability(quantity, unit, matchedStock.quantity, matchedStock.unit, name);
      return { rawLine, name, quantity, unit, status, shortfall, matchedStock };
    }

    // No parseable quantity/unit on this recipe line (e.g. "salt to taste") —
    // presence in stock at all counts as available, and there's no required
    // amount to compute a shortfall against.
    const status: AvailabilityStatus = matchedStock.quantity > 0 ? 'FULLY_AVAILABLE' : 'MISSING';
    return { rawLine, name, quantity, unit, status, shortfall: null, matchedStock };
  });
}
