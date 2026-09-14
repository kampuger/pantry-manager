-- =========================================================
-- PANTRY ITEMS: produce flag
-- =========================================================
alter table pantry_items
  add column is_produce boolean not null default true;

comment on column pantry_items.is_produce is
  'True for perishable produce (auto-expiry = purchase_date + 7 days); false requires a manually entered expiration_date.';

-- notify_days_before_expiry was already nullable; null now means "inherit
-- the household's produce/non-produce default" instead of a fixed 3.
alter table pantry_items
  alter column notify_days_before_expiry drop default;

-- =========================================================
-- HOUSEHOLDS: notification defaults
-- =========================================================
alter table households
  add column notify_days_produce smallint not null default 2,
  add column notify_days_nonproduce smallint not null default 7;

comment on column households.notify_days_produce is
  'Default reminder lead time (days before expiry) for produce items with no per-item override.';
comment on column households.notify_days_nonproduce is
  'Default reminder lead time (days before expiry) for non-produce items with no per-item override.';
