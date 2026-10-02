# Mat för oss alla

Ett visuellt matbibliotek. Se mat → bli sugen → klicka → se vad som behövs → eventuellt se hur den lagas.

Ren HTML, CSS och JavaScript – inget byggsteg.

## Öppna appen

**https://ryngmarks.github.io/Mat-f-r-oss-alla-/**

Appen publiceras med GitHub Pages direkt från `main`. Första gången slås det på under
*Settings → Pages → Build and deployment*: välj **Deploy from a branch**, branch **main**
och mapp **/ (root)**, och tryck *Save*. Efter det går varje push till `main` ut automatiskt
inom någon minut.

## Köra lokalt

Appen använder ES-moduler och måste därför serveras över http (inte öppnas som fil):

```bash
python3 -m http.server 8000
# eller: npx serve .
```

Öppna sedan http://localhost:8000.

## Lokalt läge och Supabase

Så länge `js/config.js` är tom körs appen i **lokalt läge**: allt sparas i webbläsarens
`localStorage`, med tre exempelrätter från start. Perfekt för att känna på flödet.

När Supabase ska kopplas på:

1. Skapa ett projekt på [supabase.com](https://supabase.com).
2. Kör `supabase/schema.sql` i **SQL Editor**. Den skapar tabellerna, standardkategorierna
   och bucketen `meal-images` för bilder.
3. Fyll i `SUPABASE_URL` och `SUPABASE_ANON_KEY` i `js/config.js`
   (finns under *Project Settings → API*).

Datan i lokalt läge flyttas inte med automatiskt.

## Användare

Med Supabase måste man logga in. Alla inloggade delar samma matbibliotek.

- **Skapa användare:** *Authentication → Users → Add user → Create new user*. Fyll i e-post
  och lösenord och kryssa i **Auto Confirm User**. Ingen e-post skickas.
- **Stäng av egen registrering:** *Authentication → Sign In / Providers* → slå av
  **Allow new users to sign up**. Då kan bara de du skapat logga in.
- **Byta lösenord:** öppna användaren i listan och sätt ett nytt.

Har du redan kört en äldre `schema.sql`? Kör då `supabase/02_inloggning.sql` en gång.

## Struktur

```
index.html          Skal, typsnitt, dialog
css/styles.css      All design (mobile first, mörkt läge)
js/app.js           Vyer och router: startsida, detaljsida, skapa/redigera
js/store.js         Datalager – LocalStore och SupabaseStore med samma gränssnitt
js/image.js         Skalar ner och komprimerar bilder före uppladdning
js/config.js        Supabase-nycklar
supabase/schema.sql Tabeller, kategorier, RLS och bildbucket
```

## Datamodell

- `meal` – id, name, description, image_url, instructions, created_at
- `ingredient` – id, name
- `category` – id, name, sort_order
- `meal_ingredient` – meal_id, ingredient_id, category_id, amount, unit, position

Kategorierna läses från databasen. Ändra, lägg till eller sortera om dem i tabellen `category`.
