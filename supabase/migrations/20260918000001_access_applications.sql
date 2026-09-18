-- supabase/migrations/20260918000001_access_applications.sql

-- =========================================================
-- ACCESS APPLICATIONS
-- Holds requests, not accounts — no auth.users row exists for an applicant
-- until an admin approves them (via the existing invite flow, which creates
-- one). Kept separate from platform_admins' suspend/ban mechanism so
-- "Suspended" in the admin's user list never gets confused with "someone
-- who never had access."
-- =========================================================
create table access_applications (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  message text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id)
);

-- Re-submitting the same email while a prior application is still pending
-- must not create a second row — the insert fails with a unique-violation
-- (code 23505), which the client-side wrapper catches and treats identically
-- to a successful first submission.
create unique index access_applications_pending_email
  on access_applications (email)
  where status = 'pending';

alter table access_applications enable row level security;

-- Deliberately constrains status/reviewed_at/reviewed_by to their
-- just-submitted defaults — an anonymous submitter cannot insert a row that
-- claims to already be approved or reviewed.
create policy "anyone can apply"
  on access_applications for insert
  to anon, authenticated
  with check (status = 'pending' and reviewed_at is null and reviewed_by is null);

create policy "admins can read applications"
  on access_applications for select
  using (is_platform_admin());

create policy "admins can review applications"
  on access_applications for update
  using (is_platform_admin())
  with check (is_platform_admin());

-- No DELETE policy: rejecting an application is a status update, not a row
-- removal — keeps a record of every reviewed application.
