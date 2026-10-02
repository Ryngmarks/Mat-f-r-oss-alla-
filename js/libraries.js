// Panelen "Matsedlar": byt matsedel, svara på inbjudningar, dela och hantera.

import { esc, toast, confirmDialog, ICON } from './ui.js';

let dlg;

/**
 * @param {object} ctx
 * @param {object} ctx.store
 * @param {object} ctx.user
 * @param {() => {libraries: object[], invites: object[]}} ctx.state  aktuell lista
 * @param {() => Promise<void>} ctx.reload       läser om matsedlar och inbjudningar
 * @param {(id: string) => Promise<void>} ctx.switchTo  byter aktiv matsedel
 */
export async function openLibrarySheet(ctx) {
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.className = 'sheet';
    document.body.append(dlg);
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg) dlg.close(); // klick utanför panelen
    });
  }
  dlg.innerHTML = '<div class="sheet__body"><p class="muted">Laddar…</p></div>';
  if (!dlg.open) dlg.showModal();
  await draw(ctx);
}

const peopleText = (lib) =>
  lib.role === 'owner'
    ? lib.members > 1
      ? `Delad · ${lib.members} personer`
      : 'Bara du'
    : `Delad med dig · ${lib.members} personer`;

async function draw(ctx) {
  const { store, user } = ctx;
  const { libraries, invites } = ctx.state();
  const current = store.library;
  const isOwner = current.role === 'owner';

  let members = [];
  let sent = [];
  try {
    [members, sent] = await Promise.all([store.listMembers(current.id), store.listSentInvites(current.id)]);
  } catch (e) {
    toast(e.message);
  }

  dlg.innerHTML = `
    <div class="sheet__body">
      <div class="sheet__head">
        <h2 class="sheet__title">Matsedlar</h2>
        <button type="button" class="round round--plain" data-close aria-label="Stäng">${ICON.x}</button>
      </div>

      ${
        invites.length
          ? `<section class="sheet__sec">
               <h3 class="sheet__h">Inbjudningar</h3>
               ${invites
                 .map(
                   (i) => `
                 <div class="invite">
                   <div class="invite__text">
                     <strong>${esc(i.library_name)}</strong>
                     <small>${esc(i.invited_by || 'Någon')} vill dela sin matsedel med dig</small>
                   </div>
                   <div class="invite__btns">
                     <button type="button" class="btn btn--ghost" data-decline="${i.id}">Nej tack</button>
                     <button type="button" class="btn btn--primary" data-accept="${i.id}">Godkänn</button>
                   </div>
                 </div>`
                 )
                 .join('')}
             </section>`
          : ''
      }

      <section class="sheet__sec">
        <h3 class="sheet__h">Dina matsedlar</h3>
        <ul class="libs">
          ${libraries
            .map(
              (l) => `
            <li>
              <button type="button" class="lib${l.id === current.id ? ' is-on' : ''}" data-switch="${l.id}">
                <span class="lib__text">
                  <span class="lib__name">${esc(l.name)}</span>
                  <small>${peopleText(l)}</small>
                </span>
                ${l.id === current.id ? `<span class="lib__check">${ICON.check}</span>` : ''}
              </button>
            </li>`
            )
            .join('')}
        </ul>
        <form class="inline" data-new>
          <input class="input" name="name" placeholder="Ny matsedel, t.ex. Stugan" autocomplete="off" required>
          <button class="btn btn--soft">Skapa</button>
        </form>
      </section>

      <section class="sheet__sec">
        <h3 class="sheet__h">Dela ”${esc(current.name)}”</h3>
        <p class="muted sheet__note">Den du bjuder in måste godkänna. Ni ser och ändrar då samma maträtter – men aldrig varandras andra matsedlar.</p>
        <ul class="people">
          ${members
            .map(
              (m) => `
            <li>
              <span>${esc(m.email)}${m.user_id === user.id ? ' <small>(du)</small>' : ''}</span>
              <span class="people__end">
                <small class="muted">${m.role === 'owner' ? 'Ägare' : 'Medlem'}</small>
                ${
                  isOwner && m.user_id !== user.id
                    ? `<button type="button" class="ing__remove" data-remove-member="${m.user_id}" data-email="${esc(m.email)}" aria-label="Ta bort ${esc(m.email)}">${ICON.x}</button>`
                    : ''
                }
              </span>
            </li>`
            )
            .join('')}
          ${sent
            .map(
              (i) => `
            <li class="is-pending">
              <span>${esc(i.email)}</span>
              <span class="people__end">
                <small class="muted">Väntar på svar</small>
                <button type="button" class="ing__remove" data-cancel-invite="${i.id}" aria-label="Återkalla inbjudan">${ICON.x}</button>
              </span>
            </li>`
            )
            .join('')}
        </ul>
        <form class="inline" data-invite>
          <input class="input" type="email" name="email" placeholder="E-post till den du vill dela med" autocomplete="off" inputmode="email" required>
          <button class="btn btn--primary">Bjud in</button>
        </form>
      </section>

      <section class="sheet__sec">
        <h3 class="sheet__h">Inställningar</h3>
        <form class="inline" data-rename>
          <input class="input" name="name" value="${esc(current.name)}" aria-label="Namn på matsedeln" required>
          <button class="btn btn--ghost">Byt namn</button>
        </form>
        ${
          isOwner
            ? `<button type="button" class="btn btn--ghost danger-text" data-delete-lib>Ta bort matsedeln</button>`
            : `<button type="button" class="btn btn--ghost danger-text" data-leave>Lämna matsedeln</button>`
        }
      </section>

      <p class="sheet__foot muted">
        Inloggad som ${esc(user.email)} · <button type="button" class="link" data-signout>Logga ut</button>
      </p>
    </div>`;

  bind(ctx);
}

function bind(ctx) {
  const { store } = ctx;
  const current = store.library;
  const $ = (s) => dlg.querySelector(s);

  // Kör en åtgärd, läs om och rita om panelen. Fel visas som toast.
  const act = async (fn, { close = false } = {}) => {
    try {
      await fn();
      await ctx.reload();
      if (close) dlg.close();
      else await draw(ctx);
    } catch (e) {
      toast(e.message);
    }
  };

  $('[data-close]').addEventListener('click', () => dlg.close());
  $('[data-signout]').addEventListener('click', () => {
    dlg.close();
    store.signOut();
  });

  dlg.querySelectorAll('[data-switch]').forEach((b) =>
    b.addEventListener('click', async () => {
      dlg.close();
      await ctx.switchTo(b.dataset.switch);
    })
  );

  dlg.querySelectorAll('[data-accept]').forEach((b) =>
    b.addEventListener('click', () =>
      act(async () => {
        const libId = await store.acceptInvite(b.dataset.accept);
        await ctx.reload();
        await ctx.switchTo(libId);
        toast('Ni delar nu matsedeln');
      }, { close: true })
    )
  );

  dlg.querySelectorAll('[data-decline]').forEach((b) =>
    b.addEventListener('click', () => act(() => store.declineInvite(b.dataset.decline)))
  );

  $('[data-new]').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = e.target.name.value.trim();
    if (!name) return;
    act(
      async () => {
        const id = await store.createLibrary(name);
        await ctx.reload();
        await ctx.switchTo(id);
        toast(`${name} är skapad`);
      },
      { close: true }
    );
  });

  $('[data-invite]').addEventListener('submit', (e) => {
    e.preventDefault();
    const email = e.target.email.value;
    act(async () => {
      await store.invite(current.id, email);
      toast(`Inbjudan skickad till ${email.trim()}`);
    });
  });

  dlg.querySelectorAll('[data-cancel-invite]').forEach((b) =>
    b.addEventListener('click', () => act(() => store.cancelInvite(b.dataset.cancelInvite)))
  );

  dlg.querySelectorAll('[data-remove-member]').forEach((b) =>
    b.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: `Ta bort ${b.dataset.email}?`,
        text: 'Personen kommer inte längre åt den här matsedeln.',
      });
      if (ok) act(() => store.removeMember(current.id, b.dataset.removeMember));
    })
  );

  $('[data-rename]').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = e.target.name.value.trim();
    if (!name || name === current.name) return;
    act(async () => {
      await store.renameLibrary(current.id, name);
      await ctx.reload();
      await ctx.switchTo(current.id);
    });
  });

  $('[data-delete-lib]')?.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: `Ta bort ”${current.name}”?`,
      text: 'Alla maträtter och bilder i matsedeln raderas, även för dem du delar med. Det går inte att ångra.',
    });
    if (ok) act(() => store.deleteLibrary(current.id).then(() => ctx.switchTo(null)), { close: true });
  });

  $('[data-leave]')?.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: `Lämna ”${current.name}”?`,
      text: 'Du kommer inte längre åt matsedeln. Den som delade kan bjuda in dig igen.',
      ok: 'Lämna',
    });
    if (ok) act(() => store.leaveLibrary(current.id).then(() => ctx.switchTo(null)), { close: true });
  });
}
