// The models on this computer, with the QVAC adapter on the fake SDK: a QVAC download is found by its name
// and size and loaded from its path (no network), and "Download all models" downloads only the missing ones,
// giving up on a peer-to-peer download that receives nothing.
//   node tests/test-models.mjs
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { ROOT, check, summary } from './helpers.mjs';

// a home folder of our own, set before the engine is imported (it reads ~/.qvac/models)
const home = mkdtempSync(join(tmpdir(), 'vik-home-'));
process.env.HOME = home;
process.env.USERPROFILE = home;
const FAKE = pathToFileURL(join(ROOT, 'tests', 'fake-qvac-sdk.mjs')).href;
process.env.QVAC_SDK = FAKE;
delete process.env.QVAC_RPC_INIT_TIMEOUT_MS;
const fake = await import(FAKE);
const dir = join(home, '.qvac', 'models');
mkdirSync(dir, { recursive: true });
const whisperFile = join(dir, '0123456789abcdef_ggml-small-q8_0.bin');
writeFileSync(whisperFile, Buffer.alloc(fake.WHISPER_SMALL_Q8_0.expectedSize));
writeFileSync(join(dir, 'fedcba9876543210_supertonic3-q8_0.gguf'), Buffer.alloc(10));   // an interrupted download

const { loadConfig } = await import(pathToFileURL(join(ROOT, 'app', 'src', 'config.mjs')).href);
const { createQvacEngine, hideWorkerConsole, bigVoiceOnGpu } = await import(pathToFileURL(join(ROOT, 'app', 'src', 'engines', 'qvac.mjs')).href);
const config = loadConfig(join(home, 'none.json'));
const MIRROR = 'https://github.com/b2renger/voice-interaction-kit/releases/download/models/';
check(config.modelMirror === MIRROR && JSON.parse(readFileSync(join(ROOT, 'app', 'config.json'), 'utf8')).modelMirror === MIRROR,
  'the voices\' mirror: the "models" release, in the defaults and in config.json', config.modelMirror);
config.modelMirror = '';   // until "the mirror" below: QVAC's sources only
const logs = [];
const engine = await createQvacEngine(config, (m) => logs.push(m));
check(process.env.QVAC_RPC_INIT_TIMEOUT_MS === '180000', 'the QVAC worker gets 3 minutes to start (a cold start), not 30 s', process.env.QVAC_RPC_INIT_TIMEOUT_MS);

// — Windows: QVAC's worker (bare.exe) starts with no console window (an empty terminal, in 3.0.0) —
{
  const calls = [];
  let relays = 0;
  const cp = { spawn(file, args, opts) { calls.push({ file, args, opts }); return { stdout: { on: () => { relays++; } } }; } };
  hideWorkerConsole(cp, 'win32');
  hideWorkerConsole(cp, 'win32');   // applied once
  cp.spawn('C:\\VIK\\resources\\app\\node_modules\\bare-runtime-win32-x64\\bin\\bare.exe', ['worker.js', '{}'], { platform: 'win32', arch: 'x64', stdio: ['inherit', 'inherit', 'pipe'] });
  const w = calls[0];
  check(calls.length === 1 && w.opts.windowsHide === true && w.opts.stdio.join() === 'ignore,pipe,pipe' && w.opts.arch === 'x64' && w.args[0] === 'worker.js' && relays === 1,
    'the worker: windowsHide, no inherited handle, its output relayed once, the rest as QVAC asked', calls);
  cp.spawn('C:\\VIK\\Update.exe', ['--createShortcut=VIK.exe'], { detached: true, stdio: 'ignore' });
  check(calls[1].opts.windowsHide === undefined && calls[1].opts.stdio === 'ignore', 'any other program starts as before', calls[1]);
  const mac = { spawn() {} };
  const own = mac.spawn;
  hideWorkerConsole(mac, 'darwin');
  check(mac.spawn === own, 'on a Mac (or Linux) nothing changes');
  const real = (await import('node:child_process')).default;
  check(Boolean(real.spawn.vikHidesWorker) === (process.platform === 'win32'), 'the engine applies it, on Windows only', process.platform);
}

// — Parler and Chatterbox: the graphics card on a Mac only, unless config.json says otherwise —
check(!bigVoiceOnGpu({}, { useGpu: true }, 'win32') && bigVoiceOnGpu({}, { useGpu: true }, 'darwin') && !bigVoiceOnGpu({}, { useGpu: false }, 'darwin'),
  'Parler / Chatterbox: on the CPU on Windows (no GPU for Parler there; Chatterbox filled a 4 GB card), on the GPU on a Mac (unless tts.useGpu is false)');
check(bigVoiceOnGpu({ useGpu: true }, { useGpu: true }, 'win32') && !bigVoiceOnGpu({ useGpu: false }, { useGpu: true }, 'darwin'), '... and their own useGpu in config.json decides, everywhere');

// — what is on this computer —
const list = engine.models();
const byName = (n) => list.find((m) => m.name === n);
check(list.length === 8 && byName('TTS_S3GEN_MULTILINGUAL_CHATTERBOX_Q4_0') && byName('EMBEDDINGGEMMA_300M_Q8_0'), 'the models: recognition, detection, language, the 3 voices (Chatterbox in 2 files), the decision model', list.map((m) => m.name));
check(byName('WHISPER_SMALL_Q8_0').file === whisperFile, 'a download of the right size is found, whatever its prefix', byName('WHISPER_SMALL_Q8_0'));
check(!byName('TTS_MULTILINGUAL_SUPERTONIC3_Q8_0').file, 'a file of the wrong size (an interrupted download) is not');
check(list.filter((m) => m.p2pOnly).length === 4 && list.filter((m) => m.p2pOnly).every((m) => m.name.startsWith('TTS_')), 'the 4 voice files come from the peer-to-peer registry only');

// — loading: from the file on disk when there is one —
await engine.prepare(config.defaults, () => {});
const loads = fake.calls.filter((c) => c.fn === 'loadModel');
const w = loads.find((c) => c.modelType === 'whisper');
check(w && w.src === whisperFile, 'Whisper loads from its file on disk (no network)', w);
check(w && /^https:\/\/huggingface\.co\//.test(w.modelConfig.vadModelSrc), 'Silero, not on disk, still comes from Hugging Face', w && w.modelConfig.vadModelSrc);
check(loads.find((c) => c.modelType === 'tts').src === 'TTS_MULTILINGUAL_SUPERTONIC3_Q8_0', 'Supertonic, incomplete on disk, comes from the QVAC registry');
const emb = loads.find((c) => c.modelType === 'embeddings');
check(emb && /^https:\/\/huggingface\.co\/.*embeddinggemma/.test(emb.src) && emb.modelConfig.device === 'gpu', 'the decision model (EmbeddingGemma) loads too, from Hugging Face', emb);
const m = engine.matcher();
check(m && m.name === 'EmbeddingGemma 300M' && m.calibration.similar[0] === 0.55, 'it becomes the matcher of the decision model (with its calibration from config.json)', m && m.name);
const [va, vb, vc] = await m.vectors(['when do you open', 'what time do you open', 'tickets please'], 'similar');
check(m.score(va, vb) > m.score(va, vc) && fake.calls.some((x) => x.fn === 'embed' && x.n === 3), 'its vectors come from QVAC (embed: one batch, with the model\'s prompts)', [m.score(va, vb), m.score(va, vc)]);
// QVAC's embedding model takes one job at a time: requests made together must wait for each other
const together = await Promise.all([m.vectors(['p1', 'p2'], 'similar'), m.vectors(['q1'], 'query'), m.vectors(['r1'], 'document', ['R'])]).catch((e) => e);
check(Array.isArray(together) && !fake.getProblems().some((p) => /second job/.test(p)), 'requests made at the same time are sent one after the other (QVAC refuses two jobs at once)', fake.getProblems());

// — "Download all models", on a network that blocks peer-to-peer —
process.env.FAKE_P2P = 'blocked';
const progress = [];
const t0 = Date.now();
const failed = await engine.install((p) => progress.push(p), 1);
const dl = fake.calls.filter((c) => c.fn === 'downloadAsset');
check(dl.length === 7 && !dl.some((c) => /ggml-small/.test(c.src)), 'downloads the 7 missing models, not Whisper', dl.map((c) => c.src));
check(dl.filter((c) => /^https:\/\/huggingface\.co\//.test(c.src)).length === 3, 'Silero, Qwen3 and EmbeddingGemma over HTTPS (default "http")');
check(failed.length === 4 && failed.every((m) => m.p2pOnly), 'the 4 voice files, receiving nothing, are reported as failed', failed.map((m) => m.name));
check(fake.calls.filter((c) => c.fn === 'cancel').length === 4 && Date.now() - t0 < 15000, 'each stalled download is cancelled, in time', Date.now() - t0);
check(logs.some((l) => /peer-to-peer network \(this network seems to block it\)/.test(l)), 'the log says the network seems to block peer-to-peer', logs);
check(progress.some((p) => p.stage === '1/7 voice detection'), 'the progress names each model ("1/7 voice detection")', progress.slice(0, 3));

// — the mirror: the voices over HTTPS, on a network that blocks peer-to-peer (a school's) —
{
  // a mirror of the 4 voice files; the fake catalogue gets their SHA-256, as the real one has
  const VOICES = ['TTS_MULTILINGUAL_SUPERTONIC3_Q8_0', 'TTS_MINI_V1_EN_PARLER_TTS_Q8_0', 'TTS_T3_MULTILINGUAL_CHATTERBOX_Q4_0', 'TTS_S3GEN_MULTILINGUAL_CHATTERBOX_Q4_0'];
  const served = {};
  for (const n of VOICES) {
    const body = Buffer.alloc(fake[n].expectedSize, n.length);
    served[fake[n].registryPath.split('/').pop()] = body;
    fake[n].sha256Checksum = createHash('sha256').update(body).digest('hex');
  }
  const asked = [];
  let mode = {};   // file name → 'bad' (other bytes, same size) or 'hang' (headers, then nothing)
  const server = createServer((req, res) => {
    const name = decodeURIComponent(req.url.split('/').pop());
    asked.push(name);
    const body = served[name];
    if (!req.url.startsWith('/models/') || !body) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-length': body.length });
    if (mode[name] === 'hang') return;
    res.end(mode[name] === 'bad' ? Buffer.alloc(body.length, 7) : body);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  config.modelMirror = `http://127.0.0.1:${server.address().port}/models`;   // no final slash: added
  const here = () => readdirSync(dir);
  const p2pTried = (n) => fake.calls.some((c) => c.fn === 'downloadAsset' && c.src === n);

  check(engine.models().every((x) => !x.p2pOnly) && engine.models().filter((x) => x.mirror).length === 4,
    'with a mirror, no model depends on peer-to-peer only any more (the 4 voices have a mirror address)', engine.models().map((x) => [x.name, x.mirror]));

  // Start with Chatterbox, not on this computer: both its files come from the mirror before QVAC loads them
  const before = fake.calls.length;
  const seen = [];
  await engine.prepare({ ...config.defaults, localVoiceEngine: 'chatterbox' }, (p) => seen.push(p));
  const tts = fake.calls.slice(before).find((c) => c.fn === 'loadModel' && c.modelType === 'tts');
  check(tts && tts.src === join(dir, 'mirror_chatterbox-t3-mtl-q4_0.gguf') && tts.modelConfig.s3genModelSrc === join(dir, 'mirror_chatterbox-s3gen-mtl-q4_0.gguf'),
    'Start with Chatterbox: its two files come from the mirror, then load from disk', tts);
  check(tts && tts.modelConfig.useGPU === (process.platform === 'darwin'), '... on the graphics card on a Mac only', tts && tts.modelConfig.useGPU);
  check(seen.some((p) => p.stage === 'voice (chatterbox, part 2)' && p.progress === 100) && logs.some((l) => /voice \(chatterbox\): downloaded from the mirror/.test(l)),
    '... with their progress in the banner, and a line in the log', seen.filter((p) => /voice/.test(p.stage)).slice(-2));

  // a copy put in the models folder by hand, under its own name, counts
  writeFileSync(join(dir, 'parler-mini-v1-q8_0.gguf'), served['parler-mini-v1-q8_0.gguf']);
  check(engine.models().find((x) => x.name === 'TTS_MINI_V1_EN_PARLER_TTS_Q8_0').file === join(dir, 'parler-mini-v1-q8_0.gguf'),
    'a voice downloaded by hand and put in the models folder (its own file name) is found');

  // the mirror sends the wrong bytes: refused, deleted, and QVAC's peer-to-peer network is tried
  mode = { 'supertonic3-q8_0.gguf': 'bad' };
  asked.length = 0;
  let failed2 = await engine.install(() => {}, 1);
  check(asked.join() === 'supertonic3-q8_0.gguf' && failed2.map((x) => x.name).join() === 'TTS_MULTILINGUAL_SUPERTONIC3_Q8_0' && p2pTried('TTS_MULTILINGUAL_SUPERTONIC3_Q8_0'),
    '"Download all models": only the missing voice is asked for; wrong bytes → peer-to-peer is tried (blocked here): failed', { asked, failed2: failed2.map((x) => x.name) });
  check(!here().some((f) => /^mirror_supertonic|\.part$/.test(f)) && logs.some((l) => /SHA-256 differs/.test(l)),
    '... the wrong file is not kept (nor a .part), and the log says why', here());

  // the mirror stops sending: given up after the stall delay
  mode = { 'supertonic3-q8_0.gguf': 'hang' };
  const t1 = Date.now();
  failed2 = await engine.install(() => {}, 1);
  check(failed2.length === 1 && logs.some((l) => /the mirror .*nothing received in 1 s/.test(l)) && Date.now() - t1 < 10000,
    'a mirror that sends nothing is given up after the stall delay', Date.now() - t1);

  // the mirror works: the voice arrives, checked, and nothing fails
  mode = {};
  const shown = [];
  failed2 = await engine.install((p) => shown.push(p), 1);
  check(failed2.length === 0 && here().includes('mirror_supertonic3-q8_0.gguf') && engine.models().filter((x) => VOICES.includes(x.name)).every((x) => x.file),
    'the mirror works: the voice is downloaded and checked, the 4 voices are now on this computer', { failed2, here: here() });
  check(shown.some((p) => /^\d\/\d voice \(supertonic\)$/.test(p.stage) && p.progress === 100 && p.total === fake.TTS_MULTILINGUAL_SUPERTONIC3_Q8_0.expectedSize),
    '... with its progress ("1/4 voice (supertonic)", to 100 %)', shown.filter((p) => /voice/.test(p.stage)).slice(-1));

  // "download": "p2p" means QVAC's network only, and an empty modelMirror means no mirror
  config.download = 'p2p';
  check(engine.models().filter((x) => x.mirror).length === 0, '"download": "p2p": no mirror');
  config.download = 'http';
  config.modelMirror = '';
  server.close();
}
delete process.env.FAKE_P2P;

// — the models offered in the window (config.json "choices") —
const offer = engine.choices();
const small = offer.asr.find((c) => c.src === 'WHISPER_SMALL_Q8_0');
check(offer.asr.length === 4 && offer.llm.length === 5 && small.default && small.here === true && small.size === fake.WHISPER_SMALL_Q8_0.expectedSize,
  'choices: 4 speech recognitions and 5 language models; Whisper small is the default, on this computer, with its size', offer.asr);
check(offer.llm.filter((c) => c.default).map((c) => c.src).join() === 'QWEN3_1_7B_INST_Q4' && offer.llm.every((c) => c.here === false && c.size > 0 && !c.p2pOnly && /—/.test(c.label)),
  'choices: the others are to download (over HTTPS), with a size and a label', offer.llm);
const llmLoads = () => fake.calls.filter((c) => c.fn === 'loadModel' && c.modelType === 'llm');
let n = llmLoads().length;
await engine.prepare({ ...config.defaults, localLlm: 'QWEN3_600M_INST_Q4' }, () => {});
check(llmLoads().length === n + 1 && llmLoads()[n].src === 'https://huggingface.co/unsloth/Qwen3-0.6B-GGUF/resolve/x/Qwen3-0.6B-Q4_0.gguf' && engine.info().models.llm === 'QWEN3_600M_INST_Q4',
  'choices: localLlm loads that model, from Hugging Face (a /blob/ path made a download link)', llmLoads()[n]);
n = llmLoads().length;
await engine.prepare({ ...config.defaults, localLlm: 'https://example.com/anything.gguf' }, () => {});
check(llmLoads().length === n + 1 && /Qwen3-1\.7B/.test(llmLoads()[n].src), 'choices: a model config.json does not offer (a shared persona file) → the default one instead', llmLoads()[n]);
const unloads = fake.calls.filter((c) => c.fn === 'unloadModel').length;
n = llmLoads().length;
await engine.prepare({ ...config.defaults, llm: 'farm', llmUrl: 'http://192.168.1.20:4000/v1' }, () => {});
check(llmLoads().length === n && fake.calls.filter((c) => c.fn === 'unloadModel').length === unloads + 1 && engine.info().models.llm === '',
  'farm: with an LLM farm chosen, the local language model is unloaded (its memory freed), none loads', engine.info().models);
await engine.prepare({ ...config.defaults, llm: 'local' }, () => {});
check(llmLoads().length === n + 1 && engine.info().models.llm === 'QWEN3_1_7B_INST_Q4', 'farm: back to the local model → it loads again', engine.info().models);
const asrLoads = () => fake.calls.filter((c) => c.fn === 'loadModel' && c.modelType === 'whisper');
n = asrLoads().length;
await engine.prepare({ ...config.defaults, localAsr: 'WHISPER_TINY_Q8_0' }, () => {});
check(asrLoads().length === n + 1 && /ggml-tiny-q8_0/.test(asrLoads()[n].src) && engine.models().some((m) => m.name === 'WHISPER_TINY_Q8_0'),
  'choices: localAsr reloads speech recognition with that model ("Download all models" then fetches it too)', asrLoads()[n]);
// — the server: a warm-up that fails (the voice cannot download) is not final —
delete process.env.FAKE_P2P;
process.env.FAKE_LOAD_FAIL = 'tts';
const { startServer } = await import(pathToFileURL(join(ROOT, 'app', 'src', 'app-server.mjs')).href);
const srv = await startServer({ config, port: 19900 + Math.floor(Math.random() * 90), log: () => {} });
await srv.ready;
const health = async () => (await fetch(`http://127.0.0.1:${srv.port}/health`)).json();
const h1 = await health();
check(h1.models === 'ready' && /fake: this download is blocked \(Click Start to try again\.\)/.test(h1.error || ''), 'warm-up failed: the lab window says so, and to click Start', h1);
check(srv.models().length === 8, '... and the models can still be listed (to offer "Download all models")', srv.models().length);
const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/voice`);
const msgs = [];
ws.onmessage = (e) => { if (typeof e.data === 'string') msgs.push(JSON.parse(e.data)); };
await new Promise((r) => { ws.onopen = r; });
ws.send(JSON.stringify({ type: 'start', settings: { ...config.defaults, name: 'Test', persona: 'A test.' } }));
const t1 = Date.now();
while (!msgs.some((m) => m.type === 'ready' || (m.type === 'error' && m.fatal)) && Date.now() - t1 < 5000) await new Promise((r) => setTimeout(r, 50));
check(msgs.some((m) => m.type === 'ready') && !msgs.some((m) => m.type === 'error' && m.fatal), 'Start loads the voice again, and the conversation opens', msgs.filter((m) => m.type !== 'status'));
check((await health()).error === null, '... and the error is gone');
ws.close();
await srv.close();
check(fake.getProblems().length === 0, 'the adapter calls the SDK with the right options', fake.getProblems());

rmSync(home, { recursive: true, force: true });
process.exit(summary() ? 1 : 0);
