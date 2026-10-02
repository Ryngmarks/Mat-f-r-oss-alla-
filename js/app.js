import { createStore } from './store.js';
import { resizeImage } from './image.js';
import { esc, toast, confirmDialog, ICON } from './ui.js';
import { openLibrarySheet } from './libraries.js';

const app = document.getElementById('app');
let store;
let categories = [];
let homeScroll = 0;
let user = null;
let libraries = [];
let invites = [];

/* ------------------------------------------------------------------ */
/* Hjälpare                                                            */
/* ------------------------------------------------------------------ */


const categoryOrder = (id) => categories.find((c) => c.id === id)?.sort_order ?? 999;

function sortedIngredients(meal) {
  return meal.ingredients
    .map((ing, i) => ({ ...ing, i }))
    .sort((a, b) => categoryOrder(a.category_id) - categoryOrder(b.category_id) || a.i - b.i);
}

// "Kyckling • Ris • Curry" – de tre första ingredienserna i kategoriordning.
const tagline = (meal) => sortedIngredients(meal).slice(0, 3).map((i) => i.name).join(' • ');

function grouped(ingredients) {
  return categories
    .map((c) => ({ category: c, items: ingredients.filter((i) => i.category_id === c.id) }))
    .filter((g) => g.items.length);
}

const amountText = (i) => [i.amount, i.unit].filter(Boolean).join(' ');

const EMOJI = [
  [/curry|tikka|dal|masala/i, '🍛'],
  [/taco|burrito|quesadilla|nacho/i, '🌮'],
  [/lasagne|pasta|spagetti|spaghetti|carbonara|bolognese|penne/i, '🍝'],
  [/pizza/i, '🍕'],
  [/burgare|hamburgare|burger/i, '🍔'],
  [/sallad/i, '🥗'],
  [/soppa|ramen|nudlar|pho/i, '🍜'],
  [/fisk|lax|torsk|sushi|räk/i, '🐟'],
  [/pannkak|våffl/i, '🥞'],
  [/gryta|chili/i, '🍲'],
];
const emojiFor = (meal) => EMOJI.find(([re]) => re.test(meal.name))?.[1] ?? '🍽️';

function hue(str) {
  let h = 0;
  for (const ch of str) h = (h * 31 + ch.codePointAt(0)) % 997;
  return 8 + (h % 38); // varma toner: tomat → saffran
}

// Bild med en varm färgplatta + emoji bakom, som syns om bild saknas eller inte laddar.
function media(meal, cls = '') {
  const h = hue(meal.name || 'mat');
  return `
    <div class="media ${cls}" style="--h:${h}">
      <span class="media__emoji" aria-hidden="true">${emojiFor(meal)}</span>
      ${meal.image_url ? `<img src="${esc(meal.image_url)}" alt="${esc(meal.name)}" loading="lazy" decoding="async">` : ''}
    </div>`;
}

document.addEventListener(
  'error',
  (e) => {
    if (e.target instanceof HTMLImageElement && e.target.closest('.media')) e.target.remove();
  },
  true
);


/* ------------------------------------------------------------------ */
/* Startsida                                                           */
/* ------------------------------------------------------------------ */

async function renderHome() {
  const meals = await store.listMeals();
  document.title = 'Mat för oss alla';

  const cards = meals
    .map(
      (m, i) => `
      <li class="card" style="--i:${Math.min(i, 8)}">
        <a href="#/maltid/${m.id}" class="card__link">
          ${media(m, 'card__media')}
          <div class="card__text">
            <h2 class="card__name">${esc(m.name)}</h2>
            ${m.ingredients.length ? `<p class="card__tags">${esc(tagline(m))}</p>` : ''}
          </div>
        </a>
      </li>`
    )
    .join('');

  app.innerHTML = `
    <header class="top">
      <div class="wrap top__inner">
        ${
          store.canShare
            ? `<button type="button" class="lib-btn" data-libraries aria-label="Byt eller dela matsedel">
                 <span class="brand">${esc(store.library.name)}</span>${ICON.chevron}
                 ${invites.length ? '<span class="badge" aria-label="Ny inbjudan"></span>' : ''}
               </button>`
            : '<a href="#/" class="brand">Mat för oss alla</a>'
        }
        <a href="#/ny" class="btn btn--primary top__add">+ Lägg till maträtt</a>
      </div>
    </header>
    <main class="wrap home">
      ${
        invites.length
          ? `<button type="button" class="notice" data-libraries>
               <span>📬 <strong>${esc(invites[0].invited_by || 'Någon')}</strong> vill dela ”${esc(invites[0].library_name)}” med dig</span>
               <span class="notice__cta">Visa</span>
             </button>`
          : ''
      }
      <h1 class="home__title">Vad är du sugen på?</h1>
      ${
        store.library.members > 1
          ? `<p class="home__shared">Delad matsedel · ${store.library.members} personer</p>`
          : ''
      }
      ${
        meals.length
          ? `<ul class="grid">${cards}</ul>`
          : `<div class="empty">
               <div class="empty__emoji" aria-hidden="true">🍽️</div>
               <h2>Matsedeln är tom</h2>
               <p>Lägg till din första maträtt – en bild och några ingredienser räcker.</p>
               <a href="#/ny" class="btn btn--primary">+ Lägg till maträtt</a>
             </div>`
      }
    </main>
    ${
      user?.email
        ? `<footer class="wrap foot">Inloggad som ${esc(user.email)} · <button type="button" class="link" data-signout>Logga ut</button></footer>`
        : ''
    }
    <a href="#/ny" class="fab" aria-label="Lägg till maträtt">+ Lägg till maträtt</a>`;

  app.querySelector('[data-signout]')?.addEventListener('click', () => store.signOut());
  app.querySelectorAll('[data-libraries]').forEach((b) =>
    b.addEventListener('click', () =>
      openLibrarySheet({ store, user, state: () => ({ libraries, invites }), reload: loadLibraries, switchTo })
    )
  );
  requestAnimationFrame(() => window.scrollTo(0, homeScroll));
}

/* ------------------------------------------------------------------ */
/* Detaljsida                                                          */
/* ------------------------------------------------------------------ */

async function renderDetail(id) {
  const meal = await store.getMeal(id);
  if (!meal) return renderNotFound();
  document.title = `${meal.name} – Mat för oss alla`;

  const steps = (meal.instructions || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  const groups = grouped(meal.ingredients)
    .map(
      (g) => `
      <div class="group">
        <h3 class="group__name">${esc(g.category.name)}</h3>
        <ul class="group__list">
          ${g.items
            .map(
              (i) => `<li><span>${esc(i.name)}</span>${amountText(i) ? `<span class="amount">${esc(amountText(i))}</span>` : ''}</li>`
            )
            .join('')}
        </ul>
      </div>`
    )
    .join('');

  app.innerHTML = `
    <article class="detail">
      <div class="hero">
        ${media(meal, 'hero__media')}
        <nav class="hero__bar">
          <a href="#/" class="round" aria-label="Tillbaka">${ICON.back}</a>
          <span class="hero__actions">
            <a href="#/redigera/${meal.id}" class="round" aria-label="Redigera">${ICON.edit}</a>
            <button type="button" class="round" data-delete aria-label="Ta bort">${ICON.trash}</button>
          </span>
        </nav>
      </div>

      <div class="wrap narrow detail__body">
        <h1 class="detail__name">${esc(meal.name)}</h1>
        ${meal.description ? `<p class="detail__lead">${esc(meal.description)}</p>` : ''}

        <section class="block">
          <h2 class="block__title">Du behöver</h2>
          ${groups || '<p class="muted">Inga ingredienser tillagda ännu.</p>'}
        </section>

        ${
          steps.length
            ? `<section class="block">
                 <h2 class="block__title">Så lagar du</h2>
                 <ol class="steps">${steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
               </section>`
            : ''
        }
      </div>
    </article>`;

  window.scrollTo(0, 0);

  app.querySelector('[data-delete]').addEventListener('click', async () => {
    if (
      !(await confirmDialog({
        title: 'Ta bort maträtten?',
        text: 'Den försvinner från matsedeln. Det går inte att ångra.',
      }))
    )
      return;
    try {
      await store.deleteMeal(meal.id);
      toast(`${meal.name} är borttagen`);
      location.hash = '#/';
    } catch (e) {
      toast(e.message);
    }
  });
}

function renderNotFound() {
  app.innerHTML = `
    <main class="wrap narrow empty">
      <div class="empty__emoji" aria-hidden="true">🤔</div>
      <h2>Den maträtten hittades inte</h2>
      <a href="#/" class="btn btn--primary">Till alla maträtter</a>
    </main>`;
}

/* ------------------------------------------------------------------ */
/* Skapa / redigera                                                    */
/* ------------------------------------------------------------------ */

const UNITS = ['g', 'kg', 'st', 'dl', 'ml', 'l', 'msk', 'tsk', 'krm', 'burk', 'paket', 'påse', 'klyfta', 'knippe'];

async function renderForm(id) {
  const meal = id ? await store.getMeal(id) : null;
  if (id && !meal) return renderNotFound();
  const known = await store.listIngredientNames().catch(() => []);
  document.title = meal ? `Redigera ${meal.name}` : 'Ny maträtt';

  const draft = {
    ingredients: meal ? meal.ingredients.map((i) => ({ ...i })) : [],
    steps: (meal?.instructions || '').split('\n').filter((s) => s.trim()),
    imageBlob: null,
    removeImage: false,
    previewUrl: meal?.image_url || null,
    category: categories[0]?.id,
  };
  if (!draft.steps.length) draft.steps = [''];

  app.innerHTML = `
    <header class="top top--form">
      <div class="wrap narrow top__inner">
        <a href="${meal ? `#/maltid/${meal.id}` : '#/'}" class="round round--plain" aria-label="Tillbaka">${ICON.back}</a>
        <span class="top__title">${meal ? 'Redigera maträtt' : 'Ny maträtt'}</span>
        <span class="round-spacer"></span>
      </div>
    </header>

    <form class="wrap narrow form" novalidate>
      <section class="field">
        <label class="label" for="name">Vad heter maträtten?</label>
        <input id="name" name="name" class="input input--big" placeholder="t.ex. Kyckling Curry" value="${esc(meal?.name)}" autocomplete="off" required>
      </section>

      <section class="field">
        <span class="label">Bild</span>
        <div class="picker" data-picker>
          <input type="file" id="image" accept="image/*" class="sr-only">
          <label for="image" class="picker__drop" data-drop></label>
          <div class="picker__actions" data-picker-actions></div>
        </div>
      </section>

      <section class="field">
        <label class="label" for="description">Kort beskrivning</label>
        <textarea id="description" class="input" rows="2" placeholder="Vad gör rätten god?">${esc(meal?.description)}</textarea>
      </section>

      <section class="field">
        <span class="label">Du behöver</span>
        <div class="adder">
          <input id="ing-name" class="input" placeholder="Ingrediens, t.ex. Kyckling" list="known-ingredients" autocomplete="off" enterkeyhint="done">
          <datalist id="known-ingredients">${known.map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
          <div class="adder__row">
            <input id="ing-amount" class="input" placeholder="Mängd" inputmode="decimal" autocomplete="off">
            <input id="ing-unit" class="input" placeholder="Enhet" list="units" autocomplete="off">
            <datalist id="units">${UNITS.map((u) => `<option value="${u}">`).join('')}</datalist>
          </div>
          <div class="chips" role="radiogroup" aria-label="Kategori" data-chips></div>
          <button type="button" class="btn btn--soft btn--block" data-add-ing>Lägg till ingrediens</button>
        </div>
        <div data-ing-list></div>
      </section>

      <section class="field">
        <span class="label">Så lagar du <span class="optional">valfritt</span></span>
        <ol class="step-edit" data-steps></ol>
        <button type="button" class="btn btn--ghost" data-add-step>+ Lägg till steg</button>
      </section>

      <div class="form__save">
        <button type="submit" class="btn btn--primary btn--block btn--lg" data-save>${meal ? 'Spara ändringar' : 'Spara maträtt'}</button>
      </div>
    </form>`;

  window.scrollTo(0, 0);
  const $ = (sel) => app.querySelector(sel);
  const form = $('form');
  const ingName = $('#ing-name');
  const ingAmount = $('#ing-amount');
  const ingUnit = $('#ing-unit');

  /* Bild */
  const drop = $('[data-drop]');
  const pickerActions = $('[data-picker-actions]');
  const fileInput = $('#image');

  function drawPicker() {
    drop.classList.toggle('has-image', !!draft.previewUrl);
    drop.innerHTML = draft.previewUrl
      ? `<img src="${esc(draft.previewUrl)}" alt="">`
      : `<span class="picker__hint">${ICON.camera}<strong>Ladda upp bild</strong><small>Ta ett foto eller välj från biblioteket</small></span>`;
    pickerActions.innerHTML = draft.previewUrl
      ? `<label for="image" class="btn btn--ghost">Byt bild</label>
         <button type="button" class="btn btn--ghost" data-remove-image>Ta bort bild</button>`
      : '';
    pickerActions.querySelector('[data-remove-image]')?.addEventListener('click', () => {
      draft.imageBlob = null;
      draft.removeImage = true;
      draft.previewUrl = null;
      fileInput.value = '';
      drawPicker();
    });
  }

  async function useFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    try {
      const blob = await resizeImage(file, store.mode === 'local' ? 1200 : 1800);
      draft.imageBlob = blob;
      draft.removeImage = false;
      if (draft.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(draft.previewUrl);
      draft.previewUrl = URL.createObjectURL(blob);
      drawPicker();
    } catch {
      toast('Bilden gick inte att läsa. Prova en annan.');
    }
  }

  fileInput.addEventListener('change', () => useFile(fileInput.files[0]));
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('is-over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('is-over');
    useFile(e.dataTransfer.files[0]);
  });
  drawPicker();

  /* Kategorier */
  const chips = $('[data-chips]');
  function drawChips() {
    chips.innerHTML = categories
      .map(
        (c) =>
          `<button type="button" role="radio" aria-checked="${c.id === draft.category}" class="chip${
            c.id === draft.category ? ' is-on' : ''
          }" data-cat="${esc(c.id)}">${esc(c.name)}</button>`
      )
      .join('');
  }
  chips.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cat]');
    if (!b) return;
    draft.category = b.dataset.cat;
    drawChips();
  });
  drawChips();

  /* Ingredienser */
  const list = $('[data-ing-list]');
  function drawIngredients() {
    const groups = grouped(draft.ingredients.map((ing, idx) => ({ ...ing, idx })));
    list.innerHTML = groups.length
      ? groups
          .map(
            (g) => `
          <div class="group group--edit">
            <h3 class="group__name">${esc(g.category.name)}</h3>
            <ul class="group__list">
              ${g.items
                .map(
                  (i) => `
                <li>
                  <button type="button" class="ing" data-edit-ing="${i.idx}" title="Ändra">
                    <span>${esc(i.name)}</span>${amountText(i) ? `<span class="amount">${esc(amountText(i))}</span>` : ''}
                  </button>
                  <button type="button" class="ing__remove" data-remove-ing="${i.idx}" aria-label="Ta bort ${esc(i.name)}">${ICON.x}</button>
                </li>`
                )
                .join('')}
            </ul>
          </div>`
          )
          .join('')
      : '<p class="muted hint">Skriv en ingrediens, välj kategori och tryck Lägg till.</p>';
  }

  function addIngredient() {
    const name = ingName.value.trim();
    if (!name) {
      ingName.focus();
      return false;
    }
    draft.ingredients.push({
      name,
      amount: ingAmount.value.trim(),
      unit: ingUnit.value.trim(),
      category_id: draft.category,
    });
    ingName.value = ingAmount.value = ingUnit.value = '';
    drawIngredients();
    ingName.focus();
    return true;
  }

  $('[data-add-ing]').addEventListener('click', addIngredient);
  [ingName, ingAmount, ingUnit].forEach((el) =>
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addIngredient();
      }
    })
  );
  list.addEventListener('click', (e) => {
    const rm = e.target.closest('[data-remove-ing]');
    const ed = e.target.closest('[data-edit-ing]');
    if (rm) {
      draft.ingredients.splice(+rm.dataset.removeIng, 1);
      drawIngredients();
    } else if (ed) {
      const [ing] = draft.ingredients.splice(+ed.dataset.editIng, 1);
      ingName.value = ing.name;
      ingAmount.value = ing.amount || '';
      ingUnit.value = ing.unit || '';
      draft.category = ing.category_id;
      drawChips();
      drawIngredients();
      ingName.focus();
    }
  });
  drawIngredients();

  /* Steg */
  const stepsEl = $('[data-steps]');
  function drawSteps(focusLast = false) {
    stepsEl.innerHTML = draft.steps
      .map(
        (s, i) => `
        <li>
          <textarea class="input" rows="1" data-step="${i}" placeholder="${i === 0 ? 't.ex. Skär kycklingen i bitar' : 'Nästa steg'}">${esc(s)}</textarea>
          <button type="button" class="ing__remove" data-remove-step="${i}" aria-label="Ta bort steg ${i + 1}">${ICON.x}</button>
        </li>`
      )
      .join('');
    stepsEl.querySelectorAll('textarea').forEach(autosize);
    if (focusLast) stepsEl.querySelector('li:last-child textarea')?.focus();
  }
  stepsEl.addEventListener('input', (e) => {
    if (!e.target.matches('[data-step]')) return;
    draft.steps[+e.target.dataset.step] = e.target.value.replace(/\n/g, ' ');
    autosize(e.target);
  });
  stepsEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('[data-step]')) {
      e.preventDefault();
      draft.steps.splice(+e.target.dataset.step + 1, 0, '');
      drawSteps();
      stepsEl.querySelectorAll('textarea')[+e.target.dataset.step + 1]?.focus();
    }
  });
  stepsEl.addEventListener('click', (e) => {
    const rm = e.target.closest('[data-remove-step]');
    if (!rm) return;
    draft.steps.splice(+rm.dataset.removeStep, 1);
    if (!draft.steps.length) draft.steps = [''];
    drawSteps();
  });
  $('[data-add-step]').addEventListener('click', () => {
    draft.steps.push('');
    drawSteps(true);
  });
  drawSteps();

  /* Spara */
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nameEl = $('#name');
    if (!nameEl.value.trim()) {
      nameEl.classList.add('is-invalid');
      nameEl.focus();
      toast('Ge maträtten ett namn först');
      return;
    }
    if (ingName.value.trim()) addIngredient(); // glömd rad i fältet räknas med

    const save = $('[data-save]');
    save.disabled = true;
    save.textContent = 'Sparar…';
    try {
      const savedId = await store.saveMeal(
        {
          id: meal?.id,
          name: nameEl.value,
          description: $('#description').value,
          instructions: draft.steps.map((s) => s.trim()).filter(Boolean).join('\n'),
          ingredients: draft.ingredients,
        },
        { imageBlob: draft.imageBlob, removeImage: draft.removeImage }
      );
      location.hash = `#/maltid/${savedId}`;
    } catch (err) {
      toast(err.message || 'Det gick inte att spara');
      save.disabled = false;
      save.textContent = meal ? 'Spara ändringar' : 'Spara maträtt';
    }
  });
  $('#name').addEventListener('input', (e) => e.target.classList.remove('is-invalid'));
  if (!meal) $('#name').focus();
}

function autosize(el) {
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

/* ------------------------------------------------------------------ */
/* Inloggning                                                          */
/* ------------------------------------------------------------------ */

function renderLogin() {
  document.title = 'Logga in – Mat för oss alla';
  app.innerHTML = `
    <main class="login">
      <div class="login__plates" aria-hidden="true">
        ${['🍛', '🌮', '🍝', '🥗', '🍕', '🍜'].map((e, i) => `<span style="--i:${i}">${e}</span>`).join('')}
      </div>
      <form class="login__card" novalidate>
        <h1 class="login__title">Mat för oss alla</h1>
        <p class="muted login__lead">Logga in för att se familjens maträtter.</p>
        <label class="label" for="email">E-post</label>
        <input id="email" type="email" class="input" autocomplete="username" inputmode="email" required>
        <label class="label" for="password">Lösenord</label>
        <input id="password" type="password" class="input" autocomplete="current-password" required>
        <p class="login__error" role="alert" hidden></p>
        <button type="submit" class="btn btn--primary btn--block btn--lg">Logga in</button>
      </form>
    </main>`;

  const form = app.querySelector('form');
  const err = app.querySelector('.login__error');
  const btn = form.querySelector('button');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = form.email.value;
    const password = form.password.value;
    if (!email.trim() || !password) {
      err.textContent = 'Fyll i e-post och lösenord.';
      err.hidden = false;
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Loggar in…';
    try {
      await store.signIn(email, password);
      await enter();
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
      btn.disabled = false;
      btn.textContent = 'Logga in';
    }
  });
  form.email.focus();
}

/* ------------------------------------------------------------------ */
/* Router                                                              */
/* ------------------------------------------------------------------ */

let lastRoute = '';

async function route() {
  if (!user) return renderLogin();
  const hash = location.hash.replace(/^#/, '') || '/';
  if (lastRoute === '/') homeScroll = window.scrollY;
  lastRoute = hash;

  const [, page, id] = hash.split('/');
  try {
    if (!page) await renderHome();
    else if (page === 'maltid' && id) await renderDetail(id);
    else if (page === 'ny') await renderForm(null);
    else if (page === 'redigera' && id) await renderForm(id);
    else renderNotFound();
  } catch (e) {
    console.error(e);
    app.innerHTML = `<main class="wrap narrow empty"><div class="empty__emoji">😕</div><h2>Något gick fel</h2><p class="muted">${esc(
      e.message
    )}</p><a href="#/" class="btn btn--primary">Försök igen</a></main>`;
  }
}

let listening = false;
const prefKey = () => `mat-for-oss-alla.library.${user?.id}`;

async function loadLibraries() {
  await store.ensureLibrary();
  [libraries, invites] = await Promise.all([store.listLibraries(), store.myInvites()]);
}

// Byter aktiv matsedel. id = null väljer den senast använda (eller första).
async function switchTo(id) {
  if (id === null) await loadLibraries();
  let saved = null;
  try {
    saved = localStorage.getItem(prefKey());
  } catch {}
  store.library = libraries.find((l) => l.id === id) ?? libraries.find((l) => l.id === saved) ?? libraries[0];
  try {
    localStorage.setItem(prefKey(), store.library.id);
  } catch {}
  categories = await store.listCategories();
  homeScroll = 0;
  if (location.hash && location.hash !== '#/') location.hash = '#/';
  else route();
}

// Körs när användaren är inloggad (eller direkt i lokalt läge).
async function enter() {
  user = await store.getUser();
  if (!user) return renderLogin();
  await loadLibraries();
  let saved = null;
  try {
    saved = localStorage.getItem(prefKey());
  } catch {}
  store.library = libraries.find((l) => l.id === saved) ?? libraries[0];
  categories = await store.listCategories();
  if (!listening) {
    window.addEventListener('hashchange', route);
    listening = true;
  }
  route();
}

async function start() {
  try {
    store = await createStore();
    store.onSignedOut(() => {
      user = null;
      homeScroll = 0;
      renderLogin();
    });
    await enter();
  } catch (e) {
    app.innerHTML = `<main class="wrap narrow empty"><div class="empty__emoji">🔌</div><h2>Kunde inte ansluta</h2><p class="muted">${esc(
      e.message
    )}</p></main>`;
  }
}

start();
