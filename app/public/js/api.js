// The studio's calls to its own server (app/src/api.mjs, app-server.mjs).

async function call(method, path, body) {
  const r = await fetch(path, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let j = null;
  try { j = await r.json(); } catch { /* no body */ }
  if (!r.ok) throw new Error((j && j.error) || `The server answered ${r.status}.`);
  return j;
}
const enc = encodeURIComponent;

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
  exportBundle: (id) => call('GET', `/api/agents/${enc(id)}/export`),
  decide: (q) => call('POST', '/api/decide', q),
  models: () => call('GET', '/models'),
  farms: (add) => call('GET', `/farms${add ? `?add=${enc(add)}` : ''}`),
  llmModels: (url, key) => call('POST', '/api/llm/models', { url, key }),
  health: () => call('GET', '/health'),
  zonos: (fresh) => call('GET', `/api/voice/zonos${fresh ? '?fresh' : ''}`),
};
