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

  // Lokalt läge har ingen inloggning.
  async getUser() {
    return { email: null };
  }
  onSignedOut() {}
  async signIn() {}
  async signOut() {}

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

const MEAL_SELECT =
  'id, name, description, image_url, instructions, created_at, ' +
  'meal_ingredient(category_id, amount, unit, position, ingredient(name))';

class SupabaseStore {
  mode = 'supabase';

  constructor(client) {
    this.sb = client;
  }

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
    await this.sb.auth.signOut();
  }

  #check({ data, error }) {
    if (error) throw new Error(error.message);
    return data;
  }

  #hydrate(row) {
    const { meal_ingredient = [], ...meal } = row;
    const ingredients = [...meal_ingredient]
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map((mi) => ({
        name: mi.ingredient?.name ?? '',
        category_id: mi.category_id,
        amount: mi.amount ?? '',
        unit: mi.unit ?? '',
      }));
    return { ...meal, ingredients };
  }

  #storagePath(url) {
    const marker = `/${IMAGE_BUCKET}/`;
    const i = url?.indexOf(marker) ?? -1;
    return i >= 0 ? decodeURIComponent(url.slice(i + marker.length).split('?')[0]) : null;
  }

  async #removeImage(url) {
    const path = this.#storagePath(url);
    if (path) await this.sb.storage.from(IMAGE_BUCKET).remove([path]);
  }

  async listCategories() {
    return this.#check(await this.sb.from('category').select('id, name, sort_order').order('sort_order'));
  }

  async listIngredientNames() {
    const rows = this.#check(await this.sb.from('ingredient').select('name').order('name'));
    return rows.map((r) => r.name);
  }

  async listMeals() {
    const rows = this.#check(
      await this.sb.from('meal').select(MEAL_SELECT).order('created_at', { ascending: false })
    );
    return rows.map((r) => this.#hydrate(r));
  }

  async getMeal(id) {
    const row = this.#check(await this.sb.from('meal').select(MEAL_SELECT).eq('id', id).maybeSingle());
    return row ? this.#hydrate(row) : null;
  }

  async saveMeal(meal, { imageBlob, removeImage } = {}) {
    const id = meal.id ?? crypto.randomUUID();
    const previous = meal.id
      ? this.#check(await this.sb.from('meal').select('image_url').eq('id', id).maybeSingle())
      : null;

    let image_url = previous?.image_url ?? null;
    if (imageBlob) {
      const path = `${id}/${Date.now()}.jpg`;
      this.#check(
        await this.sb.storage.from(IMAGE_BUCKET).upload(path, imageBlob, { contentType: 'image/jpeg', upsert: true })
      );
      image_url = this.sb.storage.from(IMAGE_BUCKET).getPublicUrl(path).data.publicUrl;
    } else if (removeImage) {
      image_url = null;
    }

    this.#check(
      await this.sb.from('meal').upsert({
        id,
        name: tidyName(meal.name),
        description: meal.description?.trim() || null,
        instructions: meal.instructions?.trim() || null,
        image_url,
      })
    );

    // Gammal bild som ersatts eller tagits bort städas bort (best effort).
    if (previous?.image_url && previous.image_url !== image_url) {
      this.#removeImage(previous.image_url).catch(() => {});
    }

    const ingredients = uniqueIngredients(meal.ingredients);
    let idByName = new Map();
    if (ingredients.length) {
      const rows = this.#check(
        await this.sb
          .from('ingredient')
          .upsert(ingredients.map((i) => ({ name: i.name })), { onConflict: 'name' })
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
    const row = this.#check(await this.sb.from('meal').select('image_url').eq('id', id).maybeSingle());
    this.#check(await this.sb.from('meal').delete().eq('id', id));
    if (row?.image_url) this.#removeImage(row.image_url).catch(() => {});
  }
}
