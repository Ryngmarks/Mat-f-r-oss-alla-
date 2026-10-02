-- Förslagsbank och veckoplanering.
--
-- Kör den här filen EN gång i Supabase (SQL Editor → New query → Run) om du redan har
-- databasen igång. Den lägger bara till saker – inga maträtter raderas.
-- Filen går att köra flera gånger utan att något förstörs.
--
-- Skapa sedan förslagsbanken från din egen matsedel med (byt till din e-post):
--
--     select create_suggestion_bank('din@epost.se');
--
-- Förslagsbank:
--   En matsedel med is_public = true. Alla inloggade kan läsa den, men bara dess
--   medlemmar (ägaren) kan ändra. Bilderna återanvänds – inga nya filer skapas.
--
-- Veckoplanering:
--   plan_entry – en rad per dag och måltid (lunch/middag) i en matsedel. Pekar på ett
--   recept (meal_id) och/eller en fritext (text). Delas med alla medlemmar i matsedeln.

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
