// Ephemeral token server for Gemini Live — no dependencies (Node 18+).
//
// Why: the Gemini API key must not live in the browser (nor in a cables patch).
// This small server keeps the key and gives the browser a single-use TOKEN, valid for 30 min,
// that can only open ONE Live session.
//
//   1. copy .env.example to .env and put GEMINI_API_KEY=... in it
//   2. node server.mjs            (or: GEMINI_API_KEY=... node server.mjs)
//   3. in the cables op: "Token server" = http://localhost:8787/token
//
// By default it only listens on this machine (127.0.0.1).
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
loadDotEnv(join(here, '.env'));

const KEY = process.env.GEMINI_API_KEY || '';
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';
const MODEL = process.env.GEMINI_MODEL || '';           // empty = all Live models
const TOKEN_MINUTES = Number(process.env.TOKEN_MINUTES || 30);
// The pages allowed to ask for a token ('*' = all). By default: cables.gl and local pages.
// "null" (a page opened as file:// or in a sandboxed iframe) is NOT allowed by default: any site
// can pretend to be "null". Only add it to ALLOWED_ORIGINS if you know what you are doing.
const ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://cables.gl,https://sandbox.cables.gl,https://dev.cables.gl,http://localhost,http://127.0.0.1')
  .split(',').map((s) => s.trim()).filter(Boolean);
const MAX_PER_MINUTE = Number(process.env.MAX_PER_MINUTE || 20);

if (!KEY) {
  console.error('✖ The key is missing: put GEMINI_API_KEY=... in token-server/.env (see .env.example).');
  process.exit(1);
}

let recent = [];

function allowed(origin) {
  if (ORIGINS.includes('*')) return true;
  if (!origin) return true;                                // a call from outside a browser (curl)
  return ORIGINS.some((o) => origin === o || (o.startsWith('http://localhost') && /^http:\/\/localhost(:\d+)?$/.test(origin))
    || (o.startsWith('http://127.0.0.1') && /^http:\/\/127\.0\.0\.1(:\d+)?$/.test(origin)));
}

function cors(req, res) {
  const origin = req.headers.origin;
  if (origin && allowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  // Chrome asks for permission before a public page calls localhost (Private/Local Network Access).
  if (req.headers['access-control-request-private-network']) res.setHeader('Access-Control-Allow-Private-Network', 'true');
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function createToken() {
  const now = Date.now();
  const body = {
    uses: 1,
    expireTime: new Date(now + TOKEN_MINUTES * 60 * 1000).toISOString(),
    newSessionExpireTime: new Date(now + 2 * 60 * 1000).toISOString(),
  };
  if (MODEL) body.liveConnectConstraints = { model: MODEL.startsWith('models/') ? MODEL : `models/${MODEL}` };
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/auth_tokens', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  if (!res.ok || !json || !json.name) {
    const why = (json && json.error && json.error.message) || text.slice(0, 300) || `HTTP ${res.status}`;
    throw new Error(why);
  }
  return { token: json.name, expiresAt: body.expireTime };
}

const server = createServer(async (req, res) => {
  cors(req, res);
  const origin = req.headers.origin;
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  const path = (req.url || '/').split('?')[0];
  if (path === '/health') { send(res, 200, { ok: true }); return; }
  if (path !== '/token' || (req.method !== 'POST' && req.method !== 'GET')) { send(res, 404, { error: 'Use POST /token.' }); return; }
  if (origin && !allowed(origin)) { send(res, 403, { error: `Origin not allowed: ${origin} (see ALLOWED_ORIGINS).` }); return; }
  const now = Date.now();
  recent = recent.filter((t) => now - t < 60000);
  if (recent.length >= MAX_PER_MINUTE) { send(res, 429, { error: 'Too many tokens requested, try again in a minute.' }); return; }
  recent.push(now);
  try {
    const t = await createToken();
    console.log(`▸ token given to ${origin || 'a local client'} (valid for ${TOKEN_MINUTES} min)`);
    send(res, 200, t);
  } catch (e) {
    console.error('✖ Google refused to create a token:', e.message);
    send(res, 502, { error: `Google refused to create a token: ${e.message}` });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`▸ Gemini token server: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}/token`);
  console.log(`  allowed pages: ${ORIGINS.join(', ')}`);
});

function loadDotEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
