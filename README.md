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
2. Kör `supabase/schema.sql` i **SQL Editor**. Den skapar tabellerna, reglerna och den
   privata bucketen `meal-images`. Filen bygger om tabellerna från grunden, så befintliga
   maträtter raderas om den körs igen.
3. Fyll i `SUPABASE_URL` och `SUPABASE_ANON_KEY` i `js/config.js`
   (finns under *Project Settings → API*).

Datan i lokalt läge flyttas inte med automatiskt.

## Användare och matsedlar

Med Supabase måste man logga in. **Varje användare har en egen matsedel** som ingen annan ser.
En matsedel blir gemensam först när någon i den bjuder in en e-postadress och mottagaren
godkänner. Man kan ha flera matsedlar, till exempel en egen och en delad med familjen.

Allt är separerat per matsedel: maträtter, ingredienser, kategorier och bilder. Bilderna
ligger i en privat bucket och visas med tidsbegränsade länkar. Databasens regler (RLS)
släpper bara fram matsedlar man är medlem i.

- **Skapa användare:** *Authentication → Users → Add user → Create new user*. Fyll i e-post
  och lösenord och kryssa i **Auto Confirm User**. Ingen e-post skickas.
- **Stäng av egen registrering:** *Authentication → Sign In / Providers* → slå av
  **Allow new users to sign up**. Då kan bara de du skapat logga in.
- **Dela:** tryck på matsedelns namn uppe till vänster → *Dela* → skriv e-postadressen.
  Mottagaren ser inbjudan när hen loggar in och väljer *Godkänn* eller *Nej tack*.
- **Ägaren** kan ta bort medlemmar och hela matsedeln. **Medlemmar** kan lämna.

## Importera från ChatGPT

Man kan prata in maträtter i ChatGPT och importera dem i stället för att skriva.

1. Startsidan → **Importera maträtter** → **Kopiera instruktion till ChatGPT**
   (texten finns också i [`import/chatgpt-instruktion.md`](import/chatgpt-instruktion.md)).
2. Klistra in den i en ny chatt och berätta om maträtterna – skriv eller använd röstläget.
   Säg **”klar”** så svarar ChatGPT med ett JSON-kodblock och skapar en matbild per rätt.
3. Kopiera svaret och klistra in det på importsidan, eller spara det som en `.json`-fil och
   välj filen.
4. Spara bilderna från ChatGPT och tryck på kameran vid respektive rätt (på datorn går det
   också att kopiera bilden och klistra in den). Bocka i rätterna och tryck **Importera**.

Formatet (se [`import/exempel.json`](import/exempel.json)):

```json
{
  "format": "mat-for-oss-alla",
  "version": 1,
  "meals": [
    {
      "name": "Tacos",
      "description": "Fredagsmys.",
      "ingredients": [{ "name": "Köttfärs", "category": "Protein", "amount": "500", "unit": "g" }],
      "instructions": ["Bryn färsen.", "Servera."]
    }
  ]
}
```

Bara `name` krävs. Kategorier matchas på namn mot matsedelns kategorier; okända hamnar i
Övrigt. Rätter som redan finns med samma namn är urbockade från början. Bilderna ligger inte i
filen utan väljs per rätt på importsidan.

## Struktur

```
index.html          Skal, typsnitt, dialog
css/styles.css      All design (mobile first, mörkt läge)
js/app.js           Vyer och router: inloggning, startsida, detaljsida, skapa/redigera
js/libraries.js     Panelen Matsedlar: byta, skapa, dela, godkänna inbjudningar
js/import.js        Import av maträtter (t.ex. från ChatGPT)
js/ui.js            Små delade hjälpare (escape, toast, dialog, ikoner)
js/store.js         Datalager – LocalStore och SupabaseStore med samma gränssnitt
js/image.js         Skalar ner och komprimerar bilder före uppladdning
js/config.js        Supabase-nycklar
import/             Instruktion till ChatGPT och exempelfil
supabase/schema.sql Tabeller, funktioner, RLS och privat bildbucket
```

## Datamodell

- `library` – id, name, created_by, created_at
- `library_member` – library_id, user_id, role (`owner`/`member`)
- `library_invite` – id, library_id, email, invited_by
- `meal` – id, library_id, name, description, image_path, instructions, created_at
- `ingredient` – id, library_id, name
- `category` – id, library_id, name, sort_order
- `meal_ingredient` – meal_id, ingredient_id, category_id, amount, unit, position

Varje ny matsedel får standardkategorierna Protein, Kolhydrater, Grönsaker, Sås och Övrigt.
Kategorierna ligger i tabellen `category` och kan ändras per matsedel.
