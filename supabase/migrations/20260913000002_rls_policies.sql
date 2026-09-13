-- =========================================================
-- HELPER FUNCTIONS
-- =========================================================
create or replace function is_household_member(target_household_id uuid)
returns boolean
language sql
security definer
stable
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from household_members hm
    where hm.household_id = target_household_id
      and hm.user_id = auth.uid()
  );
$$;

create or replace function is_household_admin_or_owner(target_household_id uuid)
returns boolean
language sql
security definer
stable
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from household_members hm
    where hm.household_id = target_household_id
      and hm.user_id = auth.uid()
      and hm.role in ('OWNER', 'ADMIN')
  );
$$;

-- =========================================================
-- ENABLE RLS
-- =========================================================
alter table households enable row level security;
alter table household_members enable row level security;
alter table item_categories enable row level security;
alter table pantry_items enable row level security;
alter table inventory_movement_logs enable row level security;
alter table recipes enable row level security;
alter table recipe_ingredients enable row level security;
alter table grocery_trips enable row level security;
alter table grocery_list_entries enable row level security;

-- =========================================================
-- HOUSEHOLDS
-- =========================================================
create policy "members can read their household"
  on households for select
  using (created_by = auth.uid() or is_household_member(id));

create policy "any authenticated user can create a household"
  on households for insert
  with check (created_by = auth.uid());

create policy "owners/admins can update household"
  on households for update
  using (is_household_admin_or_owner(id));

create policy "only owner can delete household"
  on households for delete
  using (
    exists (
      select 1 from household_members hm
      where hm.household_id = id and hm.user_id = auth.uid() and hm.role = 'OWNER'
    )
  );

-- =========================================================
-- HOUSEHOLD MEMBERS
-- =========================================================
create policy "members can view membership roster"
  on household_members for select
  using (is_household_member(household_id));

create policy "owners/admins can add members"
  on household_members for insert
  with check (is_household_admin_or_owner(household_id));

create policy "creator can add themselves as owner"
  on household_members for insert
  with check (
    user_id = auth.uid()
    and role = 'OWNER'
    and exists (
      select 1 from households h
      where h.id = household_id and h.created_by = auth.uid()
    )
  );

create policy "owners/admins can update member roles"
  on household_members for update
  using (is_household_admin_or_owner(household_id));

create policy "owners/admins can remove members"
  on household_members for delete
  using (is_household_admin_or_owner(household_id));

-- =========================================================
-- ITEM CATEGORIES
-- =========================================================
create policy "members can read categories"
  on item_categories for select
  using (is_household_member(household_id));

create policy "members can create categories"
  on item_categories for insert
  with check (is_household_member(household_id));

create policy "members can update categories"
  on item_categories for update
  using (is_household_member(household_id));

create policy "admins/owners can delete categories"
  on item_categories for delete
  using (is_household_admin_or_owner(household_id));

-- =========================================================
-- PANTRY ITEMS
-- =========================================================
create policy "members can read pantry items"
  on pantry_items for select
  using (is_household_member(household_id));

create policy "members can insert pantry items"
  on pantry_items for insert
  with check (is_household_member(household_id));

create policy "members can update pantry items"
  on pantry_items for update
  using (is_household_member(household_id));

create policy "members can delete pantry items"
  on pantry_items for delete
  using (is_household_member(household_id));

-- =========================================================
-- INVENTORY MOVEMENT LOGS (append-only: no update/delete policies)
-- =========================================================
create policy "members can read movement logs"
  on inventory_movement_logs for select
  using (is_household_member(household_id));

create policy "members can insert movement logs"
  on inventory_movement_logs for insert
  with check (is_household_member(household_id));

-- =========================================================
-- RECIPES
-- =========================================================
create policy "members can read recipes"
  on recipes for select
  using (is_household_member(household_id));

create policy "members can insert recipes"
  on recipes for insert
  with check (is_household_member(household_id));

create policy "members can delete their household's recipes"
  on recipes for delete
  using (is_household_member(household_id));

-- =========================================================
-- RECIPE INGREDIENTS (scoped via parent recipe's household)
-- =========================================================
create policy "members can read recipe ingredients"
  on recipe_ingredients for select
  using (
    exists (
      select 1 from recipes r
      where r.id = recipe_ingredients.recipe_id
        and is_household_member(r.household_id)
    )
  );

create policy "members can insert recipe ingredients"
  on recipe_ingredients for insert
  with check (
    exists (
      select 1 from recipes r
      where r.id = recipe_ingredients.recipe_id
        and is_household_member(r.household_id)
    )
  );

create policy "members can update recipe ingredients"
  on recipe_ingredients for update
  using (
    exists (
      select 1 from recipes r
      where r.id = recipe_ingredients.recipe_id
        and is_household_member(r.household_id)
    )
  );

-- =========================================================
-- GROCERY TRIPS
-- =========================================================
create policy "members can read grocery trips"
  on grocery_trips for select
  using (is_household_member(household_id));

create policy "members can insert grocery trips"
  on grocery_trips for insert
  with check (is_household_member(household_id));

create policy "members can update grocery trips"
  on grocery_trips for update
  using (is_household_member(household_id));

-- =========================================================
-- GROCERY LIST ENTRIES
-- =========================================================
create policy "members can read grocery list"
  on grocery_list_entries for select
  using (is_household_member(household_id));

create policy "members can insert grocery list entries"
  on grocery_list_entries for insert
  with check (is_household_member(household_id));

create policy "members can update grocery list entries"
  on grocery_list_entries for update
  using (is_household_member(household_id));

create policy "members can delete grocery list entries"
  on grocery_list_entries for delete
  using (is_household_member(household_id));
