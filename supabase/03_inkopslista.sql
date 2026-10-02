-- Inköpslista och basvaror.
--
-- Kör den här filen EN gång i Supabase (SQL Editor → New query → Run) efter
-- 02_forslagsbank_och_veckoplanering.sql. Den lägger bara till saker och går att köra igen.
--
-- shopping_item – den gemensamma inköpslistan i en matsedel. Rader som räknats fram ur
--                 veckoplaneringen har manual = false och byts ut när listan uppdateras;
--                 egna rader (manual = true) ligger kvar.
-- pantry_item   – basvaror som man oftast har hemma. De hamnar under "Har du hemma?".
-- shopping_list – en rad per matsedel med vad listan senast skapades från.

create table if not exists shopping_item (
  id          uuid primary key default gen_random_uuid(),
  library_id  uuid not null references library(id) on delete cascade,
  name        text not null,
  amount      text,           -- färdig text, t.ex. "900 g" eller "1 st + 2 dl"
  category    text,           -- kategorinamn, t.ex. "Protein"
  sources     text,           -- rätterna varan kommer från, t.ex. "Tacos, Lasagne"
  checked     boolean not null default false,
  manual      boolean not null default false,
  pantry      boolean not null default false,
  position    int not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists shopping_item_library_idx on shopping_item (library_id);

create table if not exists pantry_item (
  library_id  uuid not null references library(id) on delete cascade,
  name        text not null,  -- gemener
  active      boolean not null default true,
  primary key (library_id, name)
);

create table if not exists shopping_list (
  library_id  uuid primary key references library(id) on delete cascade,
  label       text,
  updated_at  timestamptz not null default now()
);

alter table shopping_item enable row level security;
alter table pantry_item   enable row level security;
alter table shopping_list enable row level security;

drop policy if exists "medlem shopping_item" on shopping_item;
drop policy if exists "medlem pantry_item"   on pantry_item;
drop policy if exists "medlem shopping_list" on shopping_list;

create policy "medlem shopping_item" on shopping_item for all to authenticated
  using (is_member(library_id)) with check (is_member(library_id));
create policy "medlem pantry_item" on pantry_item for all to authenticated
  using (is_member(library_id)) with check (is_member(library_id));
create policy "medlem shopping_list" on shopping_list for all to authenticated
  using (is_member(library_id)) with check (is_member(library_id));

-- Realtid: avbockningar syns direkt hos de andra i matsedeln.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'shopping_item'
     ) then
    alter publication supabase_realtime add table shopping_item;
  end if;
end $$;
