// Datalager. Samma gränssnitt för lokalt läge (localStorage) och Supabase,
// så att resten av appen inte bryr sig om var datan bor.
//
// En maträtt i appen ser ut så här:
// {
//   id, name, description, image_url, instructions, created_at,
//   ingredients: [{ name, category_id, amount, unit }]
// }

import { SUPABASE_URL, SUPABASE_ANON_KEY, IMAGE_BUCKET } from './config.js';

export async function createStore() {
  if (SUPABASE_URL && SUPABASE_ANON_KEY) {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
    return new SupabaseStore(createClient(SUPABASE_URL, SUPABASE_ANON_KEY));
  }
  return new LocalStore();
}

const tidyName = (s) => {
  const t = (s || '').trim().replace(/\s+/g, ' ');
  return t ? t[0].toLocaleUpperCase('sv') + t.slice(1) : '';
};

const uniqueIngredients = (list) => {
  const seen = new Set();
  return list
    .map((i) => ({ ...i, name: tidyName(i.name) }))
    .filter((i) => {
      const key = i.name.toLocaleLowerCase('sv');
      if (!i.name || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

const blobToDataUrl = (blob) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });

/* ------------------------------------------------------------------ */
/* Lokalt läge                                                         */
/* ------------------------------------------------------------------ */

const KEY = 'mat-for-oss-alla.v1';

function seed() {
  const categories = [
    { id: 'protein', name: 'Protein', sort_order: 1 },
    { id: 'kolhydrater', name: 'Kolhydrater', sort_order: 2 },
    { id: 'gronsaker', name: 'Grönsaker', sort_order: 3 },
    { id: 'sas', name: 'Sås', sort_order: 4 },
    { id: 'ovrigt', name: 'Övrigt', sort_order: 5 },
  ];
  const img = (id) => `https://images.unsplash.com/photo-${id}?w=1200&q=75&auto=format&fit=crop`;
  const now = Date.now();
  const meals = [
    {
      name: 'Lasagne',
      description: 'Krämig klassiker med mustig köttfärssås och gratinerad ost.',
      image_url: img('1574894709920-11b28e7367e3'),
      instructions: 'Bryn köttfärs och lök.\nTillsätt krossade tomater och låt puttra 20 min.\nVarva sås, pastaplattor och ostsås i en form.\nToppa med riven ost.\nGratinera i 200° i ca 40 min.',
      ingredients: [
        ['Köttfärs', 'protein', '500', 'g'],
        ['Lasagneplattor', 'kolhydrater', '12', 'st'],
        ['Gul lök', 'gronsaker', '1', 'st'],
        ['Krossade tomater', 'sas', '2', 'burk'],
        ['Ostsås', 'sas', '5', 'dl'],
        ['Riven ost', 'ovrigt', '2', 'dl'],
      ],
    },
    {
      name: 'Tacos',
      description: 'Fredagsmys med krispiga tillbehör och mycket salsa.',
      image_url: img('1565299585323-38d6b0865b47'),
      instructions: '',
      ingredients: [
        ['Köttfärs', 'protein', '500', 'g'],
        ['Tortilla', 'kolhydrater', '8', 'st'],
        ['Tomat', 'gronsaker', '2', 'st'],
        ['Gurka', 'gronsaker', '1', 'st'],
        ['Isbergssallad', 'gronsaker', '', ''],
        ['Salsa', 'sas', '1', 'burk'],
        ['Gräddfil', 'sas', '2', 'dl'],
        ['Tacokrydda', 'ovrigt', '1', 'påse'],
      ],
    },
    {
      name: 'Kyckling Curry',
      description: 'Mild och krämig curry som hela familjen gillar.',
      image_url: img('1565557623262-b51c2513a641'),
      instructions: 'Skär kycklingen.\nStek kyckling och lök.\nTillsätt currysås.\nKoka ris.\nServera.',
      ingredients: [
        ['Kyckling', 'protein', '600', 'g'],
        ['Ris', 'kolhydrater', '4', 'dl'],
        ['Lök', 'gronsaker', '1', 'st'],
        ['Paprika', 'gronsaker', '1', 'st'],
        ['Currysås', 'sas', '4', 'dl'],
      ],
    },
  ].map((m, i) => ({
    ...m,
    id: crypto.randomUUID(),
    created_at: new Date(now - (3 - i) * 60000).toISOString(),
    ingredients: m.ingredients.map(([name, category_id, amount, unit]) => ({ name, category_id, amount, unit })),
  }));

  const db = { categories, ingredients: [], meals: [], meal_ingredients: [] };
  for (const m of meals) writeMeal(db, m);
  return db;
}

// Sparar en maträtt i den relationella strukturen (meal / ingredient / meal_ingredient).
function writeMeal(db, meal) {
  const { ingredients, ...row } = meal;
  const idx = db.meals.findIndex((m) => m.id === row.id);
  if (idx >= 0) db.meals[idx] = row;
  else db.meals.push(row);

  db.meal_ingredients = db.meal_ingredients.filter((mi) => mi.meal_id !== row.id);
  uniqueIngredients(ingredients).forEach((ing, position) => {
    let found = db.ingredients.find((i) => i.name.toLocaleLowerCase('sv') === ing.name.toLocaleLowerCase('sv'));
    if (!found) {
      found = { id: crypto.randomUUID(), name: ing.name };
      db.ingredients.push(found);
    }
    db.meal_ingredients.push({
      meal_id: row.id,
      ingredient_id: found.id,
      category_id: ing.category_id,
      amount: ing.amount || null,
      unit: ing.unit || null,
      position,
    });
  });
}

class LocalStore {
  mode = 'local';

  canShare = false;
  library = { id: 'local', name: 'Min matsedel', role: 'owner' };

  // Lokalt läge har ingen inloggning och bara en matsedel.
  async getUser() {
    return { id: 'local', email: null };
  }
  onSignedOut() {}
  async signIn() {}
  async signOut() {}
  async ensureLibrary() {}
  async listLibraries() {
    return [this.library];
  }
  async myInvites() {
    return [];
  }

  constructor() {
    try {
      this.db = JSON.parse(localStorage.getItem(KEY));
    } catch {
      this.db = null;
    }
    if (!this.db) {
      this.db = seed();
      this.#persist();
    }
  }

  #persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.db));
    } catch (e) {
      throw new Error('Webbläsarens lagring är full. Prova en mindre bild – eller koppla på Supabase.');
    }
  }

  #hydrate(meal) {
    const ingredients = this.db.meal_ingredients
      .filter((mi) => mi.meal_id === meal.id)
      .sort((a, b) => a.position - b.position)
      .map((mi) => ({
        name: this.db.ingredients.find((i) => i.id === mi.ingredient_id)?.name ?? '',
        category_id: mi.category_id,
        amount: mi.amount ?? '',
        unit: mi.unit ?? '',
      }));
    return { ...meal, ingredients };
  }

  async listCategories() {
    return [...this.db.categories].sort((a, b) => a.sort_order - b.sort_order);
  }

  async listIngredientNames() {
    return this.db.ingredients.map((i) => i.name).sort((a, b) => a.localeCompare(b, 'sv'));
  }

  async listMeals() {
    return [...this.db.meals]
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((m) => this.#hydrate(m));
  }

  async getMeal(id) {
    const m = this.db.meals.find((x) => x.id === id);
    return m ? this.#hydrate(m) : null;
  }

  async saveMeal(meal, { imageBlob, removeImage } = {}) {
    const existing = meal.id ? this.db.meals.find((m) => m.id === meal.id) : null;
    const id = existing?.id ?? crypto.randomUUID();
    let image_url = existing?.image_url ?? null;
    if (removeImage) image_url = null;
    if (imageBlob) image_url = await blobToDataUrl(imageBlob);

    const backup = JSON.stringify(this.db);
    writeMeal(this.db, {
      id,
      name: tidyName(meal.name),
      description: meal.description?.trim() || null,
      instructions: meal.instructions?.trim() || null,
      image_url,
      created_at: existing?.created_at ?? new Date().toISOString(),
      ingredients: meal.ingredients,
    });
    try {
      this.#persist();
    } catch (e) {
      this.db = JSON.parse(backup);
      throw e;
    }
    return id;
  }

  async deleteMeal(id) {
    this.db.meals = this.db.meals.filter((m) => m.id !== id);
    this.db.meal_ingredients = this.db.meal_ingredients.filter((mi) => mi.meal_id !== id);
    this.#persist();
  }
}

/* ------------------------------------------------------------------ */
/* Supabase                                                            */
/* ------------------------------------------------------------------ */
//
// Varje användare har en eller flera matsedlar (library). All data hör till en
// matsedel och databasen (RLS) släpper bara fram matsedlar man är medlem i.
// Bilderna ligger i en privat bucket under <library_id>/ och visas via
// tidsbegränsade signerade länkar.

const MEAL_SELECT =
  'id, library_id, name, description, image_path, instructions, created_at, ' +
  'meal_ingredient(category_id, amount, unit, position, ingredient(name))';

const URL_CACHE_KEY = 'mat-for-oss-alla.signed-urls';
const SIGNED_TTL = 7 * 24 * 3600; // sekunder

class SupabaseStore {
  mode = 'supabase';
  canShare = true;
  library = null;

  constructor(client) {
    this.sb = client;
    try {
      this.urlCache = JSON.parse(localStorage.getItem(URL_CACHE_KEY)) || {};
    } catch {
      this.urlCache = {};
    }
  }

  #check({ data, error }) {
    if (error) throw new Error(error.message);
    return data;
  }

  #lib() {
    if (!this.library) throw new Error('Ingen matsedel vald');
    return this.library.id;
  }

  /* Inloggning */

  async getUser() {
    const { data } = await this.sb.auth.getSession();
    return data.session?.user ?? null;
  }

  onSignedOut(cb) {
    this.sb.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') cb();
    });
  }

  async signIn(email, password) {
    const { error } = await this.sb.auth.signInWithPassword({ email: email.trim(), password });
    if (error) {
      throw new Error(
        /invalid login credentials/i.test(error.message) ? 'Fel e-post eller lösenord.' : error.message
      );
    }
  }

  async signOut() {
    this.library = null;
    this.urlCache = {};
    localStorage.removeItem(URL_CACHE_KEY);
    await this.sb.auth.signOut();
  }

  /* Matsedlar och delning */

  // Skapar en egen matsedel första gången en användare loggar in.
  async ensureLibrary() {
    this.#check(await this.sb.rpc('ensure_library'));
  }

  async listLibraries() {
    const user = await this.getUser();
    const rows = this.#check(
      await this.sb.from('library_member').select('role, library(id, name, created_at)').eq('user_id', user.id)
    );
    const counts = this.#check(await this.sb.from('library_member').select('library_id'));
    const members = counts.reduce((m, r) => m.set(r.library_id, (m.get(r.library_id) || 0) + 1), new Map());
    return rows
      .filter((r) => r.library)
      .map((r) => ({ ...r.library, role: r.role, members: members.get(r.library.id) || 1 }))
      .sort((a, b) => (a.role === 'owner' ? 0 : 1) - (b.role === 'owner' ? 0 : 1) || a.created_at.localeCompare(b.created_at));
  }

  async createLibrary(name) {
    return this.#check(await this.sb.rpc('create_library', { p_name: name }));
  }

  async renameLibrary(id, name) {
    this.#check(await this.sb.from('library').update({ name: name.trim() }).eq('id', id));
  }

  async deleteLibrary(id) {
    // Städa bort bilderna först – de försvinner inte av sig själva.
    const files = await this.sb.storage.from(IMAGE_BUCKET).list(id, { limit: 1000 });
    if (files.data?.length) await this.sb.storage.from(IMAGE_BUCKET).remove(files.data.map((f) => `${id}/${f.name}`));
    this.#check(await this.sb.from('library').delete().eq('id', id));
  }

  async leaveLibrary(id) {
    const user = await this.getUser();
    this.#check(await this.sb.from('library_member').delete().eq('library_id', id).eq('user_id', user.id));
  }

  async listMembers(id) {
    return this.#check(await this.sb.rpc('library_members', { p_library: id }));
  }

  async removeMember(id, userId) {
    this.#check(await this.sb.from('library_member').delete().eq('library_id', id).eq('user_id', userId));
  }

  async listSentInvites(id) {
    return this.#check(
      await this.sb.from('library_invite').select('id, email, created_at').eq('library_id', id).order('created_at')
    );
  }

  async invite(id, email) {
    const clean = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) throw new Error('Skriv en giltig e-postadress.');
    const user = await this.getUser();
    const { error } = await this.sb.from('library_invite').insert({ library_id: id, email: clean, invited_by: user.id });
    if (error) throw new Error(error.code === '23505' ? 'Den personen är redan inbjuden.' : error.message);
  }

  async cancelInvite(inviteId) {
    this.#check(await this.sb.from('library_invite').delete().eq('id', inviteId));
  }

  async myInvites() {
    return this.#check(await this.sb.rpc('my_invites'));
  }

  async acceptInvite(inviteId) {
    return this.#check(await this.sb.rpc('accept_invite', { p_invite: inviteId }));
  }

  async declineInvite(inviteId) {
    this.#check(await this.sb.rpc('decline_invite', { p_invite: inviteId }));
  }

  /* Bilder */

  async #signUrls(paths) {
    const now = Date.now();
    const need = [...new Set(paths.filter((p) => p && !(this.urlCache[p]?.exp > now + 24 * 3600e3)))];
    if (need.length) {
      const { data } = await this.sb.storage.from(IMAGE_BUCKET).createSignedUrls(need, SIGNED_TTL);
      for (const d of data || []) {
        if (d.signedUrl) this.urlCache[d.path] = { url: d.signedUrl, exp: now + SIGNED_TTL * 1000 };
      }
      try {
        localStorage.setItem(URL_CACHE_KEY, JSON.stringify(this.urlCache));
      } catch {}
    }
    return (p) => (p ? this.urlCache[p]?.url ?? null : null);
  }

  async #removeFile(path) {
    if (path) await this.sb.storage.from(IMAGE_BUCKET).remove([path]);
  }

  /* Maträtter */

  #hydrate(row, urlFor) {
    const { meal_ingredient = [], image_path, ...meal } = row;
    const ingredients = [...meal_ingredient]
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map((mi) => ({
        name: mi.ingredient?.name ?? '',
        category_id: mi.category_id,
        amount: mi.amount ?? '',
        unit: mi.unit ?? '',
      }));
    return { ...meal, image_path, image_url: urlFor(image_path), ingredients };
  }

  async listCategories() {
    return this.#check(
      await this.sb.from('category').select('id, name, sort_order').eq('library_id', this.#lib()).order('sort_order')
    );
  }

  async listIngredientNames() {
    const rows = this.#check(await this.sb.from('ingredient').select('name').eq('library_id', this.#lib()).order('name'));
    return rows.map((r) => r.name);
  }

  async listMeals() {
    const rows = this.#check(
      await this.sb
        .from('meal')
        .select(MEAL_SELECT)
        .eq('library_id', this.#lib())
        .order('created_at', { ascending: false })
    );
    const urlFor = await this.#signUrls(rows.map((r) => r.image_path));
    return rows.map((r) => this.#hydrate(r, urlFor));
  }

  async getMeal(id) {
    const row = this.#check(
      await this.sb.from('meal').select(MEAL_SELECT).eq('id', id).eq('library_id', this.#lib()).maybeSingle()
    );
    if (!row) return null;
    return this.#hydrate(row, await this.#signUrls([row.image_path]));
  }

  async saveMeal(meal, { imageBlob, removeImage } = {}) {
    const lib = this.#lib();
    const id = meal.id ?? crypto.randomUUID();
    const previous = meal.id
      ? this.#check(await this.sb.from('meal').select('image_path').eq('id', id).maybeSingle())
      : null;

    let image_path = previous?.image_path ?? null;
    if (imageBlob) {
      image_path = `${lib}/${id}-${Date.now()}.jpg`;
      this.#check(
        await this.sb.storage.from(IMAGE_BUCKET).upload(image_path, imageBlob, { contentType: 'image/jpeg' })
      );
    } else if (removeImage) {
      image_path = null;
    }

    this.#check(
      await this.sb.from('meal').upsert({
        id,
        library_id: lib,
        name: tidyName(meal.name),
        description: meal.description?.trim() || null,
        instructions: meal.instructions?.trim() || null,
        image_path,
      })
    );

    // Gammal bild som ersatts eller tagits bort städas bort (best effort).
    if (previous?.image_path && previous.image_path !== image_path) {
      this.#removeFile(previous.image_path).catch(() => {});
    }

    const ingredients = uniqueIngredients(meal.ingredients);
    let idByName = new Map();
    if (ingredients.length) {
      const rows = this.#check(
        await this.sb
          .from('ingredient')
          .upsert(
            ingredients.map((i) => ({ library_id: lib, name: i.name })),
            { onConflict: 'library_id,name' }
          )
          .select('id, name')
      );
      idByName = new Map(rows.map((r) => [r.name, r.id]));
    }

    this.#check(await this.sb.from('meal_ingredient').delete().eq('meal_id', id));
    if (ingredients.length) {
      this.#check(
        await this.sb.from('meal_ingredient').insert(
          ingredients.map((ing, position) => ({
            meal_id: id,
            ingredient_id: idByName.get(ing.name),
            category_id: ing.category_id,
            amount: ing.amount || null,
            unit: ing.unit || null,
            position,
          }))
        )
      );
    }
    return id;
  }

  async deleteMeal(id) {
    const row = this.#check(await this.sb.from('meal').select('image_path').eq('id', id).maybeSingle());
    this.#check(await this.sb.from('meal').delete().eq('id', id));
    if (row?.image_path) this.#removeFile(row.image_path).catch(() => {});
  }
}
