// Inköpslista: räknas fram ur veckoplaneringen, slår ihop samma vara, grupperas per kategori
// och delas med alla i matsedeln. Basvaror hamnar under "Har du hemma?".

import { esc, toast, confirmDialog, ICON } from './ui.js';
import { guessCategoryKey } from './import.js';
import { SECTIONS, sectionInfo, guessSection, storeOrder, learnFromCheck } from './sections.js';

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

const MORE =
  '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="5" cy="12" r="1.8" fill="currentColor"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/><circle cx="19" cy="12" r="1.8" fill="currentColor"/></svg>';
const UP =
  '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 15l6-6 6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const DOWN =
  '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const SHARE =
  '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M12 15V4M8 8l4-4 4 4M5 13v6h14v-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export async function renderShopping({ app, store, categories, user, back = '#/' }) {
  stopShopping();
  document.title = 'Inköpslista';
  let data;
  let shops = [];
  let placed = new Map();
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
  // Butiker kräver 04_butiker.sql – utan den fungerar listan ändå, i standardordning.
  let shopsReady = true;
  try {
    shops = await store.listShops();
  } catch {
    shopsReady = false;
  }
  placed = await store.getItemSections().catch(() => new Map());

  const currentShop = () => shops.find((s) => s.id === data.store_id) ?? null;
  const mine = (shop) => shop && (shop.created_by === user?.id || store.mode === 'local');
  const sectionOf = (item) => placed.get(item.name.toLocaleLowerCase('sv')) ?? guessSection(item.name);
  const catOf = (name) => {
    const key = guessCategoryKey(name);
    return categories.find((c) => fold(c.name) === key)?.name ?? categories.find((c) => fold(c.name) === 'ovrigt')?.name ?? 'Övrigt';
  };

  function groupItems(items) {
    const order = storeOrder(currentShop());
    const groups = new Map(order.map((k) => [k, []]));
    for (const i of items) groups.get(sectionOf(i))?.push(i) ?? groups.get('ovrigt').push(i);
    return [...groups.entries()]
      .filter(([, list]) => list.length)
      .map(([k, list]) => [k, list.sort((a, b) => a.checked - b.checked || a.name.localeCompare(b.name, 'sv'))]);
  }

  function shareText(items) {
    const shop = currentShop();
    return [
      `Inköpslista${data.label ? ` – ${data.label}` : ''}${shop ? ` · ${shop.name}` : ''}`,
      ...groupItems(items.filter((i) => !i.pantry && !i.checked)).map(
        ([k, list]) =>
          `\n${sectionInfo(k).name.toLocaleUpperCase('sv')}\n${list.map((i) => `☐ ${i.name}${i.amount ? ` ${i.amount}` : ''}`).join('\n')}`
      ),
    ].join('\n');
  }

  const rowHtml = (i) => `
      <li class="shop-item${i.checked ? ' is-checked' : ''}">
        <label class="shop-item__main">
          <input type="checkbox" data-check="${i.id}" ${i.checked ? 'checked' : ''}>
          <span class="shop-item__text">
            <span class="shop-item__name">${esc(i.name)}${i.amount ? ` <span class="amount">${esc(i.amount)}</span>` : ''}</span>
            ${i.sources ? `<small class="muted">${esc(i.sources)}</small>` : i.manual ? '<small class="muted">Eget</small>' : ''}
          </span>
        </label>
        <button type="button" class="ing__remove" data-more="${i.id}" aria-label="Mer för ${esc(i.name)}">${MORE}</button>
      </li>`;

  function draw() {
    const items = data.items;
    const list = items.filter((i) => !i.pantry);
    const pantry = items.filter((i) => i.pantry);
    const left = list.filter((i) => !i.checked).length;
    const checked = list.filter((i) => i.checked).length;
    const shop = currentShop();

    app.innerHTML = `
      <header class="top top--form">
        <div class="wrap narrow top__inner">
          <a href="${back}" class="round round--plain" aria-label="Tillbaka">${ICON.back}</a>
          <span class="top__title">Inköpslista</span>
          <button type="button" class="round round--plain" data-share aria-label="Dela listan" ${left ? '' : 'disabled'}>${SHARE}</button>
        </div>
      </header>
      <main class="wrap narrow shop">
        <div class="shop__bar">
          ${
            shopsReady
              ? `<button type="button" class="shop-picker" data-shops>
                   <span aria-hidden="true">🏪</span>
                   <span>${shop ? esc(shop.name) : 'Välj butik'}</span>${ICON.chevron}
                 </button>`
              : ''
          }
          <span class="shop__meta muted">${
            items.length
              ? `${data.label ? `${esc(data.label)} · ` : ''}${left ? `<strong>${left} kvar</strong>` : 'Allt är handlat 🎉'}`
              : 'Listan är tom'
          }</span>
        </div>

        <form class="inline shop__add" data-add>
          <input class="input" name="name" placeholder="Lägg till vara, t.ex. diskmedel" autocomplete="off" enterkeyhint="done" required>
          <button class="btn btn--soft">Lägg till</button>
        </form>

        ${
          list.length
            ? groupItems(list)
                .map(
                  ([k, rows]) => `
            <section class="group shop-group">
              <h3 class="group__name">${sectionInfo(k).emoji} ${esc(sectionInfo(k).name)}</h3>
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
      if (!force && (document.activeElement?.closest?.('[data-add]') || sheet?.open)) return;
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

  async function learn(item) {
    const shop = currentShop();
    const res = learnFromCheck(shop, sectionOf(item));
    if (!res || !mine(shop)) return;
    try {
      await store.saveShop({ ...shop, section_order: res.order });
      shop.section_order = res.order;
      toast(`Lärde mig: ${sectionInfo(res.moved).name} kommer efter ${sectionInfo(res.after).name} på ${shop.name}`);
    } catch {}
  }

  function bind() {
    const $ = (s) => app.querySelector(s);
    const byId = (id) => data.items.find((i) => i.id === id);

    app.querySelectorAll('[data-check]').forEach((c) =>
      c.addEventListener('change', () => {
        const item = byId(c.dataset.check);
        item.checked = c.checked; // direkt känsla, sparas i bakgrunden
        c.closest('.shop-item').classList.toggle('is-checked', c.checked);
        if (c.checked) learn(item);
        act(() => store.updateShoppingItem(item.id, { checked: c.checked }));
      })
    );
    app.querySelectorAll('[data-more]').forEach((b) => b.addEventListener('click', () => openItemSheet(byId(b.dataset.more))));
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
    $('[data-shops]')?.addEventListener('click', openShopsSheet);
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

  /* Panel: en vara (flytta avdelning, basvara, ta bort) */

  let sheet;
  function openSheet(html, onBind) {
    if (!sheet) {
      sheet = document.createElement('dialog');
      sheet.className = 'sheet';
      document.body.append(sheet);
      sheet.addEventListener('click', (e) => {
        if (e.target === sheet) sheet.close();
      });
      sheet.addEventListener('close', () => draw());
    }
    sheet.innerHTML = `<div class="sheet__body">${html}</div>`;
    sheet.querySelector('[data-close]')?.addEventListener('click', () => sheet.close());
    onBind(sheet);
    if (!sheet.open) sheet.showModal();
  }

  const head = (title) => `
    <div class="sheet__head">
      <h2 class="sheet__title">${title}</h2>
      <button type="button" class="round round--plain" data-close aria-label="Stäng">${ICON.x}</button>
    </div>`;

  function openItemSheet(item) {
    const current = sectionOf(item);
    openSheet(
      `${head(esc(item.name))}
       <p class="muted sheet__note">Var ligger den i butiken? Valet sparas och gäller i alla butiker.</p>
       <div class="section-grid">
         ${SECTIONS.map(
           (s) => `<button type="button" class="section-btn${s.key === current ? ' is-on' : ''}" data-section="${s.key}">
             <span aria-hidden="true">${s.emoji}</span>${esc(s.name)}</button>`
         ).join('')}
       </div>
       <div class="sheet__actions">
         ${
           item.manual
             ? '<button type="button" class="btn btn--ghost danger-text" data-remove>Ta bort från listan</button>'
             : '<button type="button" class="btn btn--ghost" data-make-pantry>🏠 Har oftast hemma (basvara)</button>'
         }
       </div>`,
      (el) => {
        el.querySelectorAll('[data-section]').forEach((b) =>
          b.addEventListener('click', async () => {
            try {
              await store.setItemSection(item.name, b.dataset.section);
              placed.set(item.name.toLocaleLowerCase('sv'), b.dataset.section);
              sheet.close();
            } catch (e) {
              toast(`Kunde inte spara – har du kört 04_butiker.sql? (${e.message})`);
            }
          })
        );
        el.querySelector('[data-remove]')?.addEventListener('click', () => {
          sheet.close();
          act(() => store.deleteShoppingItems([item.id]));
        });
        el.querySelector('[data-make-pantry]')?.addEventListener('click', () => {
          sheet.close();
          act(async () => {
            await store.setPantry(item.name, true);
            await store.updateShoppingItem(item.id, { pantry: true });
            toast(`${item.name} är nu en basvara`);
          });
        });
      }
    );
  }

  /* Panel: välj butik */

  function openShopsSheet() {
    const shop = currentShop();
    let q = '';
    const listHtml = () => {
      const f = fold(q);
      const rows = shops.filter((s) => !f || fold(s.name).includes(f));
      return rows.length
        ? rows
            .map(
              (s) => `
          <li><button type="button" class="lib${s.id === data.store_id ? ' is-on' : ''}" data-pick-shop="${s.id}">
            <span class="lib__text"><span class="lib__name">${esc(s.name)}</span>
              <small>${mine(s) ? 'Din butik' : 'Upplagd av någon annan'}</small></span>
            ${s.id === data.store_id ? `<span class="lib__check">${ICON.check}</span>` : ''}
          </button></li>`
            )
            .join('')
        : `<li class="muted">${shops.length ? 'Ingen butik matchar.' : 'Inga butiker upplagda än.'}</li>`;
    };
    openSheet(
      `${head('Butik')}
       <p class="muted sheet__note">Listan sorteras i den ordning du går i butiken.</p>
       ${shops.length > 5 ? '<input type="search" class="input picker__search" placeholder="Sök butik" data-shop-search>' : ''}
       <ul class="libs" data-shop-list>${listHtml()}</ul>
       <div class="sheet__actions">
         ${data.store_id ? '<button type="button" class="btn btn--ghost" data-no-shop>Ingen butik</button>' : ''}
         ${shop && mine(shop) ? '<button type="button" class="btn btn--ghost" data-edit-shop>Ändra ordning</button>' : ''}
         ${shop && !mine(shop) ? '<button type="button" class="btn btn--ghost" data-copy-shop>Gör en egen kopia</button>' : ''}
         <button type="button" class="btn btn--primary" data-new-shop>+ Ny butik</button>
       </div>`,
      (el) => {
        const bindList = () =>
          el.querySelectorAll('[data-pick-shop]').forEach((b) =>
            b.addEventListener('click', async () => {
              try {
                await store.setShoppingStore(b.dataset.pickShop);
                data.store_id = b.dataset.pickShop;
                sheet.close();
              } catch (e) {
                toast(e.message);
              }
            })
          );
        bindList();
        el.querySelector('[data-shop-search]')?.addEventListener('input', (e) => {
          q = e.target.value;
          el.querySelector('[data-shop-list]').innerHTML = listHtml();
          bindList();
        });
        el.querySelector('[data-no-shop]')?.addEventListener('click', async () => {
          await store.setShoppingStore(null).catch(() => {});
          data.store_id = null;
          sheet.close();
        });
        el.querySelector('[data-edit-shop]')?.addEventListener('click', () => openShopEditor(shop));
        el.querySelector('[data-copy-shop]')?.addEventListener('click', () =>
          openShopEditor({ name: `${shop.name} (min)`, section_order: storeOrder(shop), hidden: shop.hidden ?? [] })
        );
        el.querySelector('[data-new-shop]').addEventListener('click', () => openShopEditor(null));
      }
    );
  }

  /* Panel: lägg upp eller ändra butik */

  function openShopEditor(shop) {
    let order = storeOrder(shop);
    const hidden = new Set(shop?.hidden ?? []);
    let name = shop?.name ?? '';

    const draw = () =>
      openSheet(
        `${head(shop?.id ? 'Ändra butik' : 'Ny butik')}
         <label class="label" for="shop-name">Namn</label>
         <input id="shop-name" class="input" value="${esc(name)}" placeholder="t.ex. ICA Maxi Luleå" autocomplete="off">
         <p class="muted sheet__note shop-editor__tip">Gå runt i butiken i tankarna från ingången och ordna avdelningarna i den
           ordningen. Dölj det butiken inte har. Ordningen justeras också av sig själv när du bockar av i butiken.</p>
         <ol class="shop-order">
           ${order
             .map(
               (k, i) => `
             <li class="${hidden.has(k) ? 'is-hidden' : ''}">
               <span class="shop-order__num">${i + 1}</span>
               <span class="shop-order__name"><span aria-hidden="true">${sectionInfo(k).emoji}</span> ${esc(sectionInfo(k).name)}</span>
               <button type="button" class="ing__remove" data-up="${i}" aria-label="Flytta upp" ${i ? '' : 'disabled'}>${UP}</button>
               <button type="button" class="ing__remove" data-down="${i}" aria-label="Flytta ned" ${i < order.length - 1 ? '' : 'disabled'}>${DOWN}</button>
               <button type="button" class="link" data-hide="${k}">${hidden.has(k) ? 'Visa' : 'Dölj'}</button>
             </li>`
             )
             .join('')}
         </ol>
         <div class="sheet__actions">
           ${shop?.id ? '<button type="button" class="btn btn--ghost danger-text" data-delete-shop>Ta bort butiken</button>' : ''}
           <button type="button" class="btn btn--primary" data-save-shop>Spara butik</button>
         </div>`,
        (el) => {
          const nameEl = el.querySelector('#shop-name');
          nameEl.addEventListener('input', () => (name = nameEl.value));
          const move = (i, d) => {
            const [k] = order.splice(i, 1);
            order.splice(i + d, 0, k);
            draw();
          };
          el.querySelectorAll('[data-up]').forEach((b) => b.addEventListener('click', () => move(+b.dataset.up, -1)));
          el.querySelectorAll('[data-down]').forEach((b) => b.addEventListener('click', () => move(+b.dataset.down, 1)));
          el.querySelectorAll('[data-hide]').forEach((b) =>
            b.addEventListener('click', () => {
              hidden.has(b.dataset.hide) ? hidden.delete(b.dataset.hide) : hidden.add(b.dataset.hide);
              draw();
            })
          );
          el.querySelector('[data-save-shop]').addEventListener('click', async () => {
            if (!name.trim()) {
              nameEl.focus();
              return toast('Ge butiken ett namn');
            }
            // Dolda avdelningar läggs sist, så att varor där ändå hamnar någonstans.
            const section_order = [...order.filter((k) => !hidden.has(k)), ...order.filter((k) => hidden.has(k))];
            try {
              const id = await store.saveShop({ id: shop?.id, name: name.trim(), section_order, hidden: [...hidden] });
              shops = await store.listShops();
              await store.setShoppingStore(id);
              data.store_id = id;
              toast(`${name.trim()} är sparad`);
              sheet.close();
            } catch (e) {
              toast(`Kunde inte spara – har du kört 04_butiker.sql? (${e.message})`);
            }
          });
          el.querySelector('[data-delete-shop]')?.addEventListener('click', async () => {
            const ok = await confirmDialog({ title: `Ta bort ${shop.name}?`, text: 'Butiken försvinner för alla som använder den.' });
            if (!ok) return;
            try {
              await store.deleteShop(shop.id);
              shops = await store.listShops();
              if (data.store_id === shop.id) data.store_id = null;
              sheet.close();
            } catch (e) {
              toast(e.message);
            }
          });
        }
      );
    draw();
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
    sheet?.remove();
  };
}
