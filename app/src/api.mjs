// The studio's API: the agents' files, read and written by the window (docs/DESIGN.md, 5).
//
//   GET    /api/agents                          the agents: [{id, name, title, language, tables, patterns}]
//   POST   /api/agents                          a new agent: {name} | {from: id} (a copy) | {bundle} (an import)
//                                               | {examples: true} (the example agents not here yet)
//   GET    /api/agents/:id                      everything: {id, settings, body, tables, interactions, voices}
//   DELETE /api/agents/:id                      moves it to the trash folder
//   PUT    /api/agents/:id/persona              {settings, body}
//   PUT    /api/agents/:id/interactions         {start, stages, sensitivity, patterns}
//   PUT    /api/agents/:id/voices               {voices: [{name, settings}]}: its saved voices, the whole list
//   GET    /api/voices                          the saved voices of every agent: [{agent, title, id, name, settings}]
//   PUT    /api/agents/:id/tables/:table        {headers, rows}            (creates the table if needed)
//   DELETE /api/agents/:id/tables/:table
//   POST   /api/agents/:id/tables/:table/rename {to}
//   GET    /api/agents/:id/export               the agent in one file (.vik.json)
//   POST   /api/decide                          {agent, text, stage, focus}: what the agent would decide, and why
//
// Only the studio's own page may call it (see samePage in app-server.mjs). Answers are JSON; an error is
// {error} with its HTTP status.

const MAX_BODY = 10 * 1024 * 1024;

/**
 * @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res
 * @param {string} path @param {{store: any, decide?: (q: any) => Promise<any>}} deps
 * @returns {boolean} true if the request was for the API
 */
export function handleApi(req, res, path, deps) {
  if (!path.startsWith('/api/')) return false;
  route(req, path, deps).then(
    (out) => send(res, 200, out === undefined ? { ok: true } : out, out && out.__file),
    (e) => send(res, e.status || 500, { error: e.message || String(e) }),
  );
  return true;
}

async function route(req, path, { store, decide }) {
  const m = req.method;
  const parts = path.split('/').slice(2);       // ['agents', id, …] (the server has decoded the address)
  if (parts[0] === 'decide' && parts.length === 1 && m === 'POST') {
    if (!decide) throw status(404, 'No decision model here.');
    return decide(await body(req));
  }
  if (parts[0] === 'voices' && parts.length === 1 && m === 'GET') return store.allVoices();
  if (parts[0] !== 'agents') throw status(404, 'Not found.');
  const [, id, sub, table, action] = parts;
  if (!id) {
    if (m === 'GET') return store.list();
    if (m === 'POST') {
      const b = await body(req);
      if (b.examples) return { added: store.addExamples() };
      return store.create({ name: b.name, from: b.from, bundle: b.bundle });
    }
  } else if (!sub) {
    if (m === 'GET') return store.get(id);
    if (m === 'DELETE') return store.remove(id);
  } else if (sub === 'persona' && m === 'PUT') {
    return store.savePersona(id, await body(req));
  } else if (sub === 'interactions' && m === 'PUT') {
    return store.saveInteractions(id, await body(req));
  } else if (sub === 'voices' && m === 'PUT') {
    return store.saveVoices(id, await body(req));
  } else if (sub === 'export' && m === 'GET') {
    return { ...store.exportBundle(id), __file: `${id}.vik.json` };
  } else if (sub === 'tables' && table) {
    if (!action && m === 'PUT') return store.saveTable(id, table, await body(req));
    if (!action && m === 'DELETE') return store.deleteTable(id, table);
    if (action === 'rename' && m === 'POST') return { id: store.renameTable(id, table, (await body(req)).to) };
  }
  throw status(404, 'Not found.');
}

function body(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(status(413, 'Too big (10 MB at most).')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const t = Buffer.concat(chunks).toString('utf8');
      if (!t) { resolve({}); return; }
      try { resolve(JSON.parse(t)); } catch { reject(status(400, 'The request is not valid JSON.')); }
    });
    req.on('error', reject);
  });
}

function send(res, code, o, file) {
  if (res.headersSent) return;
  const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
  if (file) { headers['content-disposition'] = `attachment; filename="${file}"`; delete o.__file; }
  res.writeHead(code, headers);
  res.end(JSON.stringify(o, null, file ? 2 : 0));
}

const status = (code, message) => Object.assign(new Error(message), { status: code });
