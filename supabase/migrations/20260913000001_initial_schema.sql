-- =========================================================
-- EXTENSIONS
-- =========================================================
create extension if not exists "pgcrypto";
create extension if not exists "pg_cron";
create extension if not exists "pg_trgm";

-- =========================================================
-- ENUM TYPES
-- =========================================================
create type household_role as enum ('OWNER', 'ADMIN', 'MEMBER');

create type storage_location as enum ('FRIDGE', 'FREEZER', 'PANTRY', 'COUNTER', 'OTHER');

create type unit_of_measure as enum (
  'kg', 'g', 'lbs', 'pcs', 'packs', 'tbsp', 'tsp', 'ml', 'L', 'cups', 'stick', 'oz'
);

create type movement_event_type as enum (
  'PURCHASED', 'CONSUMED', 'EXPIRED', 'SPOILED_DISCARDED', 'MANUAL_ADJUST'
);

create type ingredient_availability_status as enum (
  'FULLY_AVAILABLE', 'PARTIALLY_AVAILABLE', 'MISSING'
);

-- =========================================================
-- HOUSEHOLDS
-- =========================================================
create table households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  weekly_shopping_day smallint check (weekly_shopping_day between 0 and 6),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column households.weekly_shopping_day is 'ISO-ish day index used by the Weekly Perishable Monitor cron';

-- =========================================================
-- HOUSEHOLD MEMBERS
-- =========================================================
create table household_members (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role household_role not null default 'MEMBER',
  joined_at timestamptz not null default now(),
  unique (household_id, user_id)
);

create index idx_household_members_user on household_members(user_id);
create index idx_household_members_household on household_members(household_id);

-- =========================================================
-- ITEM CATEGORIES
-- =========================================================
create table item_categories (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  name text not null,
  icon_key text,
  is_system_default boolean not null default false,
  created_at timestamptz not null default now(),
  unique (household_id, name)
);

create index idx_item_categories_household on item_categories(household_id);

-- =========================================================
-- RECIPES (created before pantry_items/movement logs since they FK to it)
-- =========================================================
create table recipes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  title text not null,
  source_type text check (source_type in ('OCR_IMAGE', 'PASTED_TEXT', 'URL')),
  raw_extracted_text text check (char_length(raw_extracted_text) <= 10000),
  servings smallint,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index idx_recipes_household on recipes(household_id);

-- =========================================================
-- GROCERY TRIPS (created before pantry_items since it FKs to it)
-- =========================================================
create table grocery_trips (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  store_name text,
  trip_date date not null default current_date,
  total_spent numeric(12, 2) not null default 0 check (total_spent >= 0),
  logged_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index idx_grocery_trips_household_date on grocery_trips(household_id, trip_date desc);

-- =========================================================
-- PANTRY ITEMS
-- =========================================================
create table pantry_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  category_id uuid references item_categories(id) on delete set null,
  grocery_trip_id uuid references grocery_trips(id) on delete set null,
  name text not null,
  quantity numeric(12, 3) not null default 0 check (quantity >= 0),
  unit unit_of_measure not null,
  storage_location storage_location not null default 'PANTRY',
  purchase_date date,
  expiration_date date,
  purchase_price numeric(12, 2) check (purchase_price >= 0),
  replenishment_threshold numeric(12, 3) default 0,
  notify_on_low_stock boolean not null default true,
  notify_days_before_expiry smallint default 3,
  is_archived boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_pantry_items_household on pantry_items(household_id) where is_archived = false;
create index idx_pantry_items_expiration on pantry_items(household_id, expiration_date)
  where is_archived = false and expiration_date is not null;
create index idx_pantry_items_low_stock on pantry_items(household_id)
  where is_archived = false and quantity <= replenishment_threshold;
create index idx_pantry_items_name_trgm on pantry_items using gin (name gin_trgm_ops);
create index idx_pantry_items_trip on pantry_items(grocery_trip_id);

-- =========================================================
-- INVENTORY MOVEMENT LOGS (append-only audit trail)
-- =========================================================
create table inventory_movement_logs (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  pantry_item_id uuid not null references pantry_items(id) on delete cascade,
  event_type movement_event_type not null,
  quantity_delta numeric(12, 3) not null,
  value_delta numeric(12, 2),
  triggered_by uuid references auth.users(id) on delete set null,
  related_recipe_id uuid references recipes(id) on delete set null,
  note text,
  occurred_at timestamptz not null default now()
);

create index idx_movement_logs_household_time on inventory_movement_logs(household_id, occurred_at desc);
create index idx_movement_logs_item on inventory_movement_logs(pantry_item_id, occurred_at desc);
create index idx_movement_logs_event_type on inventory_movement_logs(household_id, event_type);

-- =========================================================
-- RECIPE INGREDIENTS
-- =========================================================
create table recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references recipes(id) on delete cascade,
  raw_line text not null,
  parsed_name text not null,
  quantity numeric(12, 3),
  unit unit_of_measure,
  matched_pantry_item_id uuid references pantry_items(id) on delete set null,
  availability_status ingredient_availability_status,
  missing_quantity numeric(12, 3),
  sort_order smallint not null default 0
);

create index idx_recipe_ingredients_recipe on recipe_ingredients(recipe_id);
create index idx_recipe_ingredients_matched_item on recipe_ingredients(matched_pantry_item_id);

-- =========================================================
-- GROCERY LIST ENTRIES
-- =========================================================
create table grocery_list_entries (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  name text not null,
  quantity numeric(12, 3),
  unit unit_of_measure,
  source_recipe_ingredient_id uuid references recipe_ingredients(id) on delete set null,
  is_checked boolean not null default false,
  added_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index idx_grocery_list_household on grocery_list_entries(household_id, is_checked);

-- =========================================================
-- UPDATED_AT TRIGGER
-- =========================================================
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_households_updated_at
  before update on households
  for each row execute function set_updated_at();

create trigger trg_pantry_items_updated_at
  before update on pantry_items
  for each row execute function set_updated_at();
