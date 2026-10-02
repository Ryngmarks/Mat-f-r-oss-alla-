// Butiksavdelningar. Nycklarna är fasta och sparas i databasen; en butik är bara en ordning
// av dem. Ordningen nedan är standard när ingen butik är vald.
//
// guessSection() gissar avdelning från varans namn. Reglerna prövas uppifrån och ned,
// så mer specifika regler (t.ex. "sås", "buljong") ligger före bredare ("kyckling", "mjölk").

export const SECTIONS = [
  { key: 'frukt', name: 'Frukt & grönt', emoji: '🥬' },
  { key: 'brod', name: 'Bröd', emoji: '🍞' },
  { key: 'kott', name: 'Kött & kyckling', emoji: '🥩' },
  { key: 'chark', name: 'Chark & pålägg', emoji: '🥓' },
  { key: 'fisk', name: 'Fisk & skaldjur', emoji: '🐟' },
  { key: 'ost', name: 'Ost', emoji: '🧀' },
  { key: 'mejeri', name: 'Mejeri & ägg', emoji: '🥛' },
  { key: 'kylt', name: 'Kylt & färdigmat', emoji: '🥡' },
  { key: 'frys', name: 'Frys', emoji: '🧊' },
  { key: 'torr', name: 'Pasta, ris & torrvaror', emoji: '🍝' },
  { key: 'konserv', name: 'Konserver & såser', emoji: '🥫' },
  { key: 'kryddor', name: 'Kryddor & bakning', emoji: '🧂' },
  { key: 'snacks', name: 'Godis & snacks', emoji: '🍫' },
  { key: 'dryck', name: 'Dryck', emoji: '🧃' },
  { key: 'hushall', name: 'Hushåll & hygien', emoji: '🧻' },
  { key: 'ovrigt', name: 'Övrigt', emoji: '🛒' },
];

export const DEFAULT_ORDER = SECTIONS.map((s) => s.key);
const byKey = new Map(SECTIONS.map((s) => [s.key, s]));
export const sectionInfo = (key) => byKey.get(key) ?? byKey.get('ovrigt');

const RULES = [
  ['hushall', /diskmedel|tvättmedel|toapapper|toalettpapper|hushållspapper|tvål|schampo|tandkräm|blöjor|soppåsar|plastfolie|aluminiumfolie|bakplåtspapper|servetter|tops|deodorant/],
  ['dryck', /juice|läsk|vatten på flaska|mineralvatten|kaffe|(^|\s)te($|\s)|(^|\s)öl($|\s)|(^|\s)vin($|\s)|vin$|saft|cola|smoothie/],
  ['frys', /fryst|frysta|glass|fiskpinnar|pommes|wokgrönsaker|frysta bär|isglass/],
  ['kryddor', /krydda|kryddor|peppar|salt\b|^salt|paprikapulver|chilipulver|currypulver|spiskummin|kanel|kardemumma|oregano|basilika torkad|timjan|buljong|fond\b|bakpulver|bikarbonat|jäst|vaniljsocker|vaniljstång|^socker|florsocker|farinsocker|sirap|kakao/],
  ['konserv', /sås|salsa|krossade|passerade|tomatpuré|kokosmjölk|majonnäs|ketchup|senap|pesto|dressing|oliver|kidneybönor|svarta bönor|vita bönor|kikärtor|majs på burk|tonfisk|sambal|soja|sweet chili|chutney|honung|sylt|marmelad|olja|vinäger|ättika|tacosås/],
  ['chark', /bacon|skinka|salami|korv|prosciutto|chorizo|pålägg|kassler|leverpastej|kalkonpålägg/],
  ['fisk', /fisk|lax|torsk|sej|räk|kräft|musslor|tonfiskfilé|kolja|rödspätta|sill/],
  ['kott', /kött|färs|kyckling|fläsk|biff|entrecote|oxfilé|lamm|kalv|hamburgare|burgare|högrev|karré|kotlett|schnitzel|vilt|älg|(^|\s)ren($|\s)|renskav|kalkon|anka/],
  ['ost', /ost\b|^ost|osten|parmesan|mozzarella|cheddar|fetaost|feta\b|halloumi|brie|gouda|präst|herrgård|grevé|ricotta|mascarpone|cottage|keso|riven ost/],
  ['kylt', /tofu|quorn|färdig|pizzadeg|smördeg|pastadeg|hummus|tzatziki|guacamole|sallad på|röra/],
  ['brod', /bröd|tortilla|pita|baguette|bullar|tunnbröd|wraps|tacoskal|naan|frallor|limpa|knäcke|ciabatta|hamburgerbröd|korvbröd/],
  ['torr', /pasta|spagetti|spaghetti|makaron|penne|tagliatelle|lasagneplattor|nudlar|ris(\s|$)|^ris|risotto|couscous|bulgur|quinoa|havregryn|mjöl(?!k)|ströbröd|polenta|gnocchi|linser|müsli|flingor|cornflakes|nötter|frön|torkad/],
  ['mejeri', /mjölk|grädde|gräddfil|crème|creme|yoghurt|kvarg|smör|ägg|(^|\s)fil($|\s)|filmjölk|kesella|matlagningsgrädde|margarin/],
  ['snacks', /chips|godis|choklad|popcorn|kakor|kex|dipp/],
  ['frukt', /sallad|tomat|lök|gurka|paprika|morot|morötter|broccoli|blomkål|spenat|vitlök|svamp|champinjon|avokado|zucchini|squash|kål|selleri|aubergine|rädis|ruccola|chili|ingefära|persilja|koriander|dill|basilika|gräslök|purjo|sparris|potatis|sötpotatis|majs|ärtor|bönor|äpple|päron|banan|citron|lime|apelsin|bär|druvor|melon|mango|ananas|kiwi|jordgubb|blåbär|hallon|örter|groddar|rödbeta|palsternacka|rotselleri|fänkål/],
];

export function guessSection(name) {
  const n = String(name ?? '').toLocaleLowerCase('sv').trim();
  return RULES.find(([, re]) => re.test(n))?.[0] ?? 'ovrigt';
}

// Butikens ordning, med avdelningar som tillkommit i appen efteråt sist.
export function storeOrder(store) {
  const base = (store?.section_order?.length ? store.section_order : DEFAULT_ORDER).filter((k) => byKey.has(k));
  return [...base, ...DEFAULT_ORDER.filter((k) => !base.includes(k))];
}

/* Inlärning av ordningen ------------------------------------------------
   När man bockar av en vara i avdelning B direkt efter en vara i A (inom 20 min) räknas en
   röst för "A före B". När samma ordning setts två gånger men butiken har B före A flyttas
   B till direkt efter A. Rösterna sparas per butik i webbläsaren. */

const VOTE_KEY = (id) => `mat-for-oss-alla.store-votes.${id}`;
const LAST_KEY = (id) => `mat-for-oss-alla.store-last.${id}`;

export function learnFromCheck(store, sectionKey) {
  if (!store?.id) return null;
  let last = null;
  let votes = {};
  try {
    last = JSON.parse(sessionStorage.getItem(LAST_KEY(store.id)));
    votes = JSON.parse(localStorage.getItem(VOTE_KEY(store.id))) || {};
  } catch {}
  try {
    sessionStorage.setItem(LAST_KEY(store.id), JSON.stringify({ section: sectionKey, at: Date.now() }));
  } catch {}
  if (!last || last.section === sectionKey || Date.now() - last.at > 20 * 60e3) return null;

  const a = last.section;
  const b = sectionKey;
  const k = `${a}>${b}`;
  votes[k] = (votes[k] || 0) + 1;
  votes[`${b}>${a}`] = Math.max(0, (votes[`${b}>${a}`] || 0) - 1);
  try {
    localStorage.setItem(VOTE_KEY(store.id), JSON.stringify(votes));
  } catch {}

  const order = storeOrder(store);
  if (votes[k] >= 2 && order.indexOf(b) < order.indexOf(a)) {
    const next = order.filter((x) => x !== b);
    next.splice(next.indexOf(a) + 1, 0, b);
    votes[k] = 0;
    try {
      localStorage.setItem(VOTE_KEY(store.id), JSON.stringify(votes));
    } catch {}
    return { order: next, moved: b, after: a };
  }
  return null;
}
