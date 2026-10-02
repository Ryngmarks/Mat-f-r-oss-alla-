-- Butiker och avdelningar för inköpslistan.
--
-- Kör den här filen EN gång i Supabase (SQL Editor → New query → Run) efter
-- 03_inkopslista.sql. Den lägger bara till saker och går att köra igen.
--
-- store        – en butik, t.ex. "ICA Maxi Luleå", med avdelningarnas ordning (section_order)
--                och avdelningar som butiken inte har (hidden). Alla inloggade kan läsa och
--                välja butiken, men bara den som skapade den kan ändra den.
-- item_section – var en vara ligger, när man själv har flyttat den (per matsedel).
--                Avdelningarna är fasta nycklar som appen känner till, t.ex. 'brod', 'kott'.

create table if not exists store (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  created_by     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  section_order  text[] not null default '{}',
  hidden         text[] not null default '{}',
  created_at     timestamptz not null default now()
);

create table if not exists item_section (
  library_id  uuid not null references library(id) on delete cascade,
  name        text not null,   -- gemener
  section     text not null,
  primary key (library_id, name)
);

alter table shopping_list add column if not exists store_id uuid references store(id) on delete set null;

alter table store        enable row level security;
alter table item_section enable row level security;

drop policy if exists "alla ser butiker"         on store;
drop policy if exists "skapa egen butik"         on store;
drop policy if exists "ändra egen butik"         on store;
drop policy if exists "ta bort egen butik"       on store;
drop policy if exists "medlem item_section"      on item_section;

create policy "alla ser butiker"   on store for select to authenticated using (true);
create policy "skapa egen butik"   on store for insert to authenticated with check (created_by = auth.uid());
create policy "ändra egen butik"   on store for update to authenticated using (created_by = auth.uid()) with check (created_by = auth.uid());
create policy "ta bort egen butik" on store for delete to authenticated using (created_by = auth.uid());

create policy "medlem item_section" on item_section for all to authenticated
  using (is_member(library_id)) with check (is_member(library_id));
