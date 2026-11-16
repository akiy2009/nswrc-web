alter table public.membership_applications add column if not exists full_name_kana text not null default '';
alter table public.members add column if not exists full_name_kana text not null default '';
