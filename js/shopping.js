// Inköpslista: räknas fram ur veckoplaneringen, slår ihop samma vara, grupperas per kategori
// och delas med alla i matsedeln. Basvaror hamnar under "Har du hemma?".

import { esc, toast, confirmDialog, ICON } from './ui.js';
import { guessCategoryKey } from './import.js';

export const DEFAULT_PANTRY = ['salt', 'peppar', 'svartpeppar', 'vitpeppar', 'vatten', 'olja', 'olivolja', 'rapsolja', 'smör'];

const fold = (s) =>
  String(s ?? '')
    .toLocaleLowerCase('sv')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();

const tidy = (s) => {
  const t = String(s ?? '').trim().replace(/\s+/g, ' ');
  return t ? t[0].toLocaleUpperCase('sv') + t.slice(1) : '';
};

/* Mängder */

const WORDS = { en: 1, ett: 1, två: 2, tva: 2, tre: 3, fyra: 4, fem: 5, sex: 6 };

export function parseQty(text) {
  let t = String(text ?? '').trim().toLocaleLowerCase('sv').replace(',', '.');
  if (!t) return null;
  t = t.replace('½', '.5').replace('¼', '.25').replace('¾', '.75').replace(/^\./, '0.').replace(/(\d)\s+\.(\d)/, '$1.$2');
  if (WORDS[t] !== undefined) return WORDS[t];
  let m = t.match(/^(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)$/); // 1-2 → 2
  if (m) return Number(m[2]);
  m = t.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (m && Number(m[2])) return Number(m[1]) / Number(m[2]);
  m = t.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/); // 1 1/2
  if (m && Number(m[3])) return Number(m[1]) + Number(m[2]) / Number(m[3]);
  return /^\d+(?:\.\d+)?$/.test(t) ? Number(t) : null;
}

// Enhet → [bas, faktor]. Vikt räknas i g, volym i dl, resten var för sig.
const UNITS = {
  g: ['g', 1], gram: ['g', 1], hg: ['g', 100], kg: ['g', 1000],
  ml: ['dl', 0.01], cl: ['dl', 0.1], dl: ['dl', 1], l: ['dl', 10], liter: ['dl', 10],
  st: ['st', 1], styck: ['st', 1], '': ['st', 1],
  msk: ['msk', 1], tsk: ['tsk', 1], krm: ['krm', 1],
  burk: ['burk', 1], burkar: ['burk', 1], paket: ['paket', 1], förp: ['förp', 1],
  påse: ['påse', 1], påsar: ['påse', 1], klyfta: ['klyfta', 1], klyftor: ['klyfta', 1],
  knippe: ['knippe', 1], skiva: ['skiva', 1], skivor: ['skiva', 1], nypa: ['nypa', 1],
};

const num = (n) => n.toLocaleString('sv-SE', { maximumFractionDigits: 2 });

function formatQty(base, n) {
  if (base === 'g') return n >= 1000 ? `${num(n / 1000)} kg` : `${num(n)} g`;
  if (base === 'dl') return n >= 10 ? `${num(n / 10)} l` : n < 1 ? `${num(n * 100)} ml` : `${num(n)} dl`;
  return `${num(n)} ${base}`;
}

/* Bygg listan */

// meals: en post per planerad måltid (samma rätt två gånger = två poster).
export function buildList(meals, categories) {
  const catById = new Map(categories.map((c) => [c.id, c]));
  const catByFold = new Map(categories.map((c) => [fold(c.name), c]));
  const items = new Map();

  for (const meal of meals) {
    for (const ing of meal.ingredients) {
      const key = fold(ing.name);
      if (!key) continue;
      let item = items.get(key);
      if (!item) {
        const catName =
          ing.category_name || catById.get(ing.category_id)?.name || catByFold.get(guessCategoryKey(ing.name))?.name || 'Övrigt';
        item = { name: tidy(ing.name), category: catName, qty: new Map(), texts: [], sources: [] };
        items.set(key, item);
      }
      if (!item.sources.includes(meal.name)) item.sources.push(meal.name);

      const n = parseQty(ing.amount);
      const unit = String(ing.unit ?? '').trim().toLocaleLowerCase('sv').replace(/\.$/, '');
      const known = UNITS[unit];
      if (n !== null && known) {
        const [base, f] = known;
        item.qty.set(base, (item.qty.get(base) || 0) + n * f);
      } else if (n !== null) {
        item.qty.set(unit, (item.qty.get(unit) || 0) + n);
      } else if (ing.amount || ing.unit) {
        item.texts.push([ing.amount, ing.unit].filter(Boolean).join(' '));
      }
    }
  }

  const order = (name) => categories.find((c) => c.name === name)?.sort_order ?? 999;
  return [...items.values()]
    .map((i) => ({
      name: i.name,
      category: i.category,
      amount: [...[...i.qty].map(([u, n]) => formatQty(u, n)), ...new Set(i.texts)].join(' + ') || null,
      sources: i.sources.join(', '),
    }))
    .sort((a, b) => order(a.category) - order(b.category) || a.name.localeCompare(b.name, 'sv'));
}

// "Salt", "Grovt salt" och "salt och peppar" räknas som basvaran salt.
export function isPantry(name, pantryNames) {
  const f = fold(name);
  const words = f.split(/[\s,/&-]+/);
  return pantryNames.some((p) => {
    const q = fold(p);
    return f === q || (!q.includes(' ') && words.includes(q));
  });
}

// Skapar (eller uppdaterar) listan. Avbockningar behålls för varor som redan fanns.
export async function generateShopping(store, categories, mealIds, label) {
  const unique = [...new Set(mealIds)];
  const found = await store.getMealsByIds(unique);
  const byId = new Map(found.map((m) => [m.id, m]));
  const occurrences = mealIds.map((id) => byId.get(id)).filter(Boolean);

  await store.seedPantry(DEFAULT_PANTRY);
  const pantry = (await store.listPantry()).filter((p) => p.active).map((p) => p.name);
  const before = (await store.getShopping()).items.filter((i) => !i.manual);
  const checkedBefore = new Set(before.filter((i) => i.checked).map((i) => fold(i.name)));

  const items = buildList(occurrences, categories).map((i) => ({
    ...i,
    checked: checkedBefore.has(fold(i.name)),
    pantry: isPantry(i.name, pantry),
  }));
  await store.replaceGenerated(items, label);
  return items.length;
}

/* Sidan */

let stopLive = null;
export function stopShopping() {
  stopLive?.();
  stopLive = null;
}

const HOME =
  '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 11l8-6 8 6v8a1 1 0 0 1-1 1h-4v-5h-6v5H5a1 1 0 0 1-1-1z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';
const SHARE =
  '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M12 15V4M8 8l4-4 4 4M5 13v6h14v-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export async function renderShopping({ app, store, categories, back = '#/' }) {
  stopShopping();
  document.title = 'Inköpslista';
  let data;
  try {
    data = await store.getShopping();
  } catch (e) {
    app.innerHTML = `
      <main class="wrap narrow empty">
        <div class="empty__emoji" aria-hidden="true">🛒</div>
        <h2>Inköpslistan är inte påslagen än</h2>
        <p>Kör <strong>supabase/03_inkopslista.sql</strong> i Supabase, så fungerar den.</p>
        <p class="muted">${esc(e.message)}</p>
        <a href="#/" class="btn btn--primary">Till startsidan</a>
      </main>`;
    return;
  }

  const order = (name) => categories.find((c) => c.name === name)?.sort_order ?? 999;
  const catOf = (name) => {
    const key = guessCategoryKey(name);
    return categories.find((c) => fold(c.name) === key)?.name ?? categories.find((c) => fold(c.name) === 'ovrigt')?.name ?? 'Övrigt';
  };

  function shareText(items) {
    const groups = groupItems(items.filter((i) => !i.pantry && !i.checked));
    return [
      `Inköpslista${data.label ? ` – ${data.label}` : ''}`,
      ...groups.map(([cat, list]) => `\n${cat.toLocaleUpperCase('sv')}\n${list.map((i) => `☐ ${i.name}${i.amount ? ` ${i.amount}` : ''}`).join('\n')}`),
    ].join('\n');
  }

  function groupItems(items) {
    const groups = new Map();
    for (const i of items) {
      const c = i.category || 'Övrigt';
      if (!groups.has(c)) groups.set(c, []);
      groups.get(c).push(i);
    }
    return [...groups.entries()]
      .sort((a, b) => order(a[0]) - order(b[0]))
      .map(([c, list]) => [c, list.sort((a, b) => a.checked - b.checked || a.name.localeCompare(b.name, 'sv'))]);
  }

  function rowHtml(i) {
    return `
      <li class="shop-item${i.checked ? ' is-checked' : ''}">
        <label class="shop-item__main">
          <input type="checkbox" data-check="${i.id}" ${i.checked ? 'checked' : ''}>
          <span class="shop-item__text">
            <span class="shop-item__name">${esc(i.name)}${i.amount ? ` <span class="amount">${esc(i.amount)}</span>` : ''}</span>
            ${i.sources ? `<small class="muted">${esc(i.sources)}</small>` : i.manual ? '<small class="muted">Eget</small>' : ''}
          </span>
        </label>
        ${
          i.manual
            ? `<button type="button" class="ing__remove" data-delete="${i.id}" aria-label="Ta bort ${esc(i.name)}">${ICON.x}</button>`
            : `<button type="button" class="ing__remove" data-pantry="${i.id}" title="Har oftast hemma" aria-label="Markera ${esc(i.name)} som basvara">${HOME}</button>`
        }
      </li>`;
  }

  function draw() {
    const items = data.items;
    const list = items.filter((i) => !i.pantry);
    const pantry = items.filter((i) => i.pantry);
    const left = list.filter((i) => !i.checked).length;
    const checked = list.filter((i) => i.checked).length;

    app.innerHTML = `
      <header class="top top--form">
        <div class="wrap narrow top__inner">
          <a href="${back}" class="round round--plain" aria-label="Tillbaka">${ICON.back}</a>
          <span class="top__title">Inköpslista</span>
          <button type="button" class="round round--plain" data-share aria-label="Dela listan" ${left ? '' : 'disabled'}>${SHARE}</button>
        </div>
      </header>
      <main class="wrap narrow shop">
        <p class="shop__meta muted">${
          items.length
            ? `${data.label ? `${esc(data.label)} · ` : ''}${left ? `<strong>${left} kvar</strong>` : 'Allt är handlat 🎉'}`
            : 'Listan är tom'
        }</p>

        <form class="inline shop__add" data-add>
          <input class="input" name="name" placeholder="Lägg till vara, t.ex. diskmedel" autocomplete="off" enterkeyhint="done" required>
          <button class="btn btn--soft">Lägg till</button>
        </form>

        ${
          list.length
            ? groupItems(list)
                .map(
                  ([cat, rows]) => `
            <section class="group shop-group">
              <h3 class="group__name">${esc(cat)}</h3>
              <ul class="shop-list">${rows.map(rowHtml).join('')}</ul>
            </section>`
                )
                .join('')
            : `<div class="empty shop__empty">
                 <div class="empty__emoji" aria-hidden="true">🛒</div>
                 <p>Gör en inköpslista från veckoplaneringen, eller lägg till varor här ovanför.</p>
                 <a href="#/vecka" class="btn btn--primary">Till veckoplaneringen</a>
               </div>`
        }

        ${
          pantry.length
            ? `<section class="block shop-pantry">
                 <h2 class="block__title">Har du hemma?</h2>
                 <p class="muted shop__note">Basvaror som du oftast har hemma. Tryck <strong>Behövs</strong> om de ska med den här gången.</p>
                 <ul class="shop-list">
                   ${pantry
                     .map(
                       (i) => `
                     <li class="shop-item shop-item--pantry">
                       <span class="shop-item__text">
                         <span class="shop-item__name">${esc(i.name)}${i.amount ? ` <span class="amount">${esc(i.amount)}</span>` : ''}</span>
                         ${i.sources ? `<small class="muted">${esc(i.sources)}</small>` : ''}
                       </span>
                       <span class="shop-item__pantry-actions">
                         <button type="button" class="btn btn--soft btn--sm" data-need="${i.id}">Behövs</button>
                         <button type="button" class="link" data-unpantry="${i.id}">Ej basvara</button>
                       </span>
                     </li>`
                     )
                     .join('')}
                 </ul>
               </section>`
            : ''
        }

        ${
          items.length
            ? `<div class="shop__actions">
                 ${checked ? '<button type="button" class="btn btn--ghost" data-clear-checked>Rensa avbockade</button>' : ''}
                 <button type="button" class="btn btn--ghost danger-text" data-clear-all>Töm listan</button>
               </div>`
            : ''
        }
      </main>`;
    bind();
  }

  // force = egen ändring. Uppdateringar från andra väntar medan man skriver en ny vara.
  async function reload(force = false) {
    try {
      data = await store.getShopping();
      if (!force && document.activeElement?.closest?.('[data-add]')) return;
      draw();
    } catch {}
  }

  const act = async (fn) => {
    try {
      await fn();
      await reload(true);
    } catch (e) {
      toast(e.message);
    }
  };

  function bind() {
    const $ = (s) => app.querySelector(s);
    const byId = (id) => data.items.find((i) => i.id === id);

    app.querySelectorAll('[data-check]').forEach((c) =>
      c.addEventListener('change', () => {
        const item = byId(c.dataset.check);
        item.checked = c.checked; // direkt känsla, sparas i bakgrunden
        c.closest('.shop-item').classList.toggle('is-checked', c.checked);
        act(() => store.updateShoppingItem(item.id, { checked: c.checked }));
      })
    );
    app.querySelectorAll('[data-delete]').forEach((b) =>
      b.addEventListener('click', () => act(() => store.deleteShoppingItems([b.dataset.delete])))
    );
    app.querySelectorAll('[data-pantry]').forEach((b) =>
      b.addEventListener('click', () => {
        const item = byId(b.dataset.pantry);
        act(async () => {
          await store.setPantry(item.name, true);
          await store.updateShoppingItem(item.id, { pantry: true });
          toast(`${item.name} är nu en basvara`);
        });
      })
    );
    app.querySelectorAll('[data-need]').forEach((b) =>
      b.addEventListener('click', () => act(() => store.updateShoppingItem(b.dataset.need, { pantry: false })))
    );
    app.querySelectorAll('[data-unpantry]').forEach((b) =>
      b.addEventListener('click', () => {
        const item = byId(b.dataset.unpantry);
        act(async () => {
          await store.setPantry(item.name, false);
          await store.updateShoppingItem(item.id, { pantry: false });
        });
      })
    );
    $('[data-add]').addEventListener('submit', (e) => {
      e.preventDefault();
      const name = tidy(e.target.name.value);
      if (!name) return;
      e.target.name.value = '';
      act(() => store.addShoppingItem({ name, category: catOf(name) })).then(() => app.querySelector('[data-add] input')?.focus());
    });
    $('[data-clear-checked]')?.addEventListener('click', () =>
      act(() => store.deleteShoppingItems(data.items.filter((i) => i.checked && !i.pantry).map((i) => i.id)))
    );
    $('[data-clear-all]')?.addEventListener('click', async () => {
      const ok = await confirmDialog({ title: 'Töm inköpslistan?', text: 'Alla varor tas bort, även dina egna.', ok: 'Töm' });
      if (ok) act(() => store.deleteShoppingItems(data.items.map((i) => i.id)));
    });
    $('[data-share]').addEventListener('click', async () => {
      const text = shareText(data.items);
      try {
        if (navigator.share) await navigator.share({ title: 'Inköpslista', text });
        else {
          await navigator.clipboard.writeText(text);
          toast('Listan är kopierad');
        }
      } catch (e) {
        if (e?.name !== 'AbortError') toast('Kunde inte dela listan');
      }
    });
  }

  draw();
  window.scrollTo(0, 0);

  // Ändringar från andra: realtid, plus en kontroll när appen kommer tillbaka i fokus.
  const unsub = store.subscribeShopping(() => reload());
  const onVisible = () => document.visibilityState === 'visible' && reload();
  document.addEventListener('visibilitychange', onVisible);
  const timer = setInterval(() => document.visibilityState === 'visible' && reload(), 20000);
  stopLive = () => {
    unsub();
    document.removeEventListener('visibilitychange', onVisible);
    clearInterval(timer);
  };
}
