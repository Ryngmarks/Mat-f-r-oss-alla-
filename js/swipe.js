// "Swipa fram middagen": en rätt i taget, höger = ja, vänster = nej.
// Klar (eller slut på rätter) visar listan med det man sagt ja till.
// Läget sparas i sessionStorage så att man kan öppna ett recept och komma tillbaka.

import { esc, ICON } from './ui.js';

const HEART =
  '<svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" fill="currentColor"/></svg>';
const CROSS =
  '<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>';
const UNDO =
  '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

let keyHandler = null;

const key = (store) => `mat-for-oss-alla.swipe.${store.library?.id ?? 'local'}`;

function loadState(store, meals) {
  let s = null;
  try {
    s = JSON.parse(sessionStorage.getItem(key(store)));
  } catch {}
  const ids = new Set(meals.map((m) => m.id));
  if (!s || !Array.isArray(s.order)) return null;
  // Rätter kan ha tagits bort eller lagts till sedan sist.
  s.order = s.order.filter((id) => ids.has(id));
  s.history = (s.history || []).filter((h) => ids.has(h.id));
  const seen = new Set(s.order);
  s.order.push(...shuffle(meals.filter((m) => !seen.has(m.id)).map((m) => m.id)));
  return s;
}

function saveState(store, s) {
  try {
    sessionStorage.setItem(key(store), JSON.stringify(s));
  } catch {}
}

const newState = (meals) => ({ order: shuffle(meals.map((m) => m.id)), history: [], done: false });

export async function renderSwipe({ app, store, media, tagline, showResult = false }) {
  document.title = 'Swipa fram middagen';
  const meals = await store.listMeals();
  const byId = new Map(meals.map((m) => [m.id, m]));
  let state = loadState(store, meals) ?? newState(meals);
  if (showResult) state.done = true;
  // Om allt redan är swipat från början: visa resultatet.
  if (state.history.length >= state.order.length && state.order.length) state.done = true;
  saveState(store, state);

  const header = (title, back = '#/') => `
    <header class="top top--form">
      <div class="wrap narrow top__inner">
        <a href="${back}" class="round round--plain" aria-label="Tillbaka">${ICON.back}</a>
        <span class="top__title">${title}</span>
        <span class="round-spacer"></span>
      </div>
    </header>`;

  if (!meals.length) {
    app.innerHTML = `${header('Swipa fram middagen')}
      <main class="wrap narrow empty">
        <div class="empty__emoji" aria-hidden="true">🍽️</div>
        <h2>Inga maträtter än</h2>
        <p>Lägg till några rätter först, så kan du swipa bland dem.</p>
        <a href="#/ny" class="btn btn--primary">+ Lägg till maträtt</a>
      </main>`;
    return;
  }

  const yesMeals = () => state.history.filter((h) => h.yes).map((h) => byId.get(h.id)).filter(Boolean);

  function restart() {
    state = newState(meals);
    saveState(store, state);
    drawDeck();
  }

  /* Resultat */
  function drawResult() {
    document.title = 'Det här är du sugen på';
    const yes = yesMeals();
    app.innerHTML = `${header('Ditt urval')}
      <main class="wrap home swipe-result">
        <h1 class="home__title">${yes.length ? 'Det här är du sugen på' : 'Inget lockade den här gången'}</h1>
        <p class="home__shared">${
          yes.length
            ? `${yes.length} av ${state.history.length} rätter fick ja. Tryck på en rätt för att se vad som behövs.`
            : 'Swipa igen – kanske blir det en ny favorit.'
        }</p>
        ${
          yes.length
            ? `<ul class="grid">${yes
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
                .join('')}</ul>`
            : ''
        }
        <div class="swipe-result__actions">
          ${
            state.history.length < state.order.length
              ? '<button type="button" class="btn btn--ghost" data-continue>Fortsätt swipa</button>'
              : ''
          }
          <button type="button" class="btn btn--primary" data-restart>Swipa igen från början</button>
        </div>
      </main>`;
    window.scrollTo(0, 0);
    app.querySelector('[data-restart]').addEventListener('click', restart);
    app.querySelector('[data-continue]')?.addEventListener('click', () => {
      state.done = false;
      saveState(store, state);
      drawDeck();
    });
  }

  function finish() {
    state.done = true;
    saveState(store, state);
    drawResult();
  }

  /* Korthög */
  function cardHtml(m, cls) {
    return `
      <article class="swipe-card ${cls}" data-id="${m.id}">
        ${media(m, 'swipe-card__media')}
        <span class="stamp stamp--yes" aria-hidden="true">JA</span>
        <span class="stamp stamp--no" aria-hidden="true">NEJ</span>
        <div class="swipe-card__text">
          <h2 class="swipe-card__name">${esc(m.name)}</h2>
          ${m.ingredients.length ? `<p class="swipe-card__tags">${esc(tagline(m))}</p>` : ''}
        </div>
      </article>`;
  }

  function drawDeck() {
    if (state.done) return drawResult();
    document.title = 'Swipa fram middagen';
    const i = state.history.length;
    if (i >= state.order.length) return finish();
    const current = byId.get(state.order[i]);
    const next = byId.get(state.order[i + 1]);
    const yesCount = state.history.filter((h) => h.yes).length;

    app.innerHTML = `${header('Swipa fram middagen')}
      <main class="swipe">
        <p class="swipe__progress">${i + 1} av ${state.order.length}${yesCount ? ` · <strong>${yesCount} ja</strong>` : ''}</p>
        <div class="swipe__deck">
          ${next ? cardHtml(next, 'is-next') : ''}
          ${cardHtml(current, 'is-top')}
        </div>
        <div class="swipe__controls">
          <button type="button" class="swipe__btn swipe__btn--undo" data-undo aria-label="Ångra" ${i ? '' : 'disabled'}>${UNDO}</button>
          <button type="button" class="swipe__btn swipe__btn--no" data-no aria-label="Nej">${CROSS}</button>
          <button type="button" class="swipe__btn swipe__btn--yes" data-yes aria-label="Ja">${HEART}</button>
          <button type="button" class="swipe__done" data-done>Klar</button>
        </div>
        <p class="swipe__hint muted">Swipa höger för ja, vänster för nej</p>
      </main>`;

    const card = app.querySelector('.swipe-card.is-top');
    const yesStamp = card.querySelector('.stamp--yes');
    const noStamp = card.querySelector('.stamp--no');
    card.querySelectorAll('img').forEach((img) => (img.draggable = false));
    let busy = false;

    function decide(yes) {
      if (busy) return;
      busy = true;
      card.style.transition = 'transform 0.3s ease-out, opacity 0.3s';
      card.style.transform = `translateX(${yes ? 140 : -140}vw) rotate(${yes ? 25 : -25}deg)`;
      card.style.opacity = '0';
      app.querySelector('.swipe-card.is-next')?.classList.add('is-rising');
      state.history.push({ id: current.id, yes });
      saveState(store, state);
      setTimeout(drawDeck, 260);
    }

    // Dra med finger eller mus.
    let startX = 0;
    let startY = 0;
    let dx = 0;
    let t0 = 0;
    let dragging = false;

    card.addEventListener('pointerdown', (e) => {
      if (busy || e.button > 0) return;
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      dx = 0;
      t0 = performance.now();
      card.setPointerCapture(e.pointerId);
      card.style.transition = 'none';
    });

    card.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      dx = e.clientX - startX;
      const dy = (e.clientY - startY) * 0.25;
      card.style.transform = `translate(${dx}px, ${dy}px) rotate(${dx / 16}deg)`;
      yesStamp.style.opacity = Math.max(0, Math.min(1, dx / 90));
      noStamp.style.opacity = Math.max(0, Math.min(1, -dx / 90));
    });

    const release = () => {
      if (!dragging) return;
      dragging = false;
      const v = Math.abs(dx) / Math.max(1, performance.now() - t0);
      if (Math.abs(dx) > 110 || (Math.abs(dx) > 40 && v > 0.6)) return decide(dx > 0);
      card.style.transition = 'transform 0.25s cubic-bezier(0.2, 0.7, 0.2, 1.2)';
      card.style.transform = '';
      yesStamp.style.opacity = noStamp.style.opacity = 0;
      // Ett tryck utan att dra öppnar receptet.
      if (Math.abs(dx) < 6 && performance.now() - t0 < 300) location.hash = `#/maltid/${current.id}`;
    };
    card.addEventListener('pointerup', release);
    card.addEventListener('pointercancel', release);

    app.querySelector('[data-yes]').addEventListener('click', () => decide(true));
    app.querySelector('[data-no]').addEventListener('click', () => decide(false));
    app.querySelector('[data-done]').addEventListener('click', finish);
    app.querySelector('[data-undo]').addEventListener('click', () => {
      if (!state.history.length) return;
      state.history.pop();
      saveState(store, state);
      drawDeck();
    });
  }

  // Piltangenter på datorn.
  const onKey = (e) => {
    if (!location.hash.startsWith('#/valj') || state.done) return;
    if (e.key === 'ArrowRight') app.querySelector('[data-yes]')?.click();
    if (e.key === 'ArrowLeft') app.querySelector('[data-no]')?.click();
  };
  if (keyHandler) document.removeEventListener('keydown', keyHandler);
  keyHandler = onKey;
  document.addEventListener('keydown', onKey);

  drawDeck();
}
