// The studio's calls to its own server (app/src/api.mjs, app-server.mjs).

async function call(method, path, body) {
  const text = body !== undefined ? JSON.stringify(body) : undefined;
  const r = await fetch(path, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : {},
    body: text,
    // a save sent as the page goes away (a reload, a closing tab) still arrives; browsers cap these at 64 KB
    keepalive: method !== 'GET' && (!text || text.length < 60000),
  });
  let j = null;
  try { j = await r.json(); } catch { /* no body */ }
  if (!r.ok) throw new Error((j && j.error) || `The server answered ${r.status}.`);
  return j;
}
const enc = encodeURIComponent;
/** A recording (16-bit PCM, 16 kHz) sent as is. */
async function sendVoice(path, pcm) {
  const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: pcm.buffer });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error((j && j.error) || `The server answered ${r.status}.`);
  return j;
}

export const api = {
  agents: () => call('GET', '/api/agents'),
  agent: (id) => call('GET', `/api/agents/${enc(id)}`),
  create: (o) => call('POST', '/api/agents', o),
  remove: (id) => call('DELETE', `/api/agents/${enc(id)}`),
  savePersona: (id, data) => call('PUT', `/api/agents/${enc(id)}/persona`, data),
  saveInteractions: (id, data) => call('PUT', `/api/agents/${enc(id)}/interactions`, data),
  saveVoices: (id, voices) => call('PUT', `/api/agents/${enc(id)}/voices`, { voices }),
  voices: () => call('GET', '/api/voices'),
  saveTable: (id, table, data) => call('PUT', `/api/agents/${enc(id)}/tables/${enc(table)}`, data),
  deleteTable: (id, table) => call('DELETE', `/api/agents/${enc(id)}/tables/${enc(table)}`),
  renameTable: (id, table, to) => call('POST', `/api/agents/${enc(id)}/tables/${enc(table)}/rename`, { to }),
  // withPeople: with the voiceprints of its people and its recorded voices (asked first: they identify real people)
  exportBundle: (id, withPeople = false) => call('GET', `/api/agents/${enc(id)}/export${withPeople ? '?people=1' : ''}`),
  privateParts: (id) => call('GET', `/api/agents/${enc(id)}/private`),
  // Voice & timing → Clone a voice: the recording, kept in the agent (format: 'pcm' 16-bit 16 kHz, or 'wav')
  async saveVoiceAudio(id, name, data, format) {
    const r = await fetch(`/api/agents/${enc(id)}/voice-audio?name=${enc(name)}&format=${format}`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: data });
    const j = await r.json().catch(() => null);
    if (!r.ok) throw new Error((j && j.error) || `The server answered ${r.status}.`);
    return j;
  },
  // "Use" on another agent's cloned voice: its recording (file, 'voices/x.wav'), copied into this agent under name
  copyVoiceAudio: (id, name, from, file) => call('POST', `/api/agents/${enc(id)}/voice-audio?name=${enc(name)}&from=${enc(from)}&file=${enc(file)}`),
  // what the models are doing: {text, progress} (text '' when nothing loads)
  status: () => call('GET', '/api/status'),
  decide: (q) => call('POST', '/api/decide', q),
  models: () => call('GET', '/models'),
  farms: (add) => call('GET', `/farms${add ? `?add=${enc(add)}` : ''}`),
  llmModels: (url, key) => call('POST', '/api/llm/models', { url, key }),
  health: () => call('GET', '/health'),
  zonos: (fresh) => call('GET', `/api/voice/zonos${fresh ? '?fresh' : ''}`),
  // Settings → People: the people an agent recognizes by their voice (they belong to the agent)
  people: (agent) => call('GET', `/api/people?agent=${enc(agent)}`),
  addPerson: (agent, name, pcm) => sendVoice(`/api/people?agent=${enc(agent)}&name=${enc(name)}`, pcm),
  identify: (agent, pcm) => sendVoice(`/api/people/identify?agent=${enc(agent)}`, pcm),
  // the Updates window: this version, and new ones (app/electron/updates.cjs, through the server)
  // Settings → VIK folder (moved by the app)
  folder: () => call('GET', '/api/folder'),
  chooseFolder: () => call('POST', '/api/folder/choose'),
  moveFolder: (dir, asIs) => call('POST', '/api/folder/move', { dir, asIs: !!asIs }),
  // the models of the agent shown, loaded before Start; a voice tried (a WAV)
  prepare: (settings) => call('POST', '/api/prepare', { settings }),
  async testVoice(settings, language, text = '') {
    const r = await fetch('/api/voice/test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ settings, language, text }) });
    if (!r.ok) { const j = await r.json().catch(() => null); throw new Error((j && j.error) || `The server answered ${r.status}.`); }
    return r.blob();
  },
  updates: () => call('GET', '/api/updates'),
  checkUpdates: () => call('POST', '/api/updates/check'),
  installUpdate: () => call('POST', '/api/updates/install'),
  removePerson: (agent, id) => call('DELETE', `/api/people/${enc(id)}?agent=${enc(agent)}`),
};
