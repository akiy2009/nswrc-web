-- NSWRC contact inbox. Private server-only access; never expose contact rows to browser clients.
create table if not exists public.contact_messages (
 id uuid primary key default gen_random_uuid(),
 category text not null check (category in ('研究会について','参加・入会について','イベント・共同企画について','ニュース掲載依頼','その他')),
 name text not null check (char_length(name) between 1 and 100),
 email text not null check (char_length(email) between 3 and 254),
 affiliation text not null default '' check (char_length(affiliation) <= 120),
 message text not null check (char_length(message) between 10 and 5000),
 consent boolean not null check (consent = true),
 status text not null default 'new' check (status in ('new','reading','responding','resolved','closed')),
 admin_note text not null default '' check (char_length(admin_note) <= 2000),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists contact_messages_created_at_idx on public.contact_messages (created_at desc);
create index if not exists contact_messages_status_idx on public.contact_messages (status);
alter table public.contact_messages enable row level security;
revoke all on table public.contact_messages from anon, authenticated;
grant select, insert, update on table public.contact_messages to service_role;
