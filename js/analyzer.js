import {
  eiwittenIngredients,
  vezelsIngredients,
  gezondeVettenIngredients,
  groenten,
} from '../ingredientDatabase.js';

// ── Build merged ingredient index ──────────────────────────────────────────

function buildIndex() {
  const byName = new Map();

  const add = (items, primaryCat) => {
    for (const item of items) {
      const key = item.dutchName.toLowerCase();
      if (byName.has(key)) {
        const ex = byName.get(key);
        for (const [k, v] of Object.entries(item)) {
          if (v !== undefined && ex[k] === undefined) ex[k] = v;
        }
        if (!ex._cats.includes(primaryCat)) ex._cats.push(primaryCat);
      } else {
        byName.set(key, { ...item, _cats: [primaryCat] });
      }
    }
  };

  add(eiwittenIngredients, 'protein');
  add(vezelsIngredients, 'fiber');
  add(gezondeVettenIngredients, 'fat');
  add(groenten, 'vegetable');

  return Array.from(byName.values());
}

const INGREDIENTS = buildIndex();

// ── Quantity parsing ───────────────────────────────────────────────────────

const UNIT_GRAMS = {
  gram: 1, g: 1, gr: 1,
  kilogram: 1000, kg: 1000,
  ml: 1, milliliter: 1,
  dl: 100, deciliter: 100,
  cl: 10, centiliter: 10,
  liter: 1000, l: 1000,
};

const VAGUE_GRAMS = {
  'snufje': 2, 'snufjes': 2, 'mespuntje': 2, 'mespunt': 2,
  'scheutje': 10, 'scheutjes': 10, 'scheut': 10,
  'theelepel': 5, 'tl': 5, 'theelepels': 5,
  'eetlepel': 14, 'el': 14, 'eetlepels': 14, 'soeplepel': 25,
  'klein handje': 20, 'kleine hand': 20,
  'handje': 30, 'handjevol': 30, 'hand': 30,
  'flinke hand': 40, 'grote hand': 40,
  'blik': 150, 'blikje': 150,
  'pot': 200, 'potje': 200,
  'zakje': 100,
  'portie': 100,
  'plakje': 20, 'plakjes': 20, 'plak': 20,
  'sneetje': 25, 'sneetjes': 25,
  'kopje': 240, 'kom': 300,
  'stuk': 100, 'stuks': 100,
};

const MULTIPLIERS = {
  halve: 0.5, half: 0.5, helft: 0.5,
  kwart: 0.25, quarter: 0.25,
  hele: 1.0, heel: 1.0,
  dubbele: 2.0, double: 2.0, twee: 2.0, two: 2.0,
  drie: 3.0, three: 3.0,
  vier: 4.0, four: 4.0,
};

const DEFAULT_PORTIONS = {
  poultry: 150, red_meat: 150, fish: 150, seafood: 100,
  dairy: 100, eggs: 120, plant_protein: 100,
  legumes: 100, grains: 60, nuts: 30, seeds: 15,
  oils: 15, fruit: 100, vegetables: 100,
  leafy_greens: 80, supplement: 10,
  default: 100,
};

function getDefaultPortion(ingredient) {
  return DEFAULT_PORTIONS[ingredient.category] ?? DEFAULT_PORTIONS.default;
}

function parseQuantity(token) {
  const lower = token.toLowerCase().trim();

  // Check vague amounts — use word boundaries to avoid matching inside ingredient names
  // e.g. "kom" must not match inside "komkommer"
  const sortedVague = Object.keys(VAGUE_GRAMS).sort((a, b) => b.length - a.length);
  for (const vague of sortedVague) {
    const vagueRe = new RegExp(`(?:^|\\s)${vague.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|$)`, 'i');
    if (vagueRe.test(lower)) {
      const multiplierMatch = lower.match(
        new RegExp(`(${Object.keys(MULTIPLIERS).join('|')})\\s+${vague}`, 'i')
      );
      const numMatch = lower.match(new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*${vague}`, 'i'));
      let grams = VAGUE_GRAMS[vague];
      if (multiplierMatch) grams *= MULTIPLIERS[multiplierMatch[1]];
      else if (numMatch) grams *= parseFloat(numMatch[1].replace(',', '.'));
      // Extract ingredient name: text after the amount expression
      const afterVague = lower.replace(new RegExp(`^.*?${vague.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`, 'i'), '').trim();
      return { grams: Math.round(grams), ingredientName: afterVague || lower, isVague: true };
    }
  }

  // Exact weight: "250 gram kipfilet" or "250g kip" or "250 gr kip"
  const weightMatch = lower.match(
    /^(\d+(?:[.,]\d+)?)\s*(gram|g|gr|kilogram|kg|ml|dl|cl|l|liter)\s+(.+)$/i
  );
  if (weightMatch) {
    const amount = parseFloat(weightMatch[1].replace(',', '.'));
    const unit = weightMatch[2].toLowerCase();
    const ingName = weightMatch[3].trim();
    return { grams: Math.round(amount * (UNIT_GRAMS[unit] ?? 1)), ingredientName: ingName, isVague: false };
  }

  // Number without unit: "2 eieren", "3 stukken kip"
  const numberMatch = lower.match(/^(\d+)\s+(.+)$/);
  if (numberMatch) {
    const count = parseInt(numberMatch[1], 10);
    const rest = numberMatch[2].trim();
    // Check if rest starts with a unit
    const unitMatch = rest.match(new RegExp(`^(${Object.keys(UNIT_GRAMS).join('|')})\\s+(.+)$`, 'i'));
    if (unitMatch) {
      const grams = count * (UNIT_GRAMS[unitMatch[1].toLowerCase()] ?? 1);
      return { grams: Math.round(grams), ingredientName: unitMatch[2].trim(), isVague: false };
    }
    // Count × default portion (e.g. "2 eieren")
    return { grams: null, count, ingredientName: rest, isVague: true };
  }

  // Multiplier word: "een halve avocado"
  for (const [word, factor] of Object.entries(MULTIPLIERS)) {
    const re = new RegExp(`(?:een\\s+)?${word}\\s+(.+)$`, 'i');
    const m = lower.match(re);
    if (m) {
      return { grams: null, multiplier: factor, ingredientName: m[1].trim(), isVague: true };
    }
  }

  // Strip leading articles
  const cleaned = lower.replace(/^(een|de|het|some|a|an)\s+/, '').trim();
  return { grams: null, ingredientName: cleaned, isVague: true };
}

// ── Ingredient matching ────────────────────────────────────────────────────

function normalize(s) {
  return s.toLowerCase()
    .replace(/\s*\(.*?\)\s*/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .trim();
}

function levenshtein(a, b) {
  if (a.length > 20 || b.length > 20) return 99;
  const dp = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

function matchIngredient(name) {
  if (!name || name.length < 2) return null;
  const n = normalize(name);
  if (!n) return null;

  // Reject if the entire token (or all meaningful words) are stop words
  const words = n.split(/\s+/).filter(w => w.length > 1);
  if (!words.length) return null;
  if (words.every(w => STOP_WORDS.has(w) || w.length <= 2)) return null;

  // 1. Exact Dutch name
  let hit = INGREDIENTS.find(i => normalize(i.dutchName) === n);
  if (hit) return hit;

  // 2. Exact English name
  hit = INGREDIENTS.find(i => normalize(i.englishName) === n);
  if (hit) return hit;

  // 3. Token is prefix of the first word of a Dutch ingredient name (≥3 chars)
  // Handles "kip" → "Kipfilet", "ton" → "Tonijn", "bro" → "Broccoli"
  if (n.length >= 3 && !STOP_WORDS.has(n)) {
    hit = INGREDIENTS.find(i => {
      const firstWord = normalize(i.dutchName).split(' ')[0];
      return firstWord.startsWith(n) && firstWord.length > n.length;
    });
    if (hit) return hit;
  }

  // 3b. Dutch name contains token (token must be ≥4 chars, not a stop word)
  if (n.length >= 4 && !STOP_WORDS.has(n)) {
    hit = INGREDIENTS.find(i => normalize(i.dutchName).includes(n));
    if (hit) return hit;
  }

  // 4. Token contains Dutch name (Dutch name is substring of query, ≥5 chars)
  hit = INGREDIENTS.find(i => {
    const d = normalize(i.dutchName);
    return d.length >= 5 && n.includes(d);
  });
  if (hit) return hit;

  // 5. English name contains token (token ≥5 chars, not stop word)
  if (n.length >= 5 && !STOP_WORDS.has(n)) {
    hit = INGREDIENTS.find(i => normalize(i.englishName).includes(n));
    if (hit) return hit;
  }

  // 6. Fuzzy match — only for long, specific single words (≥6 chars, lev ≤1)
  const longWord = words.find(w => w.length >= 6 && !STOP_WORDS.has(w));
  if (longWord) {
    hit = INGREDIENTS.find(i => {
      const d = normalize(i.dutchName).split(' ')[0];
      return d.length >= 5 && levenshtein(longWord, d) <= 1;
    });
    if (hit) return hit;
  }

  return null;
}

// ── Stop words (never treat these as ingredients) ─────────────────────────

const STOP_WORDS = new Set([
  // Dutch verbs, pronouns, articles, conjunctions, adjectives
  'ik','je','jij','we','wij','ze','zij','hij','het','de','een','er','dat','die','dit',
  'hier','daar','zo','nu','dan','als','maar','want','omdat','dus','ook','nog','al',
  'wel','toch','bij','op','in','uit','van','aan','voor','naar','met','tot','over',
  'door','om','zonder','na','per','hoe','wie','wat','welk','welke',
  'heb','ben','ga','wil','wilt','kan','kunnen','mag','moet','moeten','zou','zouden',
  'was','waren','heeft','hebben','zijn','is','wordt','worden','doe','doet',
  'meer','minder','veel','weinig','heel','erg','zeer','lekker','vers','fris',
  'gevuld','klaar','goed','groot','klein','vol','compleet','gezond','lekker',
  'maak','maken','maakt','gebruik','gebruiken','neem','nemen',
  'salade','gerecht','maaltijd','recept','koken','eten',
  'beetje','stukje','scheutje','gewoon','gewone','lekker',
  // English equivalents
  'i','you','we','they','he','she','it','my','your','our','their',
  'a','an','the','this','that','these','those','its',
  'want','need','have','use','make','cook','prepare','get',
  'here','there','how','who','where','when','why','which',
  'and','but','or','so','because','with','without','about',
  'some','more','less','much','little','very','quite','just','really',
  'good','fresh','healthy','tasty','filling','complete','full','great',
  'meal','recipe','dish','cooking','food',
]);

// ── Meal context detection ─────────────────────────────────────────────────

const MEAL_CONTEXTS = {
  stoof: ['stoofpot', 'stoof', 'hutspot', 'stoofschotel', 'ragout', 'ragu', 'casserole', 'stew', 'hachee'],
  soep: ['soep', 'bouillon', 'borsch', 'bisque', 'soup', 'minestrone'],
  salade: ['salade', 'salad', 'bowl', 'frisse', 'rucola'],
  roerbak: ['roerbak', 'wok', 'stir-fry', 'stir fry', 'roer'],
  pasta: ['pasta', 'spaghetti', 'tagliatelle', 'penne', 'lasagne', 'risotto', 'noodle'],
  smoothie: ['smoothie', 'shake', 'blender'],
  omelet: ['omelet', 'roerei', 'frittata', 'scrambled', 'quiche'],
};

const MEAL_CONTEXT_BOOSTS = {
  stoof: ['wortel', 'ui', 'bleekselderij', 'linzen', 'kikkererwten', 'lentils'],
  soep: ['bleekselderij', 'wortel', 'prei', 'ui', 'spinazie', 'linzen'],
  salade: ['rucola', 'spinazie', 'avocado', 'walnoten', 'kikkererwten', 'tomaat'],
  roerbak: ['paksoi', 'paprika', 'knoflook', 'ui', 'wortel', 'broccoli'],
  pasta: ['courgette', 'tomaat', 'spinazie', 'ui', 'knoflook', 'champignon'],
  smoothie: ['spinazie', 'boerenkool', 'chia', 'hennepzaden', 'linzen'],
  omelet: ['spinazie', 'paprika', 'champignon', 'courgette', 'ui'],
};

export function detectMealContext(text) {
  const lower = text.toLowerCase();
  for (const [ctx, keywords] of Object.entries(MEAL_CONTEXTS)) {
    if (keywords.some(kw => lower.includes(kw))) return ctx;
  }
  return null;
}

// ── Text tokenization ──────────────────────────────────────────────────────

function tokenizeText(text) {
  return text
    // Remove "maar ik wil..." / "en ik wil..." / "ik wil..." trailing clauses
    .replace(/\b(maar|en)?\s*ik\s+wil\b.*/gi, '')
    // Remove "ik heb/ga/gebruik/maak/doe ..." (verb + rest of clause)
    .replace(/\bik\s+(heb hier|heb|ga|gebruik|maak|doe)\b/gi, '')
    // Remove filler adjective/adverb words
    .replace(/\b(een|stukje|stukjes|ook|nog|extra|lekker|vers|beetje|gewoon|hier|heel|erg|dat|die|meer|gevuld|fris|echt|lekker)\b/gi, ' ')
    // Split on natural delimiters
    .split(/[,;.]|\ben\b|\bmet\b|\bplus\b|\balsook\b|\band\b|\bwith\b/i)
    .map(s => s.trim())
    .filter(s => s.length > 1);
}

// ── Nutrient calculation ───────────────────────────────────────────────────

function fat(item) {
  return item.fatPer100g ?? item.totalFatPer100g ?? 0;
}

function calculateTotals(matched) {
  const t = { calories: 0, protein: 0, fiber: 0, fat: 0, saturatedFat: 0, carbs: 0, sodium: 0 };
  for (const { ingredient: ing, grams } of matched) {
    const f = grams / 100;
    t.calories += (ing.calories ?? 0) * f;
    t.protein += (ing.proteinPer100g ?? 0) * f;
    t.fiber += (ing.fiberPer100g ?? 0) * f;
    t.fat += fat(ing) * f;
    t.saturatedFat += (ing.saturatedFatPer100g ?? 0) * f;
    t.carbs += (ing.carbsPer100g ?? 0) * f;
    t.sodium += (ing.sodiumPer100g ?? 0) * f;
  }
  for (const k of Object.keys(t)) t[k] = Math.round(t[k] * 10) / 10;
  t.salt = Math.round(t.sodium * 2.54) / 1000; // mg → g salt
  return t;
}

function determineCoverage(matched, totals) {
  // Protein
  const pStatus = totals.protein >= 20 ? 'good' : totals.protein >= 10 ? 'low' : 'missing';

  // Fiber
  const fStatus = totals.fiber >= 10 ? 'good' : totals.fiber >= 5 ? 'low' : 'missing';

  // Healthy fat: need an ingredient from the fat category
  const hasHealthyFat = matched.some(({ ingredient: i }) =>
    i._cats.includes('fat') ||
    (i._cats.includes('protein') && i.category === 'fish')
  );
  const fatGrams = matched
    .filter(({ ingredient: i }) => i._cats.includes('fat'))
    .reduce((s, { ingredient: i, grams }) => s + fat(i) * grams / 100, 0);
  const hfStatus = hasHealthyFat && fatGrams >= 5 ? 'good' : hasHealthyFat ? 'low' : 'missing';

  // Vegetables: total grams of vegetable-category items
  const vegGrams = matched
    .filter(({ ingredient: i }) => i._cats.includes('vegetable'))
    .reduce((s, { grams }) => s + grams, 0);
  const vStatus = vegGrams >= 150 ? 'good' : vegGrams >= 50 ? 'low' : 'missing';

  return {
    protein: { status: pStatus, value: totals.protein, unit: 'g' },
    fiber: { status: fStatus, value: totals.fiber, unit: 'g' },
    fat: { status: hfStatus, value: Math.round(fatGrams * 10) / 10, unit: 'g' },
    vegetables: { status: vStatus, value: Math.round(vegGrams), unit: 'g' },
  };
}

// ── Suggestion generation ──────────────────────────────────────────────────

function isAllowed(ing, dietPrefs) {
  if (dietPrefs.dairy && ing.dietaryFlags.includes('dairy')) return false;
  if (dietPrefs.fish && ing.dietaryFlags.includes('fish')) return false;
  if (dietPrefs.pork && ing.dietaryFlags.includes('pork')) return false;
  if (dietPrefs.gluten && ing.dietaryFlags.includes('gluten')) return false;
  if (dietPrefs.vegetarian && !ing.dietaryFlags.includes('vegetarian') && !ing.dietaryFlags.includes('vegan')) return false;
  if (dietPrefs.vegan && !ing.dietaryFlags.includes('vegan')) return false;
  return true;
}

function generateSuggestions(coverage, matched, dietPrefs, mealContext) {
  const alreadyIn = new Set(matched.map(m => m.ingredient.dutchName.toLowerCase()));
  const available = INGREDIENTS.filter(i => !alreadyIn.has(i.dutchName.toLowerCase()) && isAllowed(i, dietPrefs));

  const boostIds = mealContext ? (MEAL_CONTEXT_BOOSTS[mealContext] ?? []) : [];

  function rank(candidates) {
    return candidates
      .map(i => ({
        ingredient: i,
        boost: boostIds.some(b => i.dutchName.toLowerCase().includes(b) || i.id.includes(b)) ? 10 : 0,
        scoreVal: i.score === 'high' ? 3 : i.score === 'medium' ? 2 : 1,
      }))
      .sort((a, b) => (b.boost + b.scoreVal) - (a.boost + a.scoreVal));
  }

  const needed = [];
  const order = ['protein', 'fiber', 'fat', 'vegetables'];
  for (const n of order) {
    const s = n === 'fat' ? coverage.fat.status : coverage[n].status;
    if (s !== 'good') needed.push({ nutrient: n, priority: s === 'missing' ? 2 : 1 });
  }
  needed.sort((a, b) => b.priority - a.priority);

  const suggestions = [];
  const addedIds = new Set();

  for (const { nutrient } of needed) {
    let candidates = [];
    switch (nutrient) {
      case 'protein':
        candidates = available.filter(i => (i.proteinPer100g ?? 0) >= 8);
        candidates.sort((a, b) => (b.proteinPer100g ?? 0) - (a.proteinPer100g ?? 0));
        break;
      case 'fiber':
        candidates = available.filter(i => (i.fiberPer100g ?? 0) >= 4);
        candidates.sort((a, b) => (b.fiberPer100g ?? 0) - (a.fiberPer100g ?? 0));
        break;
      case 'fat':
        candidates = available.filter(i => i._cats.includes('fat'));
        break;
      case 'vegetables':
        candidates = available.filter(i => i._cats.includes('vegetable'));
        break;
    }

    const ranked = rank(candidates);
    let added = 0;
    for (const { ingredient } of ranked) {
      if (added >= 2) break;
      if (!addedIds.has(ingredient.id)) {
        addedIds.add(ingredient.id);
        suggestions.push({ ingredient, forNutrient: nutrient });
        added++;
      }
    }
  }

  return suggestions.slice(0, 6);
}

// ── Main entry point ───────────────────────────────────────────────────────

export function analyze(text, dietPrefs = {}) {
  if (!text.trim()) return null;

  const mealContext = detectMealContext(text);
  const tokens = tokenizeText(text);

  const matched = [];
  const unrecognized = [];
  let usedDefaultPortion = false;

  for (const token of tokens) {
    const { grams: rawGrams, count, multiplier, ingredientName, isVague } = parseQuantity(token);
    if (!ingredientName) continue;

    const ingredient = matchIngredient(ingredientName);
    if (!ingredient) {
      const clean = ingredientName.replace(/^(een|de|het)\s+/i, '').trim();
      if (clean.length > 2) unrecognized.push(clean);
      continue;
    }

    let grams;
    if (rawGrams != null) {
      grams = rawGrams;
    } else {
      const def = getDefaultPortion(ingredient);
      if (count != null) {
        grams = count * (ingredient.category === 'eggs' ? 60 : def);
      } else if (multiplier != null) {
        grams = Math.round(def * multiplier);
      } else {
        grams = def;
        if (isVague) usedDefaultPortion = true;
      }
    }

    matched.push({ ingredient, grams, isVague: rawGrams == null });
  }

  const totals = calculateTotals(matched);
  const coverage = determineCoverage(matched, totals);
  const suggestions = generateSuggestions(coverage, matched, dietPrefs, mealContext);

  return { mealContext, matched, unrecognized, totals, coverage, suggestions, usedDefaultPortion };
}

export { INGREDIENTS };
