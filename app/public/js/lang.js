// Does a line look written in another language than the agent's? A fixed line (a greeting, a pattern's "Say") is
// said as written: an English greeting in a French agent makes the agent switch language. PURE module (no DOM):
// tests/test-text.mjs. Only English and French are told apart; anything else gives ''.
const WORDS = {
  en: ['the', 'and', 'you', 'your', 'is', 'are', 'it', 'to', 'of', 'with', 'for', 'this', 'that', 'here', 'what', 'how', 'hi', 'hello', 'so', 'do', 'can', 'my', 'i', 'we', 'its', 'be', 'have', 'will'],
  fr: ['le', 'la', 'les', 'et', 'vous', 'tu', 'est', 'des', 'une', 'un', 'pour', 'avec', 'ce', 'que', 'qui', 'ton', 'ta', 'tes', 'votre', 'vos', 'il', 'elle', 'pas', 'de', 'du', 'au', 'aux', 'je', 'voici', 'voilà', 'bonjour', 'salut', 'mon', 'ma', 'mes', 'nous', 'sont', 'mais', 'on', 'ça'],
};
const NAMES = { en: 'English', fr: 'French' };

/** 'en' | 'fr' | '' (too short, mixed, or another language). Placeholders ({name}) do not count. */
export function guessLanguage(text) {
  const words = String(text || '').replace(/\{[^{}]*\}/g, ' ').toLowerCase().replace(/[’']/g, ' ').match(/[a-zà-ÿ]+/g) || [];
  const hits = Object.fromEntries(Object.entries(WORDS).map(([l, w]) => [l, words.filter((x) => w.includes(x)).length]));
  if (hits.en >= 2 && hits.en > 2 * hits.fr) return 'en';
  if (hits.fr >= 2 && hits.fr > 2 * hits.en) return 'fr';
  return '';
}

/** A warning when the line looks written in another language than the agent's (''): what to do about it. */
export function languageWarning(text, agentLanguage) {
  const guess = guessLanguage(text);
  if (!guess || guess === agentLanguage || !NAMES[agentLanguage]) return '';
  return `This line looks ${NAMES[guess]}, and the agent speaks ${NAMES[agentLanguage]}: it is said as written, so the agent switches language. Write it in ${NAMES[agentLanguage]}.`;
}
