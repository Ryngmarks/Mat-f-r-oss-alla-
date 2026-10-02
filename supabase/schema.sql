-- Mat för oss alla – databas och bildlagring.
-- Kör hela filen i Supabase: SQL Editor → New query → Run.

-- Tabeller -----------------------------------------------------------

create table if not exists category (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  sort_order  int  not null default 0
);

create table if not exists ingredient (
  id    uuid primary key default gen_random_uuid(),
  name  text not null unique
);

create table if not exists meal (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  description   text,
  image_url     text,
  instructions  text,          -- ett steg per rad, valfritt
  created_at    timestamptz not null default now()
);

create table if not exists meal_ingredient (
  meal_id        uuid not null references meal(id) on delete cascade,
  ingredient_id  uuid not null references ingredient(id) on delete restrict,
  category_id    uuid not null references category(id) on delete restrict,
  amount         text,          -- text så att "½" eller "en nypa" fungerar
  unit           text,
  position       int  not null default 0,
  primary key (meal_id, ingredient_id)
);

create index if not exists meal_created_at_idx on meal (created_at desc);

-- Standardkategorier ----------------------------------------------

insert into category (name, sort_order) values
  ('Protein', 1),
  ('Kolhydrater', 2),
  ('Grönsaker', 3),
  ('Sås', 4),
  ('Övrigt', 5)
on conflict (name) do nothing;

-- Åtkomst ------------------------------------------------------------
-- Bara inloggade användare kan läsa och ändra. Alla inloggade delar samma bibliotek.
-- Användare skapas i Supabase: Authentication → Users → Add user.

alter table category        enable row level security;
alter table ingredient      enable row level security;
alter table meal            enable row level security;
alter table meal_ingredient enable row level security;

create policy "inloggade category"        on category        for all to authenticated using (true) with check (true);
create policy "inloggade ingredient"      on ingredient      for all to authenticated using (true) with check (true);
create policy "inloggade meal"            on meal            for all to authenticated using (true) with check (true);
create policy "inloggade meal_ingredient" on meal_ingredient for all to authenticated using (true) with check (true);

-- Bildlagring ----------------------------------------------------

insert into storage.buckets (id, name, public)
values ('meal-images', 'meal-images', true)
on conflict (id) do nothing;

create policy "meal images read"   on storage.objects for select using (bucket_id = 'meal-images');
create policy "meal images insert" on storage.objects for insert to authenticated with check (bucket_id = 'meal-images');
create policy "meal images update" on storage.objects for update to authenticated using (bucket_id = 'meal-images');
create policy "meal images delete" on storage.objects for delete to authenticated using (bucket_id = 'meal-images');
