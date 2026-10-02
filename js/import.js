// Import av maträtter, t.ex. från ChatGPT. Formatet beskrivs i import/chatgpt-instruktion.md.
// Läsningen är förlåtande: kodblock runt texten, svenska fältnamn, steg som text
// eller lista och okända kategorier hanteras.

import { esc, toast, ICON } from './ui.js';
import { resizeImage } from './image.js';

const fold = (s) =>
  String(s ?? '')
    .toLocaleLowerCase('sv')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();

const text = (v) => (v === null || v === undefined ? '' : String(v).trim());
const pick = (o, ...keys) => keys.map((k) => o?.[k]).find((v) => v !== undefined && v !== null);

// Vanliga felstavningar/synonymer → standardkategori.
const ALIASES = {
  kott: 'protein', fisk: 'protein', kyckling: 'protein', proteiner: 'protein',
  kolhydrat: 'kolhydrater', pasta: 'kolhydrater',
  gronsak: 'gronsaker', gront: 'gronsaker',
  sas: 'sas', saser: 'sas', dressing: 'sas',
  ovrigt: 'ovrigt', annat: 'ovrigt', kryddor: 'ovrigt', krydda: 'ovrigt',
};

export function parseImport(raw, categories) {
  const t = String(raw || '');
  const start = t.search(/[[{]/);
  const end = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
  if (start < 0 || end < start) throw new Error('Hittade inga maträtter. Klistra in hela svaret från ChatGPT.');

  let data;
  try {
    data = JSON.parse(t.slice(start, end + 1));
  } catch {
    throw new Error('Texten gick inte att läsa. Kontrollera att hela kodblocket kom med.');
  }

  const list = Array.isArray(data) ? data : Array.isArray(pick(data, 'meals', 'maträtter', 'matratter')) ? pick(data, 'meals', 'maträtter', 'matratter') : [data];

  const byName = new Map(categories.map((c) => [fold(c.name), c.id]));
  const fallback = byName.get('ovrigt') ?? categories.at(-1)?.id;
  const categoryId = (name) => {
    const f = fold(name);
    return byName.get(f) ?? byName.get(ALIASES[f]) ?? fallback;
  };

  const meals = list
    .filter((m) => m && typeof m === 'object')
    .map((m) => {
      const rawSteps = pick(m, 'instructions', 'instruktioner', 'steps', 'steg') ?? [];
      const steps = (Array.isArray(rawSteps) ? rawSteps : String(rawSteps).split('\n'))
        .map((s) => text(typeof s === 'object' ? pick(s, 'text', 'step', 'steg') : s).replace(/^\d+[.)]\s*/, ''))
        .filter(Boolean);

      const rawIngs = pick(m, 'ingredients', 'ingredienser') ?? [];
      const ingredients = (Array.isArray(rawIngs) ? rawIngs : [])
        .map((i) =>
          typeof i === 'string'
            ? { name: text(i), category_id: fallback, amount: '', unit: '' }
            : {
                name: text(pick(i, 'name', 'namn')),
                category_id: categoryId(pick(i, 'category', 'kategori')),
                amount: text(pick(i, 'amount', 'mängd', 'mangd')),
                unit: text(pick(i, 'unit', 'enhet')),
              }
        )
        .filter((i) => i.name);

      return {
        name: text(pick(m, 'name', 'namn')),
        description: text(pick(m, 'description', 'beskrivning')),
        instructions: steps.join('\n'),
        ingredients,
      };
    })
    .filter((m) => m.name);

  if (!meals.length) throw new Error('Hittade inga maträtter med namn i texten.');
  return meals;
}

async function loadPrompt(categories) {
  const res = await fetch('import/chatgpt-instruktion.md');
  if (!res.ok) throw new Error('Kunde inte hämta instruktionen');
  const names = categories.map((c) => `"${c.name}"`).join(', ');
  return (await res.text()).replace('{{KATEGORIER}}', names);
}

async function copy(textToCopy) {
  try {
    await navigator.clipboard.writeText(textToCopy);
    return true;
  } catch {
    // Reserv för webbläsare utan clipboard-API.
    const ta = document.createElement('textarea');
    ta.value = textToCopy;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

export async function renderImport({ app, store, categories }) {
  document.title = 'Importera maträtter';
  const existing = new Set((await store.listMeals()).map((m) => fold(m.name)));
  const catName = (id) => categories.find((c) => c.id === id)?.name ?? '';
  let parsed = [];
  const images = new Map(); // rättens namn (normaliserat) → { blob, url }

  app.innerHTML = `
    <header class="top top--form">
      <div class="wrap narrow top__inner">
        <a href="#/" class="round round--plain" aria-label="Tillbaka">${ICON.back}</a>
        <span class="top__title">Importera maträtter</span>
        <span class="round-spacer"></span>
      </div>
    </header>

    <main class="wrap narrow form">
      <section class="field">
        <span class="label"><span class="num">1</span>Prata in maträtterna med ChatGPT</span>
        <p class="muted import__help">
          Kopiera instruktionen och klistra in den i en ny chatt i ChatGPT. Berätta sedan om
          maträtterna – skriv eller använd röstläget. Säg <strong>”klar”</strong> när du är färdig,
          så svarar ChatGPT med en fil i rätt format och skapar en bild till varje rätt.
        </p>
        <button type="button" class="btn btn--soft" data-copy>Kopiera instruktion till ChatGPT</button>
      </section>

      <section class="field">
        <label class="label" for="import-text"><span class="num">2</span>Klistra in svaret</label>
        <textarea id="import-text" class="input import__text" rows="6" placeholder="Klistra in hela svaret från ChatGPT här…" spellcheck="false"></textarea>
        <div class="import__or">
          <span class="muted">eller</span>
          <label class="btn btn--ghost" for="import-file">Välj fil (.json)</label>
          <input type="file" id="import-file" accept=".json,.txt,application/json,text/plain" class="sr-only">
        </div>
        <p class="login__error" data-error role="alert" hidden></p>
      </section>

      <section class="field" data-preview hidden>
        <span class="label"><span class="num">3</span>Välj rätter och lägg till bilder</span>
        <p class="muted import__help">Spara bilderna från ChatGPT och tryck på kameran vid varje rätt. På datorn kan du också kopiera en bild och klistra in den här.</p>
        <ul class="import__list" data-list></ul>
      </section>

      <div class="form__save" data-save-bar hidden>
        <button type="button" class="btn btn--primary btn--block btn--lg" data-save></button>
      </div>
    </main>`;

  window.scrollTo(0, 0);
  const $ = (s) => app.querySelector(s);
  const input = $('#import-text');
  const err = $('[data-error]');
  const list = $('[data-list]');
  const saveBtn = $('[data-save]');

  const selected = () => [...list.querySelectorAll('input[type=checkbox]')].filter((c) => c.checked).map((c) => parsed[+c.value]);

  function updateSave() {
    const n = selected().length;
    $('[data-save-bar]').hidden = !parsed.length;
    saveBtn.disabled = n === 0;
    saveBtn.textContent = n === 1 ? 'Importera 1 maträtt' : `Importera ${n} maträtter`;
  }

  function draw() {
    $('[data-preview]').hidden = !parsed.length;
    list.innerHTML = parsed
      .map((m, i) => {
        const dup = existing.has(fold(m.name));
        const steps = m.instructions ? m.instructions.split('\n').length : 0;
        const ings = m.ingredients.map((x) => `${esc(x.name)} <small>${esc(catName(x.category_id))}</small>`).join(', ');
        const img = images.get(fold(m.name));
        return `
          <li class="import__row">
            <label class="import__item">
              <input type="checkbox" value="${i}" ${dup ? '' : 'checked'}>
              <span class="import__body">
                <strong>${esc(m.name)}</strong>${dup ? ' <span class="pill">Finns redan</span>' : ''}
                ${m.description ? `<span class="muted">${esc(m.description)}</span>` : ''}
                <span class="import__ings">${ings || '<span class="muted">Inga ingredienser</span>'}</span>
                <small class="muted">${steps ? `${steps} steg` : 'Utan tillagning'}</small>
              </span>
            </label>
            <label class="import__img${img ? ' has-image' : ''}" for="import-img-${i}" title="${img ? 'Byt bild' : 'Lägg till bild'}">
              ${img ? `<img src="${img.url}" alt="">` : `${ICON.camera}<small>Bild</small>`}
            </label>
            <input type="file" id="import-img-${i}" accept="image/*" class="sr-only" data-img="${i}">
          </li>`;
      })
      .join('');
    updateSave();
  }

  function read(raw) {
    err.hidden = true;
    if (!raw.trim()) {
      parsed = [];
      return draw();
    }
    try {
      parsed = parseImport(raw, categories);
    } catch (e) {
      parsed = [];
      err.textContent = e.message;
      err.hidden = false;
    }
    draw();
  }

  let timer;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => read(input.value), 250);
  });

  $('#import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    input.value = await file.text();
    read(input.value);
  });

  async function setImage(i, file) {
    if (!file?.type.startsWith('image/') || !parsed[i]) return;
    try {
      const blob = await resizeImage(file, store.mode === 'local' ? 1200 : 1600);
      const key = fold(parsed[i].name);
      if (images.get(key)) URL.revokeObjectURL(images.get(key).url);
      images.set(key, { blob, url: URL.createObjectURL(blob) });
      const box = list.querySelector(`input[type=checkbox][value="${i}"]`);
      if (box) box.checked = true;
      draw();
    } catch {
      toast('Bilden gick inte att läsa. Prova en annan.');
    }
  }

  list.addEventListener('change', (e) => {
    if (e.target.matches('[data-img]')) setImage(+e.target.dataset.img, e.target.files[0]);
    else updateSave();
  });

  // Kopiera en bild i ChatGPT och klistra in här – den hamnar på första rätten utan bild.
  app.addEventListener('paste', (e) => {
    const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'));
    if (!file || !parsed.length) return;
    e.preventDefault();
    const i = parsed.findIndex((m) => !images.has(fold(m.name)));
    setImage(i >= 0 ? i : 0, file);
  });

  $('[data-copy]').addEventListener('click', async (e) => {
    try {
      const ok = await copy(await loadPrompt(categories));
      if (!ok) throw new Error();
      e.target.textContent = 'Kopierad ✓ – klistra in i ChatGPT';
      toast('Instruktionen är kopierad');
    } catch {
      toast('Kunde inte kopiera. Öppna import/chatgpt-instruktion.md i stället.');
    }
  });

  saveBtn.addEventListener('click', async () => {
    const chosen = selected();
    saveBtn.disabled = true;
    let done = 0;
    try {
      for (const meal of chosen) {
        saveBtn.textContent = `Importerar ${done + 1} av ${chosen.length}…`;
        await store.saveMeal(meal, { imageBlob: images.get(fold(meal.name))?.blob });
        done++;
      }
      const missing = chosen.filter((m) => !images.has(fold(m.name))).length;
      toast(
        `${done === 1 ? '1 maträtt importerad' : `${done} maträtter importerade`}${
          missing ? ' – lägg gärna till bilder senare' : ''
        }`
      );
      location.hash = '#/';
    } catch (e) {
      toast(`${done} sparades. Fel: ${e.message}`);
      updateSave();
    }
  });
}
