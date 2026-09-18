-- supabase/migrations/20260918000003_delete_household_admin.sql

-- =========================================================
-- ADMIN HOUSEHOLD DELETION
-- Lets a platform admin delete an arbitrary household (and, via the
-- existing `on delete cascade` foreign keys, everything attached to it) to
-- unblock admin-manage-users' delete_user action, which is blocked by
-- households.created_by ... on delete restrict while the household still
-- exists. Also lets an admin read an arbitrary household's name and member
-- count for the confirmation dialog before deleting it — households' and
-- household_members' existing SELECT policies only cover a household's own
-- creator/members, not an outside platform admin. These are additional,
-- purely additive policies: Postgres combines multiple permissive policies
-- for the same table+command with OR, so the existing owner/member-scoped
-- policies on both tables are completely unaffected.
-- =========================================================
create policy "platform admins can delete any household"
  on households for delete
  using (is_platform_admin());

create policy "platform admins can view any household"
  on households for select
  using (is_platform_admin());

create policy "platform admins can view any household's members"
  on household_members for select
  using (is_platform_admin());
