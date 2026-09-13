// Mirrors the `unit_of_measure` and `storage_location` Postgres enums in
// supabase/migrations/20260913000001_initial_schema.sql — keep in sync.
export const UNIT_OPTIONS = [
  'kg', 'g', 'lbs', 'pcs', 'packs', 'tbsp', 'tsp', 'ml', 'L', 'cups', 'stick', 'oz',
] as const;

export const STORAGE_LOCATION_OPTIONS = ['FRIDGE', 'FREEZER', 'PANTRY', 'COUNTER', 'OTHER'] as const;
