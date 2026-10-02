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

drop table if exists meal_ingredient, meal, ingredient, category,
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
