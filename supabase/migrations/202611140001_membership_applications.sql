-- NSWRC membership applications
create extension if not exists pgcrypto;
create table if not exists public.membership_applications (
  id uuid primary key default gen_random_uuid(),
  application_type text not null check (application_type in ('individual','school','organization')),
  full_name text not null check (char_length(full_name) between 1 and 100),
  email text not null check (char_length(email) between 3 and 254),
  affiliation text not null default '' check (char_length(affiliation) <= 160),
  grade text not null default '' check (char_length(grade) <= 40),
  callsign text not null default '' check (char_length(callsign) <= 20),
  region text not null default '' check (char_length(region) <= 100),
  interests text[] not null default '{}',
  message text not null default '' check (char_length(message) <= 2000),
  privacy_consent boolean not null check (privacy_consent = true),
  status text not null default 'pending' check (status in ('pending','reviewing','approved','rejected','withdrawn')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists membership_applications_created_at_idx on public.membership_applications (created_at desc);
create index if not exists membership_applications_status_idx on public.membership_applications (status);
alter table public.membership_applications enable row level security;
-- Intentionally create no anon/authenticated table policies.
-- All reads/writes go through Vercel API routes using the server-only service role key.
