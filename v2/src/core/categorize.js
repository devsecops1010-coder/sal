// SmartCart — automatic categorization (Hebrew + English), backward compatible with "סל" v1.
// v1 had 11 categories incl. 'snacks' and a combined 'toiletries'. The spec splits baby products and
// hygiene/care; v1 'toiletries' items are re-guessed into 'baby' or 'hygiene' by migrateCategory().

export const CATEGORIES = [
  { id: 'produce',  name: 'פירות וירקות',      em: '🥦', order: 1 },
  { id: 'dairy',    name: 'מוצרי חלב וביצים',  em: '🥛', order: 2 },
  { id: 'meat',     name: 'בשר, עוף ודגים',     em: '🍗', order: 3 },
  { id: 'bakery',   name: 'מאפים ולחם',         em: '🥖', order: 4 },
  { id: 'pantry',   name: 'מזון יבש ושימורים',  em: '🥫', order: 5 },
  { id: 'frozen',   name: 'קפואים',             em: '🧊', order: 6 },
  { id: 'drinks',   name: 'משקאות',             em: '🧃', order: 7 },
  { id: 'snacks',   name: 'חטיפים ומתוקים',     em: '🍫', order: 8 },
  { id: 'cleaning', name: 'מוצרי ניקיון',       em: '🧼', order: 9 },
  { id: 'baby',     name: 'מוצרי תינוקות',      em: '🍼', order: 10 },
  { id: 'hygiene',  name: 'היגיינה וטיפוח',     em: '🧴', order: 11 },
  { id: 'other',    name: 'מוצרים נוספים',      em: '🛒', order: 99 },
];
export const LEGACY = { toiletries: null }; // v1 id → re-guess

// v1 keyword map (verbatim) + additions; longest match wins.
export const KEYWORDS = {
  produce: ['עגבני','מלפפון','חסה','גזר','בצל','שום','תפוח','בננ','אבוקדו','לימון','תפוז','פלפל','תפוח אדמה','בטטה','קישוא','חציל','ברוקולי','כרוב','סלק','פטרוזיליה','כוסברה','נענע','ענב','מלון','אבטיח','תות','אגס','רימון','פטריות',
    'tomato','cucumber','lettuce','carrot','onion','garlic','apple','banana','avocado','lemon','orange','pepper','potato','mushroom','שמיר','בזיליקום','קלמנטינ','אפרסק','שזיפ','מנגו','אננס','כרובית','תרד','צנון','שעועית ירוקה'],
  dairy: ['חלב','גבינ','קוטג','יוגורט','שמנת','חמאה','ביצים','ביצה','לבן','דנונה','מילקי','צהוב','בולגרית','מוצרלה',
    'milk','cheese','yogurt','butter','eggs','cream','לאבנה','צפתית','פודינג','מעדן','שוקו בשקית'],
  meat: ['עוף','בשר','שניצל','טחון','דג','סלמון','כבד','הודו','נקניק','קציצות','אנטריקוט','פרגית','חזה',
    'chicken','beef','meat','fish','salmon','turkey','כרעיים','שוקיים','כנפיים','המבורגר','קבב','טונה טרייה','אמנון','מושט','דניס','לברק'],
  bakery: ['לחם','לחמני','פיתה','פיתות','בגט','חלה','קרואסון','עוג','בורקס','טורטיה','מצה',
    'bread','pita','bagel','croissant','cake','לאפה','ג׳חנון','מלאווח','בייגל','קרקר','פריכיות'],
  pantry: ['אורז','פסטה','קמח','סוכר','מלח','שמן','טונה','תירס','קטשופ','מיונז','חומוס','טחינה','קפה','תה','דבש','ריבה','פתיתים','קוסקוס','עדשים','שעועית','חומץ','רוטב','תבלין','פירה',
    'rice','pasta','flour','sugar','salt','oil','coffee','honey','שימורים','קורנפלקס','דגני בוקר','שיבולת','קוואקר','נס קפה','ממרח','שוקולד ממרח','פפריקה','כמון','אבקת אפייה','שמרים'],
  frozen: ['קפוא','גלידה','במיה','אפונה קפוא','פיצה קפוא','קרח','frozen','ice cream','שלגון','בצק עלים','ירקות קפואים'],
  drinks: ['מים','קולה','מיץ','מיץ תפוז','מיץ תפוח','מיץ ענב','מיץ לימון','סודה','בירה','יין','משקה','ספרייט','פאנטה','שוקו',
    'water','cola','juice','soda','beer','wine','פריגת','פיוז','ספרינג','נביעות','מי עדן','תפוזינה','אייס טי'],
  snacks: ['ביסלי','במבה','שוקולד','עוגיות','חטיף','תפוציפס','צ׳יפס','ופל','סוכריות','מסטיק','חטיפים',
    'chocolate','cookies','chips','snack','candy','דובונים','אגוזים','גרעינים','בייגלה'],
  cleaning: ['סבון כלים','אקונומיקה','מגבוני','נייר טואלט','מטהר','ג׳ל','אבקת כביסה','מרכך','שקיות','ספוג','מטליות','נייל',
    'detergent','bleach','toilet paper','sponge','נוזל כביסה','נוזל רצפות','מגבות נייר','נייר מגבת','שקיות אשפה','סנו','פיירי','כלורקס','מסיר שומנים','טבליות למדיח'],
  baby: ['חיתולים','מגבוני תינוק','האגיס','פמפרס','מטרנה','סימילאק','תמ"ל','תמ״ל','מוצץ','בקבוק תינוק','דייסה','משחת החתלה','diapers','baby wipes','formula'],
  hygiene: ['שמפו','משחת שיניים','מברשת','דאודורנט','סבון רחצה','קרם','תחבושות','גילוח',
    'shampoo','toothpaste','toothbrush','deodorant','soap','razor','מרכך שיער','ג׳ל רחצה','סבון ידיים','קיסמי אוזניים','צמר גפן','טמפונים','פדים','קרם הגנה','חוט דנטלי'],
};

const FIN = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };
/** Normalize for matching: final letters → regular, niqqud removed, quote variants unified, lowercase. */
export const norm = (s) => String(s ?? '').trim().toLowerCase()
  .replace(/[֑-ׇ]/g, '')
  .replace(/[״"”“]/g, '"').replace(/[׳'’`]/g, "'")
  .replace(/[ךםןףץ]/g, (c) => FIN[c]);

let NORMALIZED = null;
function index() {
  if (!NORMALIZED) {
    NORMALIZED = [];
    for (const [cat, list] of Object.entries(KEYWORDS)) for (const k of list) NORMALIZED.push([norm(k), cat]);
  }
  return NORMALIZED;
}

/**
 * Guess a category id for a product name.
 * opts.learned: Map/obj of normalized name → category (user corrections win).
 * opts.custom: [{id, keywords:[...]}] user-defined categories (checked with the same longest-match rule).
 */
export function guessCategory(name, opts = {}) {
  const n = norm(name);
  if (!n) return 'other';
  const learned = opts.learned instanceof Map ? opts.learned.get(n) : opts.learned?.[n];
  if (learned) return learned;
  let best = 'other', len = 0;
  const consider = (k, cat) => { if (k.length > len && n.includes(k)) { best = cat; len = k.length; } };
  for (const [k, cat] of index()) consider(k, cat);
  for (const c of opts.custom || []) for (const k of c.keywords || []) consider(norm(k), c.id);
  return best;
}

/** v1 → v2 category id. */
export function migrateCategory(oldId, name) {
  if (oldId === 'toiletries') {
    const g = guessCategory(name);
    return g === 'baby' ? 'baby' : 'hygiene';
  }
  return CATEGORIES.some((c) => c.id === oldId) ? oldId : guessCategory(name);
}

/** Category list incl. user categories, sorted for the shopping route. */
export function allCategories(custom = []) {
  return [...CATEGORIES, ...custom.map((c, i) => ({ em: '🏷️', order: 50 + i, ...c }))].sort((a, b) => a.order - b.order);
}
