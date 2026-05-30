import { analyze, INGREDIENTS } from './analyzer.js';
import { analyzeWithAI } from './ai.js';
import { t, translations } from './i18n.js';

// ── State ──────────────────────────────────────────────────────────────────

const state = {
  screen: 'analyze',
  lang: 'nl',
  dietPrefs: { dairy: false, fish: false, pork: false, gluten: false, vegetarian: false, vegan: false },
  apiKey: '',
  dbCategory: 'protein',
  dbSearch: '',
  lastResult: null,
};

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem('gm_state') ?? '{}');
    if (saved.lang) state.lang = saved.lang;
    if (saved.dietPrefs) Object.assign(state.dietPrefs, saved.dietPrefs);
    if (saved.apiKey) state.apiKey = saved.apiKey;
  } catch {}
}

function saveState() {
  localStorage.setItem('gm_state', JSON.stringify({
    lang: state.lang,
    dietPrefs: state.dietPrefs,
    apiKey: state.apiKey,
  }));
}

// ── i18n ───────────────────────────────────────────────────────────────────

function applyTranslations() {
  document.documentElement.lang = state.lang;
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    el.textContent = t(key, state.lang);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = t(el.dataset.i18nPlaceholder, state.lang);
  });
  document.title = t('appTitle', state.lang);
  document.getElementById('langLabel').textContent = state.lang === 'nl' ? 'EN' : 'NL';
  document.getElementById('langSwitch').checked = state.lang === 'en';
  updateApiStatus();
}

// ── Navigation ─────────────────────────────────────────────────────────────

function navigate(screen) {
  state.screen = screen;
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === `screen-${screen}`));
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.screen === screen));
  if (screen === 'database') renderDatabase();
}

// ── Diet checkboxes ────────────────────────────────────────────────────────

function syncDietCheckboxes() {
  for (const [flag, val] of Object.entries(state.dietPrefs)) {
    const el = document.querySelector(`[data-flag="${flag}"]`);
    if (el) el.checked = val;
  }
}

function handleDietChange(flag, checked) {
  state.dietPrefs[flag] = checked;
  if (flag === 'vegan' && checked) state.dietPrefs.vegetarian = true;
  if (flag === 'vegetarian' && !checked) state.dietPrefs.vegan = false;
  syncDietCheckboxes();
  saveState();
}

// ── Analysis ───────────────────────────────────────────────────────────────

function statusIcon(status) {
  return status === 'good' ? '✅' : status === 'low' ? '⚠️' : '❌';
}

function statusClass(status) {
  return status === 'good' ? 'good' : status === 'low' ? 'low' : 'missing';
}

function renderNutrientGrid(coverage) {
  const grid = document.getElementById('nutrientGrid');
  const nutrients = [
    { key: 'protein', icon: '💪', label: t('nutrientProtein', state.lang) },
    { key: 'fiber', icon: '🌾', label: t('nutrientFiber', state.lang) },
    { key: 'fat', icon: '🥑', label: t('nutrientFat', state.lang) },
    { key: 'vegetables', icon: '🥦', label: t('nutrientVeg', state.lang) },
  ];

  grid.innerHTML = nutrients.map(({ key, icon, label }) => {
    const { status, value, unit } = coverage[key];
    const cls = statusClass(status);
    const statusLabel = t(`status${cls.charAt(0).toUpperCase() + cls.slice(1)}`, state.lang);
    const tip = t(`nutrient${cls.charAt(0).toUpperCase() + cls.slice(1)}Tip`, state.lang);
    return `
      <div class="nutrient-card ${cls}" aria-label="${label}: ${statusLabel}">
        <div class="nc-header">
          <span class="nc-icon">${icon}</span>
          <span class="nc-status-icon">${statusIcon(status)}</span>
        </div>
        <div class="nc-label">${label}</div>
        <div class="nc-value">${value}${unit}</div>
        <div class="nc-status ${cls}">${statusLabel}</div>
        <div class="nc-bar-track"><div class="nc-bar ${cls}" style="width:${Math.min(100, Math.round(value / (key === 'vegetables' ? 3 : key === 'protein' ? 0.3 : key === 'fiber' ? 0.15 : 0.15)))}%"></div></div>
        <div class="nc-tip">${tip}</div>
      </div>`;
  }).join('');
}

function renderSummary(totals) {
  const sum = document.getElementById('nutritionSummary');
  const grid = document.getElementById('summaryGrid');
  const rows = [
    { label: t('caloriesLabel', state.lang), value: Math.round(totals.calories), unit: t('kcal', state.lang) },
    { label: t('proteinLabel', state.lang), value: totals.protein, unit: t('gram', state.lang) },
    { label: t('carbsLabel', state.lang), value: totals.carbs, unit: t('gram', state.lang) },
    { label: t('fiberLabel', state.lang), value: totals.fiber, unit: t('gram', state.lang) },
    { label: t('fatLabel', state.lang), value: totals.fat, unit: t('gram', state.lang) },
    { label: t('satFatLabel', state.lang), value: totals.saturatedFat, unit: t('gram', state.lang) },
    { label: t('saltLabel', state.lang), value: totals.salt, unit: t('gram', state.lang) },
  ];
  grid.innerHTML = rows.map(r => `
    <div class="summary-row">
      <span class="summary-key">${r.label}</span>
      <span class="summary-val">${r.value} ${r.unit}</span>
    </div>`).join('');
  sum.hidden = false;
}

function renderSuggestions(suggestions) {
  const sec = document.getElementById('suggestionsSection');
  const list = document.getElementById('suggestionsList');
  if (!suggestions.length) { sec.hidden = true; return; }

  list.innerHTML = suggestions.map(({ ingredient: ing, forNutrient }) => {
    const nutrientLabel = t(`forNutrient.${forNutrient}`, state.lang);
    const name = state.lang === 'nl' ? ing.dutchName : ing.englishName;
    const mainVal = ing.proteinPer100g != null
      ? `${ing.proteinPer100g}g eiwit`
      : ing.fiberPer100g != null
        ? `${ing.fiberPer100g}g vezels`
        : '';
    return `
      <div class="suggestion-card">
        <div class="sug-info">
          <span class="sug-name">${name}</span>
          <span class="sug-reason">${nutrientLabel}</span>
          ${mainVal ? `<span class="sug-val">${mainVal}/100g</span>` : ''}
        </div>
        <span class="sug-score score-${ing.score}">${t(`dbScore${ing.score.charAt(0).toUpperCase() + ing.score.slice(1)}`, state.lang)}</span>
      </div>`;
  }).join('');
  sec.hidden = false;
}

function renderDetected(matched, unrecognized) {
  const chips = document.getElementById('detectedChips');
  const note = document.getElementById('unrecognizedNote');

  chips.innerHTML = matched.map(({ ingredient: ing, grams, isVague }) => {
    const name = state.lang === 'nl' ? ing.dutchName : ing.englishName;
    return `<span class="ingredient-chip">${name} <span class="chip-grams">${grams}g${isVague ? '~' : ''}</span></span>`;
  }).join('');

  if (unrecognized.length) {
    note.textContent = `${t('unrecognizedPrefix', state.lang)} ${unrecognized.join(', ')}`;
    note.hidden = false;
  } else {
    note.hidden = true;
  }
}

async function runAnalysis() {
  const input = document.getElementById('ingredientInput').value.trim();
  if (!input) {
    document.getElementById('ingredientInput').focus();
    document.getElementById('ingredientInput').classList.add('shake');
    setTimeout(() => document.getElementById('ingredientInput').classList.remove('shake'), 500);
    return;
  }

  const btn = document.getElementById('analyzeBtn');
  btn.disabled = true;
  btn.querySelector('span').textContent = t('analyzingBtn', state.lang);

  const result = analyze(input, state.dietPrefs);
  state.lastResult = result;

  const container = document.getElementById('resultsContainer');
  container.hidden = false;

  // Meal context badge
  const badge = document.getElementById('mealContextBadge');
  const badgeText = document.getElementById('mealContextText');
  if (result.mealContext) {
    const ctxKey = `mealContext${result.mealContext.charAt(0).toUpperCase() + result.mealContext.slice(1)}`;
    badgeText.textContent = `${t('mealContextPrefix', state.lang)} ${t(ctxKey, state.lang)}`;
    badge.hidden = false;
  } else {
    badge.hidden = true;
  }

  renderNutrientGrid(result.coverage);
  renderSummary(result.totals);
  renderSuggestions(result.suggestions);
  renderDetected(result.matched, result.unrecognized);

  // Scroll results into view
  container.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // AI analysis
  const aiSection = document.getElementById('aiSection');
  if (state.apiKey && aiSection) {
    aiSection.hidden = false;
    const aiText = document.getElementById('aiText');
    aiText.textContent = t('aiLoading', state.lang);
    try {
      const aiResult = await analyzeWithAI(input, state.dietPrefs, state.apiKey, state.lang);
      aiText.textContent = aiResult;
    } catch {
      aiText.textContent = t('aiError', state.lang);
    }
  }

  btn.disabled = false;
  btn.querySelector('span').textContent = t('analyzeBtn', state.lang);
}

// ── Database ───────────────────────────────────────────────────────────────

function getDbIngredients(category) {
  const catMap = { protein: 'protein', fiber: 'fiber', fat: 'fat', veg: 'vegetable' };
  const cat = catMap[category];
  return INGREDIENTS.filter(i => i._cats.includes(cat));
}

function renderDatabase() {
  const search = state.dbSearch.toLowerCase();
  const items = getDbIngredients(state.dbCategory)
    .filter(i => !search || i.dutchName.toLowerCase().includes(search) || i.englishName.toLowerCase().includes(search))
    .sort((a, b) => {
      const scoreOrder = { high: 0, medium: 1, low: 2 };
      return (scoreOrder[a.score] ?? 3) - (scoreOrder[b.score] ?? 3);
    });

  const list = document.getElementById('dbList');

  if (!items.length) {
    list.innerHTML = `<p class="db-empty">${t('noResults', state.lang)}</p>`;
    return;
  }

  list.innerHTML = items.map(ing => {
    const name = state.lang === 'nl' ? ing.dutchName : ing.englishName;
    const altName = state.lang === 'nl' ? ing.englishName : ing.dutchName;
    const scoreLabel = t(`dbScore${ing.score.charAt(0).toUpperCase() + ing.score.slice(1)}`, state.lang);

    const catMap = { protein: 'protein', fiber: 'fiber', fat: 'fat', veg: 'vegetable' };
    const primaryVal = (() => {
      switch (state.dbCategory) {
        case 'protein': return ing.proteinPer100g != null ? `${ing.proteinPer100g}g ${t('dbProteinPer100', state.lang)}` : '';
        case 'fiber': return ing.fiberPer100g != null ? `${ing.fiberPer100g}g ${t('dbFiberPer100', state.lang)}` : '';
        case 'fat': return (ing.fatPer100g ?? ing.totalFatPer100g) != null ? `${ing.fatPer100g ?? ing.totalFatPer100g}g ${t('dbFatPer100', state.lang)}` : '';
        case 'veg': return ing.calories != null ? `${ing.calories} ${t('dbCalPer100', state.lang)}` : '';
        default: return '';
      }
    })();

    const flags = [
      ing.dietaryFlags.includes('dairy') ? '🥛' : '',
      ing.dietaryFlags.includes('fish') ? '🐟' : '',
      ing.dietaryFlags.includes('pork') ? '🐷' : '',
      ing.dietaryFlags.includes('gluten') ? '🌾' : '',
      ing.dietaryFlags.includes('vegan') ? '🌿' : '',
      ing.dietaryFlags.includes('vegetarian') && !ing.dietaryFlags.includes('vegan') ? '🥚' : '',
    ].filter(Boolean).join(' ');

    const scoreBar = ing.score === 'high' ? 100 : ing.score === 'medium' ? 65 : 35;

    return `
      <div class="db-item">
        <div class="db-item-header">
          <div class="db-item-names">
            <span class="db-name">${name}</span>
            <span class="db-altname">${altName}</span>
          </div>
          <span class="db-score score-${ing.score}">${scoreLabel}</span>
        </div>
        <div class="db-item-body">
          ${primaryVal ? `<span class="db-primary-val">${primaryVal}</span>` : ''}
          ${flags ? `<span class="db-flags">${flags}</span>` : ''}
        </div>
        <div class="db-score-bar-track"><div class="db-score-bar score-${ing.score}" style="width:${scoreBar}%"></div></div>
        ${ing.notes ? `<p class="db-notes">${ing.notes}</p>` : ''}
      </div>`;
  }).join('');
}

// ── API key ─────────────────────────────────────────────────────────────────

function updateApiStatus() {
  const el = document.getElementById('apiStatus');
  if (!el) return;
  el.textContent = state.apiKey ? t('hasApiKey', state.lang) : t('noApiKey', state.lang);
  el.className = `api-status ${state.apiKey ? 'has-key' : ''}`;
  const clearBtn = document.getElementById('clearApiKey');
  if (clearBtn) clearBtn.hidden = !state.apiKey;
  const aiSection = document.getElementById('aiSection');
  if (aiSection) aiSection.hidden = !state.apiKey;
}

// ── Event listeners ────────────────────────────────────────────────────────

function setupEvents() {
  // Navigation
  document.querySelectorAll('.nav-item').forEach(btn =>
    btn.addEventListener('click', () => navigate(btn.dataset.screen))
  );

  // Analyze button
  document.getElementById('analyzeBtn').addEventListener('click', runAnalysis);

  // Enter in textarea (Ctrl+Enter or Cmd+Enter)
  document.getElementById('ingredientInput').addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      runAnalysis();
    }
  });

  // Language toggle header button
  document.getElementById('langToggle').addEventListener('click', () => {
    state.lang = state.lang === 'nl' ? 'en' : 'nl';
    saveState();
    applyTranslations();
    if (state.screen === 'database') renderDatabase();
    if (state.lastResult) {
      renderNutrientGrid(state.lastResult.coverage);
      renderSummary(state.lastResult.totals);
      renderSuggestions(state.lastResult.suggestions);
      renderDetected(state.lastResult.matched, state.lastResult.unrecognized);
    }
  });

  // Language switch (settings)
  document.getElementById('langSwitch').addEventListener('change', e => {
    state.lang = e.target.checked ? 'en' : 'nl';
    saveState();
    applyTranslations();
    if (state.screen === 'database') renderDatabase();
  });

  // Diet checkboxes
  document.querySelectorAll('[data-flag]').forEach(cb =>
    cb.addEventListener('change', e => handleDietChange(e.target.dataset.flag, e.target.checked))
  );

  // Database tabs
  document.querySelectorAll('.tab').forEach(tab =>
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      state.dbCategory = tab.dataset.cat;
      renderDatabase();
    })
  );

  // Database search
  document.getElementById('dbSearch').addEventListener('input', e => {
    state.dbSearch = e.target.value;
    renderDatabase();
  });

  // API key save
  document.getElementById('saveApiKey').addEventListener('click', () => {
    const val = document.getElementById('apiKeyInput').value.trim();
    state.apiKey = val;
    saveState();
    updateApiStatus();
    if (val) {
      document.getElementById('apiKeyInput').value = '';
      document.getElementById('apiKeyInput').placeholder = '••••••••••••••••';
    }
  });

  // API key clear
  const clearBtn = document.getElementById('clearApiKey');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      state.apiKey = '';
      document.getElementById('apiKeyInput').value = '';
      document.getElementById('apiKeyInput').placeholder = 'sk-ant-...';
      saveState();
      updateApiStatus();
    });
  }
}

// ── PWA registration ───────────────────────────────────────────────────────

function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

// ── Init ───────────────────────────────────────────────────────────────────

function init() {
  loadState();
  setupEvents();
  applyTranslations();
  syncDietCheckboxes();
  updateApiStatus();
  renderDatabase();
  registerSW();
}

init();
