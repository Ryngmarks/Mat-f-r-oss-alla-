-- Mat för oss alla – databas, matsedlar, delning och bildlagring.
--
-- Kör hela filen i Supabase: SQL Editor → New query → Run.
--
-- ⚠️  Filen bygger om tabellerna från grunden. Maträtter som redan finns
--     i databasen raderas. Användarna (Authentication → Users) påverkas inte.
--
-- Modell:
--   Varje användare får en egen matsedel (library) första gången hen loggar in.
--   All data – maträtter, ingredienser, kategorier och bilder – hör till en matsedel.
--   En matsedel syns bara för sina medlemmar. Man blir medlem genom att någon i
--   matsedeln bjuder in ens e-postadress och man själv godkänner inbjudan.

-- Rensa ----------------------------------------------------------

drop table if exists shopping_item, pantry_item, shopping_list, plan_entry, meal_ingredient, meal, ingredient, category,
  library_invite, library_member, library cascade;

-- Tabeller -------------------------------------------------------

create table library (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_by  uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now()
);

create table library_member (
  library_id  uuid not null references library(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null default 'member' check (role in ('owner', 'member')),
  created_at  timestamptz not null default now(),
  primary key (library_id, user_id)
);

create table library_invite (
  id          uuid primary key default gen_random_uuid(),
  library_id  uuid not null references library(id) on delete cascade,
  email       text not null check (email = lower(email)),
  invited_by  uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (library_id, email)
);

create table category (
  id          uuid primary key default gen_random_uuid(),
  library_id  uuid not null references library(id) on delete cascade,
  name        text not null,
  sort_order  int  not null default 0,
  unique (library_id, name)
);

create table ingredient (
  id          uuid primary key default gen_random_uuid(),
  library_id  uuid not null references library(id) on delete cascade,
  name        text not null,
  unique (library_id, name)
);

create table meal (
  id            uuid primary key default gen_random_uuid(),
  library_id    uuid not null references library(id) on delete cascade,
  name          text not null,
  description   text,
  image_path    text,          -- sökväg i bucketen meal-images: <library_id>/<fil>
  instructions  text,          -- ett steg per rad, valfritt
  created_at    timestamptz not null default now()
);

create table meal_ingredient (
  meal_id        uuid not null references meal(id) on delete cascade,
  ingredient_id  uuid not null references ingredient(id) on delete cascade,
  category_id    uuid not null references category(id) on delete restrict,
  amount         text,          -- text så att "½" eller "en nypa" fungerar
  unit           text,
  position       int  not null default 0,
  primary key (meal_id, ingredient_id)
);

create index on library_member (user_id);
create index on library_invite (email);
create index on meal (library_id, created_at desc);
create index on category (library_id);
create index on ingredient (library_id);

-- Hjälpfunktioner för behörighet -----------------------------------
-- security definer så att policies kan fråga library_member utan rekursion.

create or replace function is_member(lib uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from library_member where library_id = lib and user_id = auth.uid());
$$;

create or replace function is_owner(lib uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from library_member where library_id = lib and user_id = auth.uid() and role = 'owner');
$$;

-- Bildfiler ligger under <library_id>/… – första mappen avgör behörigheten.
create or replace function is_member_path(path text) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when split_part(path, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then is_member(split_part(path, '/', 1)::uuid)
    else false
  end;
$$;

-- Funktioner som appen anropar -------------------------------------

create or replace function create_library(p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare lib uuid;
begin
  if auth.uid() is null then raise exception 'Inte inloggad'; end if;
  insert into library (name, created_by)
    values (coalesce(nullif(trim(p_name), ''), 'Min matsedel'), auth.uid())
    returning id into lib;
  insert into library_member (library_id, user_id, role) values (lib, auth.uid(), 'owner');
  insert into category (library_id, name, sort_order) values
    (lib, 'Protein', 1), (lib, 'Kolhydrater', 2), (lib, 'Grönsaker', 3), (lib, 'Sås', 4), (lib, 'Övrigt', 5);
  return lib;
end $$;

-- Ger användaren en egen matsedel om hen inte är med i någon.
create or replace function ensure_library() returns uuid
language plpgsql security definer set search_path = public as $$
declare lib uuid;
begin
  if auth.uid() is null then raise exception 'Inte inloggad'; end if;
  perform pg_advisory_xact_lock(hashtext(auth.uid()::text));
  select library_id into lib from library_member where user_id = auth.uid() order by created_at limit 1;
  if lib is null then lib := create_library('Min matsedel'); end if;
  return lib;
end $$;

-- Inbjudningar som väntar på att den inloggade ska svara.
create or replace function my_invites()
returns table (id uuid, library_id uuid, library_name text, invited_by text)
language sql stable security definer set search_path = public as $$
  select i.id, i.library_id, l.name, u.email::text
  from library_invite i
  join library l on l.id = i.library_id
  left join auth.users u on u.id = i.invited_by
  where i.email = lower(auth.jwt() ->> 'email')
    and not exists (select 1 from library_member m where m.library_id = i.library_id and m.user_id = auth.uid())
  order by i.created_at;
$$;

create or replace function accept_invite(p_invite uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare inv library_invite;
begin
  select * into inv from library_invite where id = p_invite and email = lower(auth.jwt() ->> 'email');
  if not found then raise exception 'Inbjudan finns inte längre'; end if;
  insert into library_member (library_id, user_id, role) values (inv.library_id, auth.uid(), 'member')
    on conflict do nothing;
  delete from library_invite where id = inv.id;
  return inv.library_id;
end $$;

create or replace function decline_invite(p_invite uuid) returns void
language sql security definer set search_path = public as $$
  delete from library_invite where id = p_invite and email = lower(auth.jwt() ->> 'email');
$$;

-- Medlemmar med e-post (e-posten finns bara i auth.users).
create or replace function library_members(p_library uuid)
returns table (user_id uuid, email text, role text)
language sql stable security definer set search_path = public as $$
  select m.user_id, u.email::text, m.role
  from library_member m join auth.users u on u.id = m.user_id
  where m.library_id = p_library and is_member(p_library)
  order by m.role desc, m.created_at;
$$;

revoke execute on function create_library(text), ensure_library(), my_invites(), accept_invite(uuid),
  decline_invite(uuid), library_members(uuid) from public, anon;
grant execute on function create_library(text), ensure_library(), my_invites(), accept_invite(uuid),
  decline_invite(uuid), library_members(uuid) to authenticated;

-- Åtkomstregler (RLS) ----------------------------------------------

alter table library         enable row level security;
alter table library_member  enable row level security;
alter table library_invite  enable row level security;
alter table category        enable row level security;
alter table ingredient      enable row level security;
alter table meal            enable row level security;
alter table meal_ingredient enable row level security;

-- Matsedlar skapas via create_library(), inte direkt.
create policy "medlem ser matsedel"    on library for select to authenticated using (is_member(id));
create policy "medlem byter namn"      on library for update to authenticated using (is_member(id)) with check (is_member(id));
create policy "ägare tar bort"         on library for delete to authenticated using (is_owner(id));

-- Medlemmar läggs till via accept_invite(), inte direkt.
create policy "medlem ser medlemmar"   on library_member for select to authenticated using (is_member(library_id));
create policy "lämna eller ta bort"    on library_member for delete to authenticated using (
  (user_id = auth.uid() and role <> 'owner') or (is_owner(library_id) and user_id <> auth.uid())
);

create policy "medlem ser inbjudningar" on library_invite for select to authenticated using (is_member(library_id));
create policy "medlem bjuder in"        on library_invite for insert to authenticated
  with check (is_member(library_id) and invited_by = auth.uid());
create policy "medlem återkallar"       on library_invite for delete to authenticated using (is_member(library_id));

create policy "medlem category"   on category   for all to authenticated using (is_member(library_id)) with check (is_member(library_id));
create policy "medlem ingredient" on ingredient for all to authenticated using (is_member(library_id)) with check (is_member(library_id));
create policy "medlem meal"       on meal       for all to authenticated using (is_member(library_id)) with check (is_member(library_id));
create policy "medlem meal_ingredient" on meal_ingredient for all to authenticated
  using (exists (select 1 from meal m where m.id = meal_id and is_member(m.library_id)))
  with check (exists (select 1 from meal m where m.id = meal_id and is_member(m.library_id)));

-- Bildlagring (privat) ---------------------------------------------

insert into storage.buckets (id, name, public)
values ('meal-images', 'meal-images', false)
on conflict (id) do update set public = false;

drop policy if exists "meal images read"   on storage.objects;
drop policy if exists "meal images insert" on storage.objects;
drop policy if exists "meal images update" on storage.objects;
drop policy if exists "meal images delete" on storage.objects;
drop policy if exists "matsedel bilder läsa"   on storage.objects;
drop policy if exists "matsedel bilder spara"  on storage.objects;
drop policy if exists "matsedel bilder ändra"  on storage.objects;
drop policy if exists "matsedel bilder ta bort" on storage.objects;

create policy "matsedel bilder läsa"    on storage.objects for select to authenticated
  using (bucket_id = 'meal-images' and public.is_member_path(name));
create policy "matsedel bilder spara"   on storage.objects for insert to authenticated
  with check (bucket_id = 'meal-images' and public.is_member_path(name));
create policy "matsedel bilder ändra"   on storage.objects for update to authenticated
  using (bucket_id = 'meal-images' and public.is_member_path(name));
create policy "matsedel bilder ta bort" on storage.objects for delete to authenticated
  using (bucket_id = 'meal-images' and public.is_member_path(name));

-- ===== Förslagsbank och veckoplanering (samma som 02_forslagsbank_och_veckoplanering.sql) =====

-- Förslagsbank -------------------------------------------------------

alter table library add column if not exists is_public boolean not null default false;

-- Från appen får man bara byta namn på en matsedel – aldrig göra den publik.
revoke update on library from anon, authenticated;
grant update (name) on library to authenticated;

create or replace function is_public_library(lib uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from library where id = lib and is_public);
$$;

-- En bild får läsas av alla inloggade om en rätt i förslagsbanken använder den.
create or replace function is_public_image(path text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from meal m join library l on l.id = m.library_id
    where l.is_public and m.image_path = path
  );
$$;

drop policy if exists "alla läser förslagsbank"            on library;
drop policy if exists "alla läser förslagsbank category"   on category;
drop policy if exists "alla läser förslagsbank ingredient" on ingredient;
drop policy if exists "alla läser förslagsbank meal"       on meal;
drop policy if exists "alla läser förslagsbank meal_ingredient" on meal_ingredient;

create policy "alla läser förslagsbank"            on library    for select to authenticated using (is_public);
create policy "alla läser förslagsbank category"   on category   for select to authenticated using (is_public_library(library_id));
create policy "alla läser förslagsbank ingredient" on ingredient for select to authenticated using (is_public_library(library_id));
create policy "alla läser förslagsbank meal"       on meal       for select to authenticated using (is_public_library(library_id));
create policy "alla läser förslagsbank meal_ingredient" on meal_ingredient for select to authenticated
  using (exists (select 1 from meal m where m.id = meal_id and is_public_library(m.library_id)));

drop policy if exists "förslagsbank bilder läsa" on storage.objects;
create policy "förslagsbank bilder läsa" on storage.objects for select to authenticated
  using (bucket_id = 'meal-images' and public.is_public_image(name));

-- Skapar förslagsbanken som en kopia av användarens första egna matsedel.
-- Körs av dig i SQL Editor – appen kan inte anropa den.
create or replace function create_suggestion_bank(p_email text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  uid  uuid;
  src  uuid;
  bank uuid;
  m    record;
  nm   uuid;
begin
  select id into uid from auth.users where lower(email) = lower(trim(p_email));
  if uid is null then raise exception 'Hittar ingen användare med e-post %', p_email; end if;

  select id into bank from library where is_public limit 1;
  if bank is not null then
    raise notice 'Förslagsbanken finns redan (%). Lägg till rätter i den direkt i appen.', bank;
    return bank;
  end if;

  select library_id into src from library_member
    where user_id = uid and role = 'owner' order by created_at limit 1;
  if src is null then raise exception 'Användaren har ingen egen matsedel ännu – logga in i appen först.'; end if;

  insert into library (name, created_by, is_public) values ('Förslagsbank', uid, true) returning id into bank;
  insert into library_member (library_id, user_id, role) values (bank, uid, 'owner');
  insert into category (library_id, name, sort_order)
    select bank, name, sort_order from category where library_id = src;
  insert into ingredient (library_id, name)
    select bank, name from ingredient where library_id = src;

  for m in select * from meal where library_id = src order by created_at loop
    insert into meal (library_id, name, description, image_path, instructions, created_at)
      values (bank, m.name, m.description, m.image_path, m.instructions, m.created_at)
      returning id into nm;
    insert into meal_ingredient (meal_id, ingredient_id, category_id, amount, unit, position)
      select nm, bi.id, bc.id, mi.amount, mi.unit, mi.position
      from meal_ingredient mi
      join ingredient i  on i.id = mi.ingredient_id
      join category   c  on c.id = mi.category_id
      join ingredient bi on bi.library_id = bank and bi.name = i.name
      join category   bc on bc.library_id = bank and bc.name = c.name
      where mi.meal_id = m.id;
  end loop;

  return bank;
end $$;

revoke execute on function create_suggestion_bank(text) from public, anon, authenticated;

-- Veckoplanering -----------------------------------------------------

create table if not exists plan_entry (
  id          uuid primary key default gen_random_uuid(),
  library_id  uuid not null references library(id) on delete cascade,
  day         date not null,
  slot        text not null check (slot in ('lunch', 'middag')),
  meal_id     uuid references meal(id) on delete set null,
  text        text,           -- fritext, eller rättens namn som minne om receptet tas bort
  created_at  timestamptz not null default now(),
  unique (library_id, day, slot)
);

create index if not exists plan_entry_library_day_idx on plan_entry (library_id, day);

alter table plan_entry enable row level security;

drop policy if exists "medlem plan_entry" on plan_entry;
create policy "medlem plan_entry" on plan_entry for all to authenticated
  using (is_member(library_id)) with check (is_member(library_id));

-- ===== Inköpslista (samma som 03_inkopslista.sql) =====

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
