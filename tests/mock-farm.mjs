// A FAKE LLM farm (LlmOnLan), on one port: GET /lol/self (its snapshot, as farm/src/snapshot.js builds it) and
// POST /v1/chat/completions (the OpenAI format, streamed, as LiteLLM answers). It records the requests.
//   const farm = await startMockFarm({ key: 'secret' });   farm.state.full = true → 429 (all places taken)
//                                                          farm.state.starting = true → 503 (its model is starting)
import { createServer } from 'node:http';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function startMockFarm({ key = '', model = 'assistant', underlying = 'gemma4:12b', reply = ['Hello', ' from', ' the farm.'] } = {}) {
  const requests = [];
  const state = { full: false, starting: false, wordMs: 20 };
  const json = (res, status, o) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  const server = createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/lol/self') return json(res, 200, snapshot());
    if (req.method === 'GET' && req.url === '/v1/models') {
      if (key && req.headers.authorization !== `Bearer ${key}`) return json(res, 401, { error: { message: 'Authentication Error' } });
      return json(res, 200, { object: 'list', data: [{ id: model, object: 'model' }, { id: 'other-model', object: 'model' }] });
    }
    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      let body = '';
      for await (const c of req) body += c;
      const b = JSON.parse(body);
      requests.push({ authorization: req.headers.authorization, body: b });
      if (key && req.headers.authorization !== `Bearer ${key}`) return json(res, 401, { error: { message: 'Authentication Error, Invalid proxy server token passed.' } });
      if (state.starting) { res.setHeader('retry-after', '120'); return json(res, 503, { error: { message: 'This farm\'s model is starting: about 2 minutes. Try again then.', type: 'api_error', code: 'lol_engine_starting' } }); }
      if (state.full) { res.setHeader('retry-after', '120'); return json(res, 429, { error: { message: 'lol_seats_full: every seat is taken', type: 'lol_seats_full' } }); }
      if (b.model !== model) return json(res, 400, { error: { message: `Invalid model name passed in model=${b.model}` } });
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const chunk = (delta) => res.write(`data: ${JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', choices: [{ index: 0, delta }] })}\n\n`);
      chunk({ role: 'assistant', content: '' });
      for (const w of reply) {
        if (res.destroyed) return;
        chunk({ content: w });
        await sleep(state.wordMs);
      }
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  function snapshot(over = {}) {
    return {
      v: 1, id: 'mock-farm', name: 'Mock farm', proxyPort: port, httpPort: port,
      endpoint: `http://127.0.0.1:${port}`, openaiBaseUrl: `http://127.0.0.1:${port}/v1`, requiresKey: !!key,
      models: [{ id: model, underlying, default: true }], healthy: true, capacity: { slots: 4, clients: 1 }, ...over,
    };
  }
  return { port, url: `http://127.0.0.1:${port}/v1`, requests, state, snapshot, close: () => new Promise((r) => server.close(() => r())) };
}
