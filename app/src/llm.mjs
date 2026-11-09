// A language model somewhere else, through the OpenAI-compatible protocol (docs/DESIGN.md, 4): an LLM farm on the
// local network (LlmOnLan), or a service (Ollama, LM Studio, OpenAI, Gemini, Mistral, OpenRouter…).
//   POST <url>/chat/completions   {model, messages, stream: true}  → "data: {choices: [{delta: {content}}]}" lines
//   GET  <url>/models             the models it serves
// Hearing, deciding and speaking stay on this computer: only the text of the replies goes there.

/** Addresses ready to use: [name, url, needs a key]. */
export const SERVICES = [
  ['Ollama (this computer)', 'http://localhost:11434/v1', false],
  ['LM Studio (this computer)', 'http://localhost:1234/v1', false],
  ['OpenAI', 'https://api.openai.com/v1', true],
  ['Gemini', 'https://generativelanguage.googleapis.com/v1beta/openai', true],
  ['Mistral', 'https://api.mistral.ai/v1', true],
  ['OpenRouter', 'https://openrouter.ai/api/v1', true],
];

const base = (url) => String(url || '').trim().replace(/\/+$/, '');
/** How to name it in a message: "the LLM farm (…)" or "the language model service at api.openai.com". */
function label(remote) {
  if (remote.kind === 'farm') return 'the LLM farm';
  try { return `the language model service at ${new URL(base(remote.url)).host}`; } catch { return 'the language model service'; }
}
const where = () => 'Settings → Language model';

/**
 * A reply, streamed: the same interface as the engines' generate().
 * @param {{remote: {kind: 'farm'|'service', url: string, model: string, key?: string}, system: string, history: any[],
 *   temperature: number, maxTokens: number, onDelta: (d: string) => void}} o
 */
export function remoteGenerate({ remote, system, history, temperature, maxTokens, onDelta }) {
  const t0 = Date.now();
  const ac = new AbortController();
  let cancelled = false;
  const done = (async () => {
    let text = '';
    let firstTokenMs = null;
    if (!/^https?:\/\//i.test(base(remote.url))) throw new Error(`no address is set for ${label(remote)}: set it in ${where(remote)}.`);
    if (!remote.model) throw new Error(`no model is chosen for ${label(remote)}: choose it in ${where(remote)}.`);
    let res;
    try {
      res = await fetch(`${base(remote.url)}/chat/completions`, {
        method: 'POST',
        signal: ac.signal,
        // a farm without a password takes any key (LlmOnLan's client sends this one); local servers take none
        headers: { 'content-type': 'application/json', authorization: `Bearer ${remote.key || 'sk-lol-lan'}` },
        body: JSON.stringify({ model: remote.model, stream: true, temperature, max_tokens: maxTokens, messages: [{ role: 'system', content: system }, ...history] }),
      });
    } catch (e) {
      if (cancelled) return { text, firstTokenMs, cancelled };
      const why = (e.cause && (e.cause.code || e.cause.message)) || e.message;
      throw new Error(remote.kind === 'farm'
        ? `the LLM farm (${remote.url}) does not answer: is it on, and on this network? (${why})`
        : `${label(remote)} does not answer: is the address right${/localhost|127\.0\.0\.1/.test(remote.url) ? ', and is it running' : ', and is this computer online'}? (${why})`);
    }
    if (!res.ok) throw new Error(await refusal(res, remote));
    const decoder = new TextDecoder();
    let buf = '';
    try {
      for await (const chunk of res.body) {
        buf += decoder.decode(chunk, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') return { text, firstTokenMs, cancelled };
          let ev;
          try { ev = JSON.parse(data); } catch { continue; }
          if (ev.error) throw new Error(`${label(remote)} stopped: ${ev.error.message || JSON.stringify(ev.error)}`);
          const d = ev.choices && ev.choices[0] && ev.choices[0].delta && ev.choices[0].delta.content;
          if (d) {
            if (firstTokenMs === null) firstTokenMs = Date.now() - t0;
            text += d;
            onDelta(d);
          }
        }
      }
    } catch (e) { if (!cancelled) throw e; }
    return { text, firstTokenMs, cancelled };
  })();
  return {
    done,
    cancel() { if (cancelled) return; cancelled = true; ac.abort(); },
  };
}

/** The models a farm or a service serves (GET <url>/models): their ids. */
export async function remoteModels({ url, key }) {
  const u = base(url);
  if (!/^https?:\/\//i.test(u)) throw new Error('The address must start with http:// or https://');
  let res;
  try {
    res = await fetch(`${u}/models`, { headers: { authorization: `Bearer ${key || 'sk-lol-lan'}` }, signal: AbortSignal.timeout(8000) });
  } catch (e) { throw new Error(`Nothing answers at ${u} (${(e.cause && (e.cause.code || e.cause.message)) || e.message}).`); }
  if (res.status === 401 || res.status === 403) throw new Error(key ? 'The key was refused.' : 'This service needs a key.');
  if (!res.ok) throw new Error(`${u} answered ${res.status}.`);
  const j = await res.json().catch(() => ({}));
  const list = Array.isArray(j.data) ? j.data : Array.isArray(j.models) ? j.models : [];
  return list.map((m) => String((m && (m.id || m.name)) || '').replace(/^models\//, '')).filter(Boolean).sort();
}

/** Why it refused, in words. */
async function refusal(res, remote) {
  const body = await res.text().catch(() => '');
  let msg = body;
  try { const j = JSON.parse(body); msg = (j.error && (j.error.message || j.error)) || j.message || body; } catch { /* not JSON */ }
  msg = String(typeof msg === 'object' ? JSON.stringify(msg) : msg).slice(0, 300);
  const it = label(remote);
  if (res.status === 401 || res.status === 403) {
    if (remote.kind === 'farm') return remote.key ? `${it} refused the password (${where(remote)}).` : `this LLM farm needs a password: type it in ${where(remote)}.`;
    return remote.key ? `${it} refused the key (${where(remote)}).` : `${it} needs a key: type it in ${where(remote)}.`;
  }
  if (res.status === 429) {
    if (remote.kind === 'farm') {
      const wait = Number(res.headers.get('retry-after'));
      return `the LLM farm is full: all its places are taken${wait > 0 ? ` (one frees in about ${Math.ceil(wait / 60)} min)` : ''}. Try again later, or ask the person running it to raise "People served at once".`;
    }
    return `${it} says there are too many requests (or the account has no credit left): wait a moment. (${msg})`;
  }
  if ((res.status === 400 || res.status === 404) && /model/i.test(msg)) {
    return `${it} does not serve the model "${remote.model}": choose the language model again (${where(remote)}). (${msg})`;
  }
  return `${it} answered ${res.status}: ${msg}`;
}
