-- NSWRC membership operations: private notes and administrator audit trail
-- Apply after 202611140001_membership_applications.sql in Supabase SQL Editor.
alter table public.membership_applications
  add column if not exists admin_note text not null default '';
alter table public.membership_applications
  drop constraint if exists membership_applications_admin_note_length;
alter table public.membership_applications
  add constraint membership_applications_admin_note_length check (char_length(admin_note) <= 2000);

create table if not exists public.membership_admin_audit (
  id uuid primary key default gen_random_uuid(),
  application_id uuid references public.membership_applications(id) on delete set null,
  actor_id uuid not null,
  actor_email text not null default '',
  action text not null check (action in ('status_changed','note_updated')),
  old_status text check (old_status is null or old_status in ('pending','reviewing','approved','rejected','withdrawn')),
  new_status text check (new_status is null or new_status in ('pending','reviewing','approved','rejected','withdrawn')),
  created_at timestamptz not null default now()
);
create index if not exists membership_admin_audit_created_at_idx
  on public.membership_admin_audit (created_at desc);
create index if not exists membership_admin_audit_application_id_idx
  on public.membership_admin_audit (application_id);
alter table public.membership_admin_audit enable row level security;
-- No anon/authenticated policies. Access is exclusively through the server-side admin API.
