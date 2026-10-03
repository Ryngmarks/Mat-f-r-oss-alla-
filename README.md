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

   Har du redan en databas igång? Kör i stället bara de nyare filerna, i nummerordning –
   de lägger till och raderar ingenting:
   `supabase/02_forslagsbank_och_veckoplanering.sql`, `supabase/03_inkopslista.sql`,
   `supabase/04_butiker.sql`
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

## Förslagsbank

En gemensam matsedel som **alla inloggade kan läsa** men bara ägaren kan ändra. Den används som
grund för förslag i veckoplaneringen, och en rätt därifrån kan sparas i den egna matsedeln
(*Spara i …* på receptsidan). Ägaren kan lägga egna rätter i banken med *Lägg i förslagsbanken*,
eller byta till matsedeln *Förslagsbank* och lägga till och redigera där.

Bilderna återanvänds: rätterna i banken pekar på samma bildfiler som originalen, och en bild tas
bara bort när ingen rätt längre använder den. När någon sparar en bankrätt i sin egen matsedel
kopieras bilden inom lagringen så att kopian klarar sig själv.

Skapa banken en gång i SQL Editor (efter `02_forslagsbank_och_veckoplanering.sql`):

```sql
select create_suggestion_bank('din@epost.se');
```

Den kopierar alla rätter i din första egna matsedel till en ny matsedel som heter *Förslagsbank*.
Funktionen kan bara köras i SQL Editor, inte från appen.

## Veckoplanering

**Veckoplanering** på startsidan visar en kalendervecka, måndag–söndag, med **Lunch** och
**Middag**. Tryck **+ Välj** i en ruta, välj **Egen matsedel** eller **Förslagsbank**, sök och
tryck på en rätt – eller skriv något eget, t.ex. *Rester*. Allt sparas direkt.

Finns rätten inte trycker man **+ Skapa ny maträtt "…"** direkt i väljaren: formuläret öppnas
med namnet ifyllt, och när rätten sparas läggs den in i rutan och man kommer tillbaka till veckan.
Hittar sökningen inget i den egna matsedeln men i förslagsbanken visas det också.

- Pilarna byter vecka; *Sparade veckor* listar veckor som har planering.
- *Kopiera förra veckan* fyller de tomma rutorna med förra veckans måltider.
- Planen hör till matsedeln – alla som delar matsedeln ser och ändrar samma vecka.
- Rutorna pekar på recepten, inga bilder sparas för veckorna. Tas ett recept bort finns namnet
  kvar i planen som text.
- Startsidan visar kvällens middag.

## Inköpslista

I veckoplaneringen trycker man **🛒 Gör inköpslista**, väljer dagar och får en gemensam lista för
matsedeln.

- Samma vara från flera rätter slås ihop: vikt räknas om till g/kg, volym till ml/dl/l, övriga
  enheter (st, msk, burk …) summeras var för sig, t.ex. *Lök 3 st + 2 dl*. Under varje vara står
  vilka rätter den kommer från. Fritext i planen (t.ex. *Rester*) kommer inte med.
- Varorna grupperas per butiksavdelning (se *Butiker* nedan). Bocka av medan du handlar – det syns direkt hos alla i
  matsedeln (Supabase Realtime, plus en kontroll var 20:e sekund).
- **Egna varor** (t.ex. diskmedel) läggs till överst och ligger kvar när listan uppdateras.
  Skapar man listan igen ersätts de framräknade varorna, men det som redan är avbockat förblir
  avbockat.
- **Basvaror** (salt, peppar, olja, smör …) hamnar under *Har du hemma?*. Tryck *Behövs* för att
  ta med en den här gången. Via **⋯** vid en vara gör man den till basvara.
- Dela-knappen skickar listan som text (Anteckningar, sms, Messenger).

## Butiker

Högst upp i inköpslistan väljer man butik, och listan sorteras i den ordning man går där.

- **Avdelningar** är fasta och samma i alla butiker: Frukt & grönt, Bröd, Kött & kyckling,
  Chark & pålägg, Fisk & skaldjur, Ost, Mejeri & ägg, Kylt & färdigmat, Frys, Pasta, ris &
  torrvaror, Konserver & såser, Kryddor & bakning, Godis & snacks, Dryck, Hushåll & hygien
  och Övrigt (`js/sections.js`).
- Varje vara placeras automatiskt utifrån namnet. Ligger den fel trycker man **⋯** och väljer
  rätt avdelning – det sparas för matsedeln och gäller i alla butiker.
- **En butik** är bara en ordning av avdelningarna. *+ Ny butik* → namnge (t.ex. *ICA Maxi
  Luleå*) → flytta avdelningarna upp och ned i den ordning man går, och dölj det butiken saknar.
- Butiker är **gemensamma för alla användare**, men bara den som lagt upp en butik kan ändra
  den. Andra kan välja den eller göra *en egen kopia*.
- **Appen lär sig ordningen.** När man bockar av en vara direkt efter en vara i en annan
  avdelning räknas det som att den avdelningen kommer efter. Har samma ordning setts vid två
  tillfällen men butiken säger tvärtom flyttas avdelningen – och appen säger till. Det gäller
  butiker man själv lagt upp.

## Swipa fram middagen

Vet man inte vad man vill äta trycker man på **Swipa fram middagen** på startsidan. Rätterna i
matsedeln visas en i taget i slumpad ordning: **höger = ja**, **vänster = nej** (eller knapparna
✕ och ♥, eller piltangenterna på datorn). ↺ ångrar senaste valet och ett tryck på kortet öppnar
receptet. **Klar** – eller när rätterna tar slut – visar listan med det man sagt ja till, och
därifrån öppnar man recepten. Urvalet sparas tills fliken stängs, så man kan gå fram och
tillbaka mellan listan och recepten.

## Importera från ChatGPT

Man kan prata in maträtter i ChatGPT och importera dem i stället för att skriva.

1. Startsidan → **Importera maträtter** → **Kopiera instruktion till ChatGPT**
   (texten finns också i [`import/chatgpt-instruktion.md`](import/chatgpt-instruktion.md)).
2. Klistra in den i en ny chatt och berätta om maträtterna – skriv eller använd röstläget.
   Säg **”klar”** så svarar ChatGPT med ett JSON-kodblock. Skriv sedan **”bild”** så skapas
   en matbild per rätt utifrån rättens namn.
3. Kopiera svaret och klistra in det på importsidan, eller spara det som en `.json`-fil och
   välj filen.
4. Spara bilderna från ChatGPT i samma ordning som rätterna och tryck **Välj alla bilder på en
   gång**. Bilder vars filnamn innehåller rättens namn kopplas dit; resten fördelas i den
   ordning de sparades. Tryck på en bild vid en rätt för att byta. Bocka i rätterna och tryck
   **Importera**.

En fil kan innehålla hur många rätter som helst – säg flera rätter till ChatGPT innan du säger
”klar”.

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

Bara `name` krävs. Får man ingen JSON går det också att klistra in vanlig text – ett namn,
`Ingredienser:` med punktlista och eventuellt `Gör så här:` med steg. Saknas kategori gissas
den utifrån ingrediensens namn (köttfärs → Protein, ris → Kolhydrater osv.). Kategorier matchas på namn mot matsedelns kategorier; okända hamnar i
Övrigt. Rätter som redan finns med samma namn är urbockade från början. Bilderna ligger inte i
filen utan väljs per rätt på importsidan.

## Struktur

```
index.html          Skal, typsnitt, dialog
css/styles.css      All design (mobile first, mörkt läge)
js/app.js           Vyer och router: inloggning, startsida, detaljsida, skapa/redigera
js/libraries.js     Panelen Matsedlar: byta, skapa, dela, godkänna inbjudningar
js/planner.js       Veckoplanering och väljaren (egen matsedel / förslagsbank)
js/shopping.js      Inköpslista: sammanslagning, basvaror, butiker, delad lista
js/sections.js      Butiksavdelningar, gissning av avdelning och inlärning av ordning
js/swipe.js         Swipa fram middagen (ja/nej och resultatlista)
js/import.js        Import av maträtter (t.ex. från ChatGPT)
js/ui.js            Små delade hjälpare (escape, toast, dialog, ikoner)
js/store.js         Datalager – LocalStore och SupabaseStore med samma gränssnitt
js/image.js         Skalar ner och komprimerar bilder före uppladdning
js/config.js        Supabase-nycklar
import/             Instruktion till ChatGPT och exempelfil
supabase/schema.sql Hela databasen från grunden (tabeller, funktioner, RLS, bildbucket)
supabase/02_…sql    Tillägg för en befintlig databas: förslagsbank och veckoplanering
supabase/03_…sql    Tillägg: inköpslista och basvaror
supabase/04_…sql    Tillägg: butiker och var varor ligger
```

## Datamodell

- `library` – id, name, created_by, created_at, is_public (förslagsbanken)
- `library_member` – library_id, user_id, role (`owner`/`member`)
- `library_invite` – id, library_id, email, invited_by
- `meal` – id, library_id, name, description, image_path, instructions, created_at
- `ingredient` – id, library_id, name
- `category` – id, library_id, name, sort_order
- `meal_ingredient` – meal_id, ingredient_id, category_id, amount, unit, position
- `plan_entry` – id, library_id, day, slot (`lunch`/`middag`), meal_id, text
- `shopping_item` – id, library_id, name, amount, category, sources, checked, manual, pantry
- `pantry_item` – library_id, name, active (basvaror)
- `shopping_list` – library_id, label, store_id, updated_at
- `store` – id, name, created_by, section_order, hidden (gemensamma för alla)
- `item_section` – library_id, name, section (var en vara ligger, när man flyttat den)

Varje ny matsedel får standardkategorierna Protein, Kolhydrater, Grönsaker, Sås och Övrigt.
Kategorierna ligger i tabellen `category` och kan ändras per matsedel.
