// Import av maträtter, t.ex. från ChatGPT. Formatet beskrivs i import/chatgpt-instruktion.md.
// Läsningen är förlåtande: JSON (även med kodblock och svenska fältnamn) läses i första hand,
// annars vanlig text med namn, "Ingredienser:" och "Gör så här:". Saknas kategori gissas den
// utifrån ingrediensens namn.

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
  sas: 'sas', saser: 'sas', dressing: 'sas', saser_och_dressing: 'sas',
  ovrigt: 'ovrigt', annat: 'ovrigt', kryddor: 'ovrigt', krydda: 'ovrigt', tillbehor: 'ovrigt',
};

// Gissar kategori från ingrediensens namn när ingen kategori anges.
const GUESS = [
  ['sas', /sås|dressing|salsa|ketchup|majonn|aioli|pesto|buljong|fond|grädd|crème|creme|kokosmjölk|krossade tomater|passerade tomater|tomatpuré|sambal|soja|chutney|tzatziki|guacamole/],
  ['protein', /kött|färs|kyckling|fläsk|bacon|korv|skinka|kalkon|biff|entrecote|oxfilé|lamm|hamburgare|burgare|fisk|lax|torsk|sej|tonfisk|räk|musslor|ägg|tofu|halloumi|quorn|bönor|linser|kikärt/],
  ['kolhydrater', /ris|pasta|spagetti|spaghetti|makaron|penne|tagliatelle|lasagneplatt|nudlar|bröd|tortilla|pita|wrap|potatis|pommes|couscous|bulgur|quinoa|gnocchi|mjöl(?!k)|polenta|tacoskal|naan/],
  ['gronsaker', /sallad|tomat|lök|gurka|paprika|morot|broccoli|blomkål|spenat|vitlök|svamp|champinjon|majs|ärtor|avokado|zucchini|squash|kål|selleri|aubergine|rädis|ruccola|chili|ingefära|bladpersilja|koriander|purjo|sparris|bönor gröna|haricots/],
];

function categoryResolver(categories) {
  const byName = new Map(categories.map((c) => [fold(c.name), c.id]));
  const fallback = byName.get('ovrigt') ?? categories.at(-1)?.id;
  const fromLabel = (label) => {
    const f = fold(label).replace(/\s+/g, '_');
    return byName.get(f) ?? byName.get(ALIASES[f]) ?? null;
  };
  const guess = (name) => {
    const n = String(name).toLocaleLowerCase('sv');
    const hit = GUESS.find(([, re]) => re.test(n));
    return (hit && byName.get(hit[0])) ?? fallback;
  };
  return { fromLabel, guess, resolve: (label, name) => (label && fromLabel(label)) || guess(name) };
}

const UNIT = '(g|gram|kg|hg|st|styck|dl|cl|ml|l|liter|msk|tsk|krm|burk|burkar|paket|förp|påse|påsar|klyfta|klyftor|knippe|skivor|skiva|nypa)';
const NUM = '(\\d+(?:[.,]\\d+)?(?:\\s*[-–]\\s*\\d+)?|½|¼|¾|\\d+\\/\\d+|en|ett|två|tre|fyra|fem)';

// "500 g köttfärs", "Köttfärs – 500 g", "Köttfärs (500 g)", "Köttfärs: 500 g", "Köttfärs".
function parseIngredientLine(line) {
  let m = line.match(new RegExp(`^${NUM}\\s*${UNIT}?\\.?\\s+(.+)$`, 'i'));
  if (m) return { amount: m[1], unit: m[2] || '', name: m[3] };
  m = line.match(new RegExp(`^(.+?)\\s*[(:–-]\\s*${NUM}\\s*${UNIT}?\\)?\\.?$`, 'i'));
  if (m) return { name: m[1], amount: m[2], unit: m[3] || '' };
  m = line.match(new RegExp(`^(.+?)\\s+(\\d+(?:[.,]\\d+)?|½|¼|¾)\\s*${UNIT}\\.?$`, 'i'));
  if (m) return { name: m[1], amount: m[2], unit: m[3] };
  return { name: line, amount: '', unit: '' };
}

const cleanLine = (l) =>
  l
    .replace(/\*\*|__|`/g, '')
    .replace(/^#+\s*/, '')
    .trim();
const BULLET = /^\s*(?:[-•*–·]|\d+[.)])\s+/;
const SECTION = {
  ingredients: /^(ingredienser|du behöver|det här behöver du|handla)\b/i,
  steps: /^(gör så här|så lagar du|så gör du|tillagning|instruktioner|steg för steg|steg|gör så)\b/i,
  description: /^(beskrivning)\b/i,
};
const sectionOf = (l) => Object.keys(SECTION).find((k) => SECTION[k].test(l.replace(/:.*$/, '').trim()));

function tidyMealName(l) {
  const n = cleanLine(l)
    .replace(/^(då har vi|här är|maträtt|namn|rätt)\s*:?\s*/i, '')
    .replace(/[.:!]+$/, '')
    .trim();
  return n ? n[0].toLocaleUpperCase('sv') + n.slice(1) : '';
}

// Inledande pratfraser från ChatGPT som inte är ett namn.
const CHATTER = /^(här (kommer|är)|absolut|självklart|toppen|perfekt|okej|ok|bra|smaklig)\b|[!?:]$/i;

// Läser vanlig text: ett namn, sedan "Ingredienser:" med punkter och ev. "Gör så här:" med steg.
function parseText(raw, cats) {
  const rawLines = raw.split(/\r?\n/);
  const lines = rawLines.map(cleanLine);
  const isTitle = (i) => /^\s*(#+\s|\*\*[^*]+\*\*:?\s*$)/.test(rawLines[i]) && !sectionOf(lines[i]);
  const isCandidate = (i) => lines[i] && !BULLET.test(lines[i]) && !sectionOf(lines[i]);
  const headers = lines.map((l, i) => (sectionOf(l) === 'ingredients' ? i : -1)).filter((i) => i >= 0);
  if (!headers.length) return [];

  // Hitta namnraden för varje rätt.
  const names = headers.map((h, hi) => {
    const prev = hi ? headers[hi - 1] : -1;
    for (let i = h - 1; i > prev; i--) if (isTitle(i)) return i; // markdown-rubrik vinner
    let floor = prev;
    for (let i = h - 1; i > prev; i--) {
      if (!isCandidate(i) && lines[i]) {
        floor = i;
        break;
      }
    }
    for (let i = floor + 1; i < h; i++) if (isCandidate(i) && (!CHATTER.test(lines[i]) || isTitle(i))) return i;
    return -1;
  });

  return headers
    .map((h, hi) => {
      const nameAt = names[hi];
      const end = hi + 1 < headers.length ? (names[hi + 1] >= 0 ? names[hi + 1] : headers[hi + 1]) : lines.length;
      const meal = { name: nameAt >= 0 ? tidyMealName(lines[nameAt]) : '', description: '', ingredients: [], steps: [] };
      if (nameAt >= 0) meal.description = lines.slice(nameAt + 1, h).filter((l, k) => l && isCandidate(nameAt + 1 + k)).join(' ');

      let mode = 'ingredients';
      let catLabel = null;
      for (let i = h; i < end; i++) {
        const l = lines[i];
        if (!l) continue;
        const sec = sectionOf(l);
        if (sec) {
          mode = sec;
          const rest = l.split(':').slice(1).join(':').trim();
          if (rest && mode === 'description') meal.description = rest;
          continue;
        }
        const item = l.replace(BULLET, '').trim();
        if (mode === 'ingredients') {
          // "Protein:" som underrubrik sätter kategori för punkterna under.
          if (!BULLET.test(l) && /:$/.test(l) && cats.fromLabel(l.slice(0, -1))) {
            catLabel = l.slice(0, -1);
            continue;
          }
          if (!BULLET.test(l) && (CHATTER.test(l) || l.split(' ').length > 6)) continue; // löptext
          const ing = parseIngredientLine(item);
          meal.ingredients.push({ ...ing, category_id: cats.resolve(catLabel, ing.name) });
        } else if (mode === 'steps') {
          if (!BULLET.test(l) && CHATTER.test(l)) continue;
          meal.steps.push(item);
        } else if (mode === 'description') {
          meal.description = [meal.description, item].filter(Boolean).join(' ');
        }
      }
      return meal;
    })
    .map((m) => ({
      name: m.name,
      description: m.description,
      instructions: m.steps.join('\n'),
      ingredients: m.ingredients.map((i) => ({ ...i, name: tidyMealName(i.name) })).filter((i) => i.name),
    }));
}

function parseJson(raw, cats) {
  const start = raw.search(/[[{]/);
  const end = Math.max(raw.lastIndexOf('}'), raw.lastIndexOf(']'));
  if (start < 0 || end < start) return null;
  let data;
  try {
    data = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }

  const list = Array.isArray(data)
    ? data
    : Array.isArray(pick(data, 'meals', 'maträtter', 'matratter'))
      ? pick(data, 'meals', 'maträtter', 'matratter')
      : [data];

  return list
    .filter((m) => m && typeof m === 'object')
    .map((m) => {
      const rawSteps = pick(m, 'instructions', 'instruktioner', 'steps', 'steg') ?? [];
      const steps = (Array.isArray(rawSteps) ? rawSteps : String(rawSteps).split('\n'))
        .map((s) => text(typeof s === 'object' ? pick(s, 'text', 'step', 'steg') : s).replace(/^\d+[.)]\s*/, ''))
        .filter(Boolean);

      const rawIngs = pick(m, 'ingredients', 'ingredienser') ?? [];
      const ingredients = (Array.isArray(rawIngs) ? rawIngs : [])
        .map((i) => {
          if (typeof i === 'string') {
            const ing = parseIngredientLine(text(i));
            return { ...ing, category_id: cats.guess(ing.name) };
          }
          const name = text(pick(i, 'name', 'namn'));
          return {
            name,
            category_id: cats.resolve(pick(i, 'category', 'kategori'), name),
            amount: text(pick(i, 'amount', 'mängd', 'mangd')),
            unit: text(pick(i, 'unit', 'enhet')),
          };
        })
        .filter((i) => i.name);

      return {
        name: text(pick(m, 'name', 'namn')),
        description: text(pick(m, 'description', 'beskrivning')),
        instructions: steps.join('\n'),
        ingredients,
      };
    });
}

export function parseImport(raw, categories) {
  const t = String(raw || '');
  const cats = categoryResolver(categories);
  const fromJson = parseJson(t, cats);
  const meals = (fromJson?.some((m) => m.name) ? fromJson : parseText(t, cats)).filter((m) => m.name);
  if (!meals.length) {
    throw new Error(
      'Hittade inga maträtter. Klistra in hela svaret från ChatGPT – antingen JSON-koden eller en text med namn och "Ingredienser:".'
    );
  }
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
          så svarar ChatGPT med en fil i rätt format. Skriv sedan <strong>”bild”</strong> så skapas
          en bild till varje rätt. Det går också bra att klistra in en vanlig text med namn och
          ingredienser.
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
        <p class="muted import__help">Spara bilderna från ChatGPT och välj alla på en gång – de kopplas till rätterna i samma ordning som du sparade dem. Stämmer något inte trycker du på bilden vid rätten och byter. På datorn kan du också kopiera en bild och klistra in den här.</p>
        <label class="btn btn--soft import__all" for="import-imgs">Välj alla bilder på en gång</label>
        <input type="file" id="import-imgs" accept="image/*" multiple class="sr-only">
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

  async function setImage(i, file, redraw = true) {
    if (!file?.type.startsWith('image/') || !parsed[i]) return;
    try {
      const blob = await resizeImage(file, store.mode === 'local' ? 1200 : 1600);
      const key = fold(parsed[i].name);
      if (images.get(key)) URL.revokeObjectURL(images.get(key).url);
      images.set(key, { blob, url: URL.createObjectURL(blob) });
      const box = list.querySelector(`input[type=checkbox][value="${i}"]`);
      if (box) box.checked = true;
      if (redraw) draw();
    } catch {
      toast('Bilden gick inte att läsa. Prova en annan.');
    }
  }

  // Flera bilder på en gång: filnamn som innehåller rättens namn kopplas dit, resten
  // fördelas i den ordning de sparades (äldst först) på rätterna som saknar bild.
  async function assignFiles(fileList) {
    const files = [...fileList].filter((f) => f.type.startsWith('image/'));
    if (!files.length || !parsed.length) return;
    const taken = new Set();
    const plan = [];
    const rest = [];
    for (const f of files) {
      const fname = fold(f.name.replace(/\.[^.]+$/, '')).replace(/[_\-.]+/g, ' ');
      const i = parsed.findIndex((m, k) => !taken.has(k) && fname.includes(fold(m.name)));
      if (i >= 0) {
        taken.add(i);
        plan.push([i, f]);
      } else rest.push(f);
    }
    rest.sort((a, b) => a.lastModified - b.lastModified);
    const free = parsed.map((_, k) => k).filter((k) => !taken.has(k) && !images.has(fold(parsed[k].name)));
    rest.forEach((f, n) => {
      if (free[n] !== undefined) plan.push([free[n], f]);
    });

    saveBtn.disabled = true;
    saveBtn.textContent = 'Förbereder bilder…';
    for (const [i, f] of plan) await setImage(i, f, false);
    draw();
    const extra = files.length - plan.length;
    toast(
      `${plan.length === 1 ? '1 bild kopplad' : `${plan.length} bilder kopplade`}${
        extra > 0 ? ` – ${extra} blev över` : ''
      }. Kontrollera att de hamnat rätt.`
    );
  }

  $('#import-imgs').addEventListener('change', (e) => {
    assignFiles(e.target.files);
    e.target.value = '';
  });

  list.addEventListener('change', (e) => {
    if (e.target.matches('[data-img]')) setImage(+e.target.dataset.img, e.target.files[0]);
    else updateSave();
  });

  // Kopiera en bild i ChatGPT och klistra in här – den hamnar på första rätten utan bild.
  app.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
    if (!files.length || !parsed.length) return;
    e.preventDefault();
    if (files.length > 1) return assignFiles(files);
    const i = parsed.findIndex((m) => !images.has(fold(m.name)));
    setImage(i >= 0 ? i : 0, files[0]);
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
