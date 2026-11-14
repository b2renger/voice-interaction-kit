// An agent's saved voices: <agent>/voices.json. A saved voice is a name and the voice settings that make it
// (the voice engine, its voice, its speed, Parler's description, Zonos's voice and design): what "Voice" holds in
// Voice & timing, kept under a name. They are saved from that view, and used
//   - there, to give the agent one of them as its own voice;
//   - in a pattern, with the action "Change voice": the agent answers in that voice from then on, until another
//     pattern changes it again (or gives it back its own voice). See session.mjs, switchVoice.
// They belong to the agent: they are duplicated, exported and imported with it.
import { slug } from './interactions.mjs';

/** The settings a saved voice holds (CONTRACT.md, the local voice). */
export const VOICE_KEYS = ['localVoiceEngine', 'localVoice', 'localSpeed', 'voiceDescription', 'zonosVoice', 'voiceDesign'];
const ENGINES = ['supertonic', 'parler', 'chatterbox', 'zonos'];
const MAX_VOICES = 40;

function settings(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const speed = Number(s.localSpeed);
  return {
    localVoiceEngine: ENGINES.includes(s.localVoiceEngine) ? s.localVoiceEngine : 'supertonic',
    localVoice: String(s.localVoice || '').trim().slice(0, 80),
    localSpeed: Number.isFinite(speed) ? Math.min(2, Math.max(0.5, speed)) : 1,
    voiceDescription: String(s.voiceDescription || '').trim().slice(0, 1000),
    zonosVoice: String(s.zonosVoice || '').trim().slice(0, 120),
    voiceDesign: String(s.voiceDesign || '').trim().slice(0, 1000),
  };
}

/** Whatever was read or sent → {version, voices: [{id, name, settings}]}: valid, names and ids unique. */
export function normalizeVoices(raw) {
  const list = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.voices) ? raw.voices : []);
  const voices = [];
  for (const v of list) {
    if (!v || typeof v !== 'object' || voices.length >= MAX_VOICES) continue;
    const name = String(v.name || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    const id = slug(name, '');
    if (!id || voices.some((x) => x.id === id)) continue;
    voices.push({ id, name, settings: settings(v.settings) });
  }
  return { version: 1, voices };
}

/** The voice part of some settings: what "Save this voice" keeps. */
export function voiceOf(s) { return settings(s); }
