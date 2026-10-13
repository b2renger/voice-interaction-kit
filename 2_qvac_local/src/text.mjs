// The text of a spoken reply: sentence splitting, cleanup for the voice, interface tags.
// PURE module (no network, no model): tested by tests/test-text.mjs.

export const MOODS = ['neutral', 'happy', 'curious', 'focused', 'sorry', 'surprised', 'excited'];
export const LANGUAGES = { en: 'English', fr: 'French', es: 'Spanish', de: 'German', it: 'Italian', pt: 'Portuguese' };

/** French mood names (still accepted in tags, with or without accents, masculine or feminine) → English moods. */
const MOOD_ALIASES = {
  neutre: 'neutral',
  joyeux: 'happy', joyeuse: 'happy',
  curieux: 'curious', curieuse: 'curious',
  'concentré': 'focused', 'concentrée': 'focused', concentre: 'focused', concentree: 'focused',
  'désolé': 'sorry', 'désolée': 'sorry', desole: 'sorry', desolee: 'sorry',
  surpris: 'surprised', surprise: 'surprised',
  enthousiaste: 'excited',
};

/** The system prompt — SAME text as common/voice-core.js systemPrompt(s, 'local'). */
export function systemPrompt(s, engine = 'local') {
  const lines = [];
  const name = String(s.name || '').trim();
  lines.push(name ? `Your name is ${name}.` : '');
  lines.push(String(s.persona || '').trim());
  lines.push('');
  lines.push('Rules: you are talking out loud with a person, in a spoken conversation.');
  lines.push(`- Always answer in ${LANGUAGES[s.language] || s.language || 'English'}.`);
  if (s.shortAnswers) lines.push('- Short answers: one to three sentences, one question at a time.');
  lines.push('- No lists, no markdown, no emoji: everything you write is spoken out loud.');
  if (s.speakingStyle && engine === 'gemini') lines.push(`- Your way of speaking: ${String(s.speakingStyle).trim()}.`);
  if (s.uiTools) {
    if (engine === 'gemini') {
      lines.push('- When you offer options, say them and call show_choices to show them as buttons.');
      lines.push(`- When your mood changes, call set_mood (${MOODS.join(', ')}).`);
    } else {
      lines.push('- When you offer options, say them, then end with [[choices: option 1 | option 2]].');
      lines.push(`- When your mood changes, add [[mood: ${MOODS[1]}]] (${MOODS.join(', ')}).`);
    }
  }
  return lines.filter((l, i) => l !== '' || i > 1).join('\n').trim();
}

/** A sentence longer than this is cut at its last comma, so the voice starts quickly. */
export const SENTENCE_SOFT_MAX = 160;
// Abbreviations whose final period does not end a sentence (French and English).
const ABBREV = /(?:^|\s)(?:M|Mme|Mlle|Dr|Pr|St|Ste|etc|cf|ex|p|vol|Mr|Mrs|Ms|Jr|Sr|Prof|vs|approx|e\.g|i\.e|a\.m|p\.m)\.$/i;
// Closing quotes or brackets that may follow the final punctuation (English style: …the end." Next).
const CLOSERS = /["”’»)]/;

/**
 * The complete sentences of `text` after index `from`. A sentence ends on . ! ? … followed by whitespace
 * (possibly after closing quotes or brackets), never on "3.5" or "Mr." / "M.", or on an empty line.
 * Works for French spacing ("Bonjour !") and English spacing ("Hello!").
 * With `final`, the rest is the last sentence.
 * @returns {{sentences: string[], next: number}}
 */
export function nextSentences(text, from, final = false) {
  const s = String(text || '');
  let start = Math.max(0, Math.min(s.length, Number(from) || 0));
  const out = [];
  let i = start;
  while (i < s.length) {
    const c = s[i];
    const terminal = c === '.' || c === '!' || c === '?' || c === '…';
    let end = i + 1;
    if (terminal) while (end < s.length && CLOSERS.test(s[end])) end++;
    const after = s[end];
    let cut = -1;
    if (terminal && (after === ' ' || after === '\n' || after === '\t')) {
      if (!(c === '.' && ABBREV.test(s.slice(start, i + 1)))) cut = end;
    } else if (c === '\n' && s[i + 1] === '\n') {
      cut = i;
    } else if (i - start >= SENTENCE_SOFT_MAX) {
      const piece = s.slice(start, i);
      const comma = Math.max(piece.lastIndexOf(', '), piece.lastIndexOf('; '), piece.lastIndexOf(': '));
      if (comma > 40) cut = start + comma + 1;
    }
    if (cut >= 0) {
      const sentence = s.slice(start, cut).trim();
      if (sentence) out.push(sentence);
      start = cut;
      while (start < s.length && /\s/.test(s[start])) start++;
      i = start;
      continue;
    }
    i++;
  }
  if (final) {
    const rest = s.slice(start).trim();
    if (rest) out.push(rest);
    start = s.length;
  }
  return { sentences: out, next: start };
}

/** What a voice should say from a piece of text: no markdown, no links, no emoji. */
export function speakable(text) {
  let s = String(text || '');
  s = s.replace(/```[\s\S]*?(```|$)/g, ' ');
  s = s.replace(/<think>[\s\S]*?(<\/think>|$)/gi, ' ');
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
  s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  s = s.replace(/https?:\/\/\S+/g, ' ');
  s = s.replace(/^\s{0,3}#{1,6}\s+/gm, '');
  s = s.replace(/^\s*(?:[-*+•]|\d{1,3}[.)])\s+/gm, '');
  s = s.replace(/(\*\*|__|\*|_|`|~~)/g, '');
  s = s.replace(/\p{Extended_Pictographic}(️|‍\p{Extended_Pictographic})*/gu, '');
  return s.replace(/\s+/g, ' ').trim();
}

/** What Whisper writes when given silence or noise (compared as a whole, after normalisation). */
const NOTHING = [
  /^$/,
  // French
  /^(sous[- ]titr\w*|sous-titres?) .*amara/,
  /^merci d avoir regard[eé]( cette vid[eé]o)?$/,
  // English
  /^thank(s| you)( (so|very) much)? for watching$/,
  /^(subtitles|captions) (by|from|created by|provided by|made by)\b/,
  /^transcription by\b/,
  /castingwords/,
  /^(please )?(like and )?subscribe( to (my|the|our) channel)?$/,
  /^see you (in the )?next (video|one)$/,
  /^blank_audio$/,
  // both
  /amara\.?org/,
  /^(music|musique|applause|applaudissements|silence|rires|laughter|bruit|noise|inaudible)$/,
  /^((upbeat|soft|gentle|dramatic|light|background) )?music( playing)?$/,
  /^(\.|…|-)+$/,
];

export function heardNothing(text) {
  const s = String(text || '').trim().toLowerCase()
    .replace(/[[\](){}*♪]/g, ' ').replace(/[’']/g, ' ').replace(/[.!?,;:"«»]/g, '').replace(/\s+/g, ' ').trim();
  return !s || NOTHING.some((re) => re.test(s));
}

// — what someone says OVER the agent (setting interruptAfterMs): go on, stop, or a real interruption? —

/** Short replies that mean "I'm listening, go on" (backchannels), English and French. */
export const BACKCHANNELS = {
  en: ['mm', 'mhm', 'mm-hmm', 'mm hmm', 'uh-huh', 'uh huh', 'hmm', 'hm', 'yeah', 'yes', 'yep', 'yup', 'ok', 'okay',
    'right', 'sure', 'i see', 'oh', 'ah', 'aha', 'wow', 'cool', 'nice', 'got it', 'alright', 'all right'],
  fr: ['oui', 'ouais', 'd\'accord', 'ok', 'mmh', 'hum', 'ah oui', 'je vois', 'ah bon', 'super', 'voilà'],
};
/** Short phrases that mean "stop and listen", English and French. */
export const STOP_PHRASES = {
  en: ['stop', 'wait', 'hold on', 'hang on', 'pause', 'quiet', 'enough', 'stop it', 'stop talking', 'be quiet', 'one moment', 'one second'],
  fr: ['stop', 'attends', 'arrête', 'arrête-toi', 'chut', 'pause', 'une seconde', 'un instant'],
};
/** Words that may come with a stop phrase without changing its meaning ("no, wait", "please stop"). */
const STOP_COMPANIONS = ['no', 'non', 'please', 'hey'];

/**
 * The words of a short utterance, normalised: lower case, no accents, no punctuation (hyphens become
 * spaces, apostrophes vanish), and repeated letters collapsed ("Mmmm-hmm!" → ["m", "hm"]).
 */
export function interjectionWords(text) {
  return String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/['’‘`´]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
    .split(' ').filter(Boolean).map((w) => w.replace(/(\p{L})\1+/gu, '$1'));
}
const phraseList = (lists) => [...new Set([...lists.en, ...lists.fr])].map(interjectionWords);
const BACKCHANNEL_WORDS = phraseList(BACKCHANNELS);
const STOP_WORDS = phraseList(STOP_PHRASES);
const COMPANION_WORDS = STOP_COMPANIONS.map(interjectionWords);

/**
 * Can `words` be cut entirely into phrases of the `groups` ({phrases, stop})?
 * @returns {null | {stop: boolean}} null if not; stop = a cut exists that uses a stop phrase
 */
function cover(words, groups) {
  const reach = new Array(words.length + 1).fill(null);     // reach[i]: words[0..i) are covered
  reach[0] = { stop: false };
  for (let i = 0; i < words.length; i++) {
    if (!reach[i]) continue;
    for (const g of groups) {
      for (const p of g.phrases) {
        if (!p.length || !p.every((w, k) => words[i + k] === w)) continue;
        const j = i + p.length;
        const stop = reach[i].stop || g.stop;
        if (!reach[j] || (stop && !reach[j].stop)) reach[j] = { stop };
      }
    }
  }
  return reach[words.length];
}

/** "Mm-hmm.", "Yeah, yeah", "Oh okay", "D'accord" … (a whole utterance of at most 3 words, only backchannels). */
export function isBackchannel(text) {
  const w = interjectionWords(text);
  return w.length > 0 && w.length <= 3 && cover(w, [{ phrases: BACKCHANNEL_WORDS, stop: false }]) !== null;
}

/** "Stop!", "Wait, wait", "Hold on", "Arrête-toi", "No, stop" … (at most 4 words, with a stop phrase in them). */
export function isStopPhrase(text) {
  const w = interjectionWords(text);
  if (!w.length || w.length > 4) return false;
  const r = cover(w, [{ phrases: STOP_WORDS, stop: true }, { phrases: BACKCHANNEL_WORDS, stop: false }, { phrases: COMPANION_WORDS, stop: false }]);
  return !!(r && r.stop);
}

/** Only a sound: Whisper's notes like "(coughs)", "[BLANK_AUDIO]", "*sighs*", or nothing at all. */
function isNoise(text) {
  const t = String(text || '').trim();
  if (heardNothing(t)) return true;
  if (/^(?:[[(*♪].*[\])*♪]\s*)+$/.test(t)) return true;
  return interjectionWords(t).length === 0;
}

/**
 * What was said over the agent while its voice was lowered:
 *   'noise'        nothing understandable (cough, breath): the agent carries on
 *   'backchannel'  "mm-hm", "yeah", "d'accord": the agent carries on
 *   'stop'         "stop", "wait", "attends": the agent stops and listens (no reply)
 *   'other'        anything else: a real interruption, and a normal turn (reply)
 */
export function classifyInterjection(text) {
  if (isNoise(text)) return 'noise';
  if (isBackchannel(text)) return 'backchannel';
  if (isStopPhrase(text)) return 'stop';
  return 'other';
}

// Tag names: the English ones, plus the French ones (choix, humeur) as aliases.
const TAG_KEYS = { choices: 'choices', choice: 'choices', options: 'choices', choix: 'choices', mood: 'mood', humeur: 'mood' };

/** An interface tag → an event, or null. */
export function parseTag(inner) {
  const m = /^\s*([a-zA-Zéè]+)\s*:\s*([\s\S]*)$/.exec(String(inner));
  if (!m) return null;
  const kind = TAG_KEYS[m[1].toLowerCase()];
  if (kind === 'choices') {
    const options = m[2].split(/\s*[|;/]\s*|\s*,\s*(?=[^,]*$)/).map((x) => x.trim()).filter(Boolean).slice(0, 6);
    return options.length ? { type: 'ui.choices', question: '', options } : null;
  }
  if (kind === 'mood') {
    const mood = m[2].trim().toLowerCase().replace(/[^a-zéèêàç]/g, '');
    return { type: 'ui.mood', mood: MOODS.includes(mood) ? mood : (MOOD_ALIASES[mood] || mood || 'neutral') };
  }
  return null;
}

/**
 * Reads a model's reply as it streams in: removes <think>…</think> and the [[…]] tags (which become
 * interface events), and outputs the sentences to say as soon as they are complete.
 */
export class ReplyParser {
  constructor() {
    this.raw = '';         // everything the model wrote
    this.visible = '';     // what is shown and said
    this.pending = '';     // a piece that might be the start of a tag
    this.inThink = false;
    this.cut = 0;          // where the last sentence ended in `visible`
  }

  /** @returns {{sentences: string[], ui: object[], changed: boolean}} */
  push(delta, final = false) {
    this.raw += delta;
    let s = this.pending + delta;
    this.pending = '';
    const ui = [];
    let add = '';
    while (s.length) {
      if (this.inThink) {
        const end = s.toLowerCase().indexOf('</think>');
        if (end < 0) { if (!final) this.pending = s.slice(Math.max(0, s.length - 7)); s = ''; break; }
        s = s.slice(end + 8);
        this.inThink = false;
        continue;
      }
      const lt = s.indexOf('<');
      const br = s.indexOf('[');
      const next = [lt, br].filter((x) => x >= 0).sort((a, b) => a - b)[0];
      if (next === undefined) { add += s; s = ''; break; }
      add += s.slice(0, next);
      s = s.slice(next);
      if (s[0] === '<') {
        if (/^<think>/i.test(s)) { this.inThink = true; s = s.slice(7); continue; }
        if (/^<\/think>/i.test(s)) { s = s.slice(8); continue; }
        if (!final && s.length < 8 && '<think>'.startsWith(s.toLowerCase())) { this.pending = s; s = ''; break; }
        add += '<'; s = s.slice(1); continue;
      }
      // a [[key: …]] or [key: …] tag
      const double = s.startsWith('[[');
      const close = s.indexOf(double ? ']]' : ']');
      if (close < 0) {
        if (!final && s.length < 240) { this.pending = s; s = ''; break; }
        add += s[0]; s = s.slice(1); continue;
      }
      const inner = s.slice(double ? 2 : 1, close);
      const tag = parseTag(inner);
      if (tag) { ui.push(tag); s = s.slice(close + (double ? 2 : 1)); continue; }
      add += s[0]; s = s.slice(1);
    }
    if (final && this.pending) { if (!this.inThink && !this.pending.startsWith('[')) add += this.pending; this.pending = ''; }
    this.visible += add;
    const r = nextSentences(this.visible, this.cut, final);
    this.cut = r.next;
    const sentences = r.sentences.map(speakable).filter(Boolean);
    return { sentences, ui, changed: add.length > 0 };
  }

  end() { return this.push('', true); }

  /** The text shown, without leading whitespace (the model sometimes starts with "\n\n"). */
  get text() { return this.visible.replace(/\s+/g, ' ').trim(); }
}

/** The history kept for the model: the last N exchanges. */
export function trimHistory(history, keep = 12) {
  return history.slice(-keep);
}
