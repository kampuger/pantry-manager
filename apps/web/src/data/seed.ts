export type PantryItem = {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  category: string;
  location: string;
  expiry: string;
  lastRestock: string;
  status: 'healthy' | 'low' | 'expiring' | 'flagged';
  cost: number;
};

export type ShoppingItem = {
  id: string;
  name: string;
  quantity: string;
  category: string;
  priority: 'High' | 'Medium' | 'Low';
  estimatedCost: number;
  checked: boolean;
};

export type BudgetSnapshot = {
  monthlyBudget: number;
  spentThisMonth: number;
  remaining: number;
  pantryEfficiency: number;
};

export const pantrySeed: PantryItem[] = [
  {
    id: 'p1',
    name: 'Rice',
    quantity: 5,
    unit: 'kg',
    category: 'Pantry Staples',
    location: 'PANTRY',
    expiry: '2026-12-15',
    lastRestock: '2026-09-01T00:00:00Z',
    status: 'healthy',
    cost: 280,
  },
  {
    id: 'p2',
    name: 'Chicken Breast',
    quantity: 1.2,
    unit: 'kg',
    category: 'meat',
    location: 'FRIDGE',
    expiry: '2026-09-18',
    lastRestock: '2026-09-04T00:00:00Z',
    status: 'flagged',
    cost: 220,
  },
  {
    id: 'p3',
    name: 'Fresh Milk',
    quantity: 2,
    unit: 'L',
    category: 'dairy',
    location: 'FRIDGE',
    expiry: '2026-09-16',
    lastRestock: '2026-09-06T00:00:00Z',
    status: 'flagged',
    cost: 120,
  },
  {
    id: 'p4',
    name: 'Eggs',
    quantity: 12,
    unit: 'pcs',
    category: 'protein',
    location: 'FRIDGE',
    expiry: '2026-09-22',
    lastRestock: '2026-09-09T00:00:00Z',
    status: 'healthy',
    cost: 96,
  },
  {
    id: 'p5',
    name: 'Tomato Sauce',
    quantity: 1,
    unit: 'bottle',
    category: 'Condiments',
    location: 'PANTRY',
    expiry: '2027-02-03',
    lastRestock: '2026-08-28T00:00:00Z',
    status: 'low',
    cost: 68,
  },
  {
    id: 'p6',
    name: 'Bananas',
    quantity: 6,
    unit: 'pcs',
    category: 'fruit',
    location: 'COUNTER',
    expiry: '2026-09-15',
    lastRestock: '2026-09-02T00:00:00Z',
    status: 'flagged',
    cost: 52,
  },
];

export const shoppingSeed: ShoppingItem[] = [
  { id: 's1', name: 'Coconut Milk', quantity: '2 cans', category: 'Cooking Base', priority: 'High', estimatedCost: 84, checked: false },
  { id: 's2', name: 'Garlic', quantity: '1 bulb', category: 'Produce', priority: 'Medium', estimatedCost: 25, checked: true },
  { id: 's3', name: 'Parmesan', quantity: '1 pack', category: 'Dairy', priority: 'Medium', estimatedCost: 160, checked: false },
  { id: 's4', name: 'Rice', quantity: '5 kg', category: 'Pantry Staples', priority: 'Low', estimatedCost: 300, checked: true },
  { id: 's5', name: 'Lettuce', quantity: '2 heads', category: 'Produce', priority: 'High', estimatedCost: 75, checked: false },
];

export const budgetSeed: BudgetSnapshot = {
  monthlyBudget: 6000,
  spentThisMonth: 2140,
  remaining: 3860,
  pantryEfficiency: 82,
};

export const financialBreakdown = [
  { category: 'Groceries', value: 920 },
  { category: 'Meat & Fish', value: 630 },
  { category: 'Dairy', value: 280 },
  { category: 'Produce', value: 310 },
];
