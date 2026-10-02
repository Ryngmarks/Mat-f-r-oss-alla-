// Veckoplanering: måndag–söndag, lunch och middag. Varje ruta pekar på ett recept
// (egen matsedel eller förslagsbanken) eller en fritext. Sparas direkt per matsedel.

import { esc, toast, ICON } from './ui.js';
import { generateShopping } from './shopping.js';

const DAYS = ['Måndag', 'Tisdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lördag', 'Söndag'];
const SLOTS = [
  ['lunch', 'Lunch'],
  ['middag', 'Middag'],
];

/* Datum (lokal tid, YYYY-MM-DD) */

const pad = (n) => String(n).padStart(2, '0');
export const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromISO = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export const mondayOf = (d) => addDays(d, -((d.getDay() + 6) % 7));

function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return { week: Math.ceil(((t - yearStart) / 864e5 + 1) / 7), year: t.getUTCFullYear() };
}

const short = (d) => d.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' }).replace('.', '');
const range = (mon) => {
  const sun = addDays(mon, 6);
  return mon.getMonth() === sun.getMonth()
    ? `${mon.getDate()}–${short(sun)}`
    : `${short(mon)} – ${short(sun)}`;
};

const fold = (s) =>
  String(s ?? '')
    .toLocaleLowerCase('sv')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

const PICK =
  '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 7h16M4 12h10M4 17h7M17 14l3 3-3 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/* ------------------------------------------------------------------ */

export async function renderPlanner({ app, store, mondayIso, categories = [] }) {
  const today = toISO(new Date());
  const monday = mondayIso ? mondayOf(fromISO(mondayIso)) : mondayOf(new Date());
  const days = DAYS.map((name, i) => ({ name, date: addDays(monday, i) })).map((d) => ({ ...d, iso: toISO(d.date) }));
  const from = days[0].iso;
  const to = days[6].iso;
  const { week, year } = isoWeek(monday);
  const thisMonday = toISO(mondayOf(new Date()));
  const isThisWeek = from === thisMonday;
  document.title = `Vecka ${week} – Veckoplanering`;

  const bank = await store.getBank();
  const showBank = bank && bank.id !== store.library.id;
  let entries = [];
  try {
    entries = await store.listPlan(from, to);
  } catch (e) {
    app.innerHTML = `
      <main class="wrap narrow empty">
        <div class="empty__emoji" aria-hidden="true">🗓️</div>
        <h2>Veckoplaneringen är inte påslagen än</h2>
        <p>Kör <strong>supabase/02_forslagsbank_och_veckoplanering.sql</strong> i Supabase, så fungerar den.</p>
        <p class="muted">${esc(e.message)}</p>
        <a href="#/" class="btn btn--primary">Till startsidan</a>
      </main>`;
    return;
  }
  const entryAt = (day, slot) => entries.find((e) => e.day === day && e.slot === slot);

  const slotHtml = (day, slot, label) => {
    const e = entryAt(day, slot);
    if (!e) {
      return `
        <button type="button" class="slot slot--empty" data-pick="${day}|${slot}">
          <span class="slot__label">${label}</span>
          <span class="slot__add">+ Välj</span>
        </button>`;
    }
    const fromBank = e.meal && e.meal.library_id !== store.library.id && e.meal.library_id === bank?.id;
    const name = e.meal?.name ?? e.text ?? '';
    const body = e.meal
      ? `<a href="#/maltid/${e.meal.id}" class="slot__meal">
           <span class="slot__thumb">${
             e.meal.image_url ? `<img src="${esc(e.meal.image_url)}" alt="" loading="lazy">` : '<span aria-hidden="true">🍽️</span>'
           }</span>
           <span class="slot__text"><span class="slot__label">${label}</span><strong>${esc(name)}</strong>${
             fromBank ? '<small class="pill">Förslagsbank</small>' : ''
           }</span>
         </a>`
      : `<div class="slot__meal slot__meal--text">
           <span class="slot__thumb" aria-hidden="true">📝</span>
           <span class="slot__text"><span class="slot__label">${label}</span><strong>${esc(name)}</strong></span>
         </div>`;
    return `
      <div class="slot is-filled">
        ${body}
        <span class="slot__actions">
          <button type="button" class="ing__remove" data-pick="${day}|${slot}" aria-label="Byt">${PICK}</button>
          <button type="button" class="ing__remove" data-clear="${day}|${slot}" aria-label="Ta bort">${ICON.x}</button>
        </span>
      </div>`;
  };

  // Andra veckor med planering.
  let weeksHtml = '';
  try {
    const planned = await store.listPlannedDays();
    const byMonday = new Map();
    for (const d of planned) {
      const m = toISO(mondayOf(fromISO(d)));
      if (m !== from) byMonday.set(m, (byMonday.get(m) || 0) + 1);
    }
    const list = [...byMonday.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 12);
    if (list.length) {
      weeksHtml = `
        <section class="block">
          <h2 class="block__title">Sparade veckor</h2>
          <ul class="weeks">
            ${list
              .map(([m]) => {
                const md = fromISO(m);
                const count = planned.filter((d) => toISO(mondayOf(fromISO(d))) === m).length;
                return `<li><a href="#/vecka/${m}" class="weeks__item">
                  <strong>Vecka ${isoWeek(md).week}</strong>
                  <span class="muted">${range(md)} ${isoWeek(md).year !== year ? isoWeek(md).year : ''}</span>
                  <small class="muted">${count} ${count === 1 ? 'dag' : 'dagar'}</small>
                </a></li>`;
              })
              .join('')}
          </ul>
        </section>`;
    }
  } catch {}

  app.innerHTML = `
    <header class="top top--form">
      <div class="wrap narrow top__inner">
        <a href="#/" class="round round--plain" aria-label="Tillbaka">${ICON.back}</a>
        <span class="top__title">Veckoplanering</span>
        <span class="round-spacer"></span>
      </div>
    </header>

    <main class="wrap narrow planner">
      <div class="week-nav">
        <a href="#/vecka/${toISO(addDays(monday, -7))}" class="round round--plain" aria-label="Förra veckan">${ICON.back}</a>
        <div class="week-nav__title">
          <h1>Vecka ${week}</h1>
          <span class="muted">${range(monday)} ${year}${isThisWeek ? ' · denna vecka' : ''}</span>
        </div>
        <a href="#/vecka/${toISO(addDays(monday, 7))}" class="round round--plain week-nav__next" aria-label="Nästa vecka">${ICON.back}</a>
      </div>
      ${isThisWeek ? '' : `<p class="week-nav__today"><a href="#/vecka" class="link">Till denna vecka</a></p>`}

      <div class="days">
        ${days
          .map(
            (d) => `
          <section class="day${d.iso === today ? ' is-today' : ''}">
            <h2 class="day__name">${d.name} <small>${short(d.date)}${d.iso === today ? ' · idag' : ''}</small></h2>
            <div class="day__slots">
              ${SLOTS.map(([slot, label]) => slotHtml(d.iso, slot, label)).join('')}
            </div>
          </section>`
          )
          .join('')}
      </div>

      <div class="planner__actions">
        <button type="button" class="btn btn--primary" data-shop>🛒 Gör inköpslista</button>
        <button type="button" class="btn btn--ghost" data-copy-prev>Kopiera förra veckan</button>
      </div>

      ${weeksHtml}
    </main>`;

  window.scrollTo(0, 0);

  const redraw = () => renderPlanner({ app, store, mondayIso: from, categories });

  app.querySelector('[data-shop]').addEventListener('click', () =>
    openShoppingSheet({ store, categories, days, entries, label: `Vecka ${week}` })
  );

  app.querySelectorAll('[data-clear]').forEach((b) =>
    b.addEventListener('click', async () => {
      const [day, slot] = b.dataset.clear.split('|');
      try {
        await store.clearPlan(day, slot);
        redraw();
      } catch (e) {
        toast(e.message);
      }
    })
  );

  app.querySelectorAll('[data-pick]').forEach((b) =>
    b.addEventListener('click', () => {
      const [day, slot] = b.dataset.pick.split('|');
      const d = days.find((x) => x.iso === day);
      const label = SLOTS.find((s) => s[0] === slot)[1];
      openPicker({
        store,
        bank: showBank ? bank : null,
        title: `${label} · ${d.name.toLocaleLowerCase('sv')} ${short(d.date)}`,
        onPick: async (entry) => {
          await store.setPlan(day, slot, entry);
          redraw();
        },
      });
    })
  );

  app.querySelector('[data-copy-prev]').addEventListener('click', async () => {
    try {
      const prevFrom = toISO(addDays(monday, -7));
      const prev = await store.listPlan(prevFrom, toISO(addDays(monday, -1)));
      const fill = prev
        .map((e) => ({ day: toISO(addDays(fromISO(e.day), 7)), slot: e.slot, meal_id: e.meal?.id ?? null, text: e.text ?? e.meal?.name ?? null }))
        .filter((e) => !entryAt(e.day, e.slot));
      if (!prev.length) return toast('Förra veckan är tom');
      if (!fill.length) return toast('Alla rutor är redan ifyllda');
      await store.setPlanMany(fill);
      toast(`${fill.length} ${fill.length === 1 ? 'måltid' : 'måltider'} kopierade – bara tomma rutor fylldes i`);
      redraw();
    } catch (e) {
      toast(e.message);
    }
  });
}

/* ------------------------------------------------------------------ */
/* Väljaren                                                            */
/* ------------------------------------------------------------------ */

let dlg;

async function openPicker({ store, bank, title, onPick }) {
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.className = 'sheet picker-sheet';
    document.body.append(dlg);
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg) dlg.close();
    });
  }

  const lists = { own: null, bank: null };
  let source = 'own';
  let query = '';

  dlg.innerHTML = `
    <div class="sheet__body">
      <div class="sheet__head">
        <h2 class="sheet__title picker__title">${esc(title)}</h2>
        <button type="button" class="round round--plain" data-close aria-label="Stäng">${ICON.x}</button>
      </div>
      ${
        bank
          ? `<div class="segmented" role="tablist">
               <button type="button" role="tab" class="is-on" data-source="own" aria-selected="true">Egen matsedel</button>
               <button type="button" role="tab" data-source="bank" aria-selected="false">Förslagsbank</button>
             </div>`
          : ''
      }
      <input type="search" class="input picker__search" placeholder="Sök rätt eller ingrediens" autocomplete="off" enterkeyhint="search">
      <ul class="picker__grid" data-grid><li class="muted">Laddar…</li></ul>
      <p class="picker__or muted">eller skriv något eget</p>
      <form class="inline" data-free>
        <input class="input" name="text" placeholder="t.ex. Rester, Ute och äter" autocomplete="off" required>
        <button class="btn btn--soft">Lägg till</button>
      </form>
    </div>`;
  if (!dlg.open) dlg.showModal();

  const grid = dlg.querySelector('[data-grid]');
  const search = dlg.querySelector('.picker__search');

  async function draw() {
    try {
      lists[source] ??= source === 'bank' ? await store.listBankMeals() : await store.listMeals();
    } catch (e) {
      grid.innerHTML = `<li class="muted">${esc(e.message)}</li>`;
      return;
    }
    const q = fold(query.trim());
    const meals = lists[source].filter(
      (m) => !q || fold(m.name).includes(q) || m.ingredients.some((i) => fold(i.name).includes(q))
    );
    grid.innerHTML = meals.length
      ? meals
          .map(
            (m) => `
        <li>
          <button type="button" class="pick" data-meal="${m.id}">
            <span class="pick__img">${
              m.image_url ? `<img src="${esc(m.image_url)}" alt="" loading="lazy">` : '<span aria-hidden="true">🍽️</span>'
            }</span>
            <span class="pick__name">${esc(m.name)}</span>
          </button>
        </li>`
          )
          .join('')
      : `<li class="muted picker__empty">${
          q ? 'Inget matchar sökningen.' : source === 'bank' ? 'Förslagsbanken är tom.' : 'Inga rätter i matsedeln än.'
        }</li>`;
  }

  dlg.querySelector('[data-close]').addEventListener('click', () => dlg.close());
  dlg.querySelectorAll('[data-source]').forEach((b) =>
    b.addEventListener('click', () => {
      source = b.dataset.source;
      dlg.querySelectorAll('[data-source]').forEach((x) => {
        x.classList.toggle('is-on', x === b);
        x.setAttribute('aria-selected', String(x === b));
      });
      draw();
    })
  );
  search.addEventListener('input', () => {
    query = search.value;
    draw();
  });
  grid.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-meal]');
    if (!b) return;
    const meal = lists[source].find((m) => m.id === b.dataset.meal);
    b.disabled = true;
    try {
      await onPick({ meal_id: meal.id, text: meal.name });
      dlg.close();
    } catch (err) {
      toast(err.message);
      b.disabled = false;
    }
  });
  dlg.querySelector('[data-free]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = e.target.text.value.trim();
    if (!text) return;
    try {
      await onPick({ meal_id: null, text });
      dlg.close();
    } catch (err) {
      toast(err.message);
    }
  });

  draw();
}

/* ------------------------------------------------------------------ */
/* Inköpslista från veckan                                             */
/* ------------------------------------------------------------------ */

let shopDlg;

async function openShoppingSheet({ store, categories, days, entries, label }) {
  const withMeal = entries.filter((e) => e.meal);
  if (!withMeal.length) return toast('Lägg in några rätter i veckan först');

  if (!shopDlg) {
    shopDlg = document.createElement('dialog');
    shopDlg.className = 'sheet';
    document.body.append(shopDlg);
    shopDlg.addEventListener('click', (e) => {
      if (e.target === shopDlg) shopDlg.close();
    });
  }

  let existing = null;
  try {
    existing = await store.getShopping();
  } catch (e) {
    return toast(`Inköpslistan är inte påslagen än – kör supabase/03_inkopslista.sql. (${e.message})`);
  }
  const selected = new Set(days.filter((d) => withMeal.some((e) => e.day === d.iso)).map((d) => d.iso));
  const generated = existing.items.filter((i) => !i.manual).length;
  const own = existing.items.filter((i) => i.manual).length;

  const draw = () => {
    const meals = withMeal.filter((e) => selected.has(e.day));
    shopDlg.innerHTML = `
      <div class="sheet__body">
        <div class="sheet__head">
          <h2 class="sheet__title">Inköpslista</h2>
          <button type="button" class="round round--plain" data-close aria-label="Stäng">${ICON.x}</button>
        </div>
        <p class="muted sheet__note">Välj vilka dagar som ska handlas för. Samma vara från flera rätter slås ihop.</p>
        <div class="day-chips">
          ${days
            .map((d) => {
              const n = withMeal.filter((e) => e.day === d.iso).length;
              return `<button type="button" class="chip${selected.has(d.iso) ? ' is-on' : ''}" data-day="${d.iso}" ${n ? '' : 'disabled'}>
                ${d.name.slice(0, 3)}${n ? ` <small>${n}</small>` : ''}
              </button>`;
            })
            .join('')}
        </div>
        ${
          generated
            ? `<p class="muted sheet__note">Ersätter förra listan${existing.label ? ` (${esc(existing.label)})` : ''}.${
                own ? (own === 1 ? ' Din egna vara ligger kvar.' : ` Dina ${own} egna varor ligger kvar.`) : ''
              } Det du redan bockat av förblir avbockat.</p>`
            : ''
        }
        <button type="button" class="btn btn--primary btn--block btn--lg" data-make ${meals.length ? '' : 'disabled'}>
          Skapa lista från ${meals.length} ${meals.length === 1 ? 'måltid' : 'måltider'}
        </button>
      </div>`;
    shopDlg.querySelector('[data-close]').addEventListener('click', () => shopDlg.close());
    shopDlg.querySelectorAll('[data-day]').forEach((b) =>
      b.addEventListener('click', () => {
        selected.has(b.dataset.day) ? selected.delete(b.dataset.day) : selected.add(b.dataset.day);
        draw();
      })
    );
    shopDlg.querySelector('[data-make]').addEventListener('click', async (e) => {
      e.target.disabled = true;
      e.target.textContent = 'Räknar ihop…';
      try {
        const chosenDays = days.filter((d) => selected.has(d.iso));
        const all = chosenDays.length === 7 || chosenDays.length === days.filter((d) => withMeal.some((x) => x.day === d.iso)).length;
        const name = all ? label : `${label} · ${chosenDays.map((d) => d.name.slice(0, 3).toLocaleLowerCase('sv')).join(', ')}`;
        const n = await generateShopping(store, categories, meals.map((m) => m.meal.id), name);
        shopDlg.close();
        toast(`${n} varor i listan`);
        location.hash = '#/handla';
      } catch (err) {
        toast(err.message);
        draw();
      }
    });
  };

  draw();
  if (!shopDlg.open) shopDlg.showModal();
}
