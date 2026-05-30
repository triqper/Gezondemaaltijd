const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5-20251001';

function buildPrompt(ingredientText, dietPrefs, lang) {
  const activeDiet = Object.entries(dietPrefs)
    .filter(([, v]) => v)
    .map(([k]) => k)
    .join(', ');

  const isNl = lang === 'nl';
  return isNl
    ? `Je bent een voedingsdeskundige. Analyseer de volgende ingrediënten en geef feedback in het Nederlands.

Ingrediënten: ${ingredientText}
${activeDiet ? `Dieetbeperkingen: ${activeDiet}` : ''}

Geef kort (max 4 zinnen):
1. Wat goed is aan deze combinatie
2. Wat eventueel mist (qua eiwit, vezels, gezonde vetten, groenten)
3. Één concrete suggestie om de maaltijd completer te maken

Wees specifiek en praktisch. Geen opsommingen, gewoon lopende tekst.`
    : `You are a nutrition expert. Analyze the following ingredients and give feedback in English.

Ingredients: ${ingredientText}
${activeDiet ? `Dietary restrictions: ${activeDiet}` : ''}

Briefly (max 4 sentences):
1. What's good about this combination
2. What might be missing (protein, fiber, healthy fats, vegetables)
3. One concrete suggestion to make the meal more complete

Be specific and practical. No bullet points, just flowing text.`;
}

export async function analyzeWithAI(ingredientText, dietPrefs, apiKey, lang = 'nl') {
  if (!apiKey) throw new Error('No API key');

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-allow-browser': 'true',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 512,
      messages: [{ role: 'user', content: buildPrompt(ingredientText, dietPrefs, lang) }],
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error?.message ?? `HTTP ${response.status}`);
  }

  const data = await response.json();
  return data.content?.[0]?.text ?? '';
}
