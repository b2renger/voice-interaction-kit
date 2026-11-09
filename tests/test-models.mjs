// The models on this computer, with the QVAC adapter on the fake SDK: a QVAC download is found by its name
// and size and loaded from its path (no network), and "Download all models" downloads only the missing ones,
// giving up on a peer-to-peer download that receives nothing.
//   node tests/test-models.mjs
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { ROOT, check, summary } from './helpers.mjs';

// a home folder of our own, set before the engine is imported (it reads ~/.qvac/models)
const home = mkdtempSync(join(tmpdir(), 'voice-lab-home-'));
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

const { loadConfig } = await import(pathToFileURL(join(ROOT, '2_qvac_local', 'src', 'config.mjs')).href);
const { createQvacEngine } = await import(pathToFileURL(join(ROOT, '2_qvac_local', 'src', 'engines', 'qvac.mjs')).href);
const config = loadConfig(join(home, 'none.json'));
const logs = [];
const engine = await createQvacEngine(config, (m) => logs.push(m));
check(process.env.QVAC_RPC_INIT_TIMEOUT_MS === '180000', 'the QVAC worker gets 3 minutes to start (a cold start), not 30 s', process.env.QVAC_RPC_INIT_TIMEOUT_MS);

// — what is on this computer —
const list = engine.models();
const byName = (n) => list.find((m) => m.name === n);
check(list.length === 7 && byName('TTS_S3GEN_MULTILINGUAL_CHATTERBOX_Q4_0'), 'the models: recognition, detection, language, and the 3 voices (Chatterbox in 2 files)', list.map((m) => m.name));
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

// — "Download all models", on a network that blocks peer-to-peer —
process.env.FAKE_P2P = 'blocked';
const progress = [];
const t0 = Date.now();
const failed = await engine.install((p) => progress.push(p), 1);
const dl = fake.calls.filter((c) => c.fn === 'downloadAsset');
check(dl.length === 6 && !dl.some((c) => /ggml-small/.test(c.src)), 'downloads the 6 missing models, not Whisper', dl.map((c) => c.src));
check(dl.filter((c) => /^https:\/\/huggingface\.co\//.test(c.src)).length === 2, 'Silero and Qwen3 over HTTPS (default "http")');
check(failed.length === 4 && failed.every((m) => m.p2pOnly), 'the 4 voice files, receiving nothing, are reported as failed', failed.map((m) => m.name));
check(fake.calls.filter((c) => c.fn === 'cancel').length === 4 && Date.now() - t0 < 15000, 'each stalled download is cancelled, in time', Date.now() - t0);
check(logs.some((l) => /peer-to-peer network \(this network seems to block it\)/.test(l)), 'the log says the network seems to block peer-to-peer', logs);
check(progress.some((p) => p.stage === '1/6 voice detection'), 'the progress names each model ("1/6 voice detection")', progress.slice(0, 3));
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
await engine.prepare({ ...config.defaults, llmFarm: 'http://192.168.1.20:4000/v1' }, () => {});
check(llmLoads().length === n && fake.calls.filter((c) => c.fn === 'unloadModel').length === unloads + 1 && engine.info().models.llm === '',
  'farm: with an LLM farm chosen, the local language model is unloaded (its memory freed), none loads', engine.info().models);
await engine.prepare({ ...config.defaults, llmFarm: '' }, () => {});
check(llmLoads().length === n + 1 && engine.info().models.llm === 'QWEN3_1_7B_INST_Q4', 'farm: back to the local model → it loads again', engine.info().models);
const asrLoads = () => fake.calls.filter((c) => c.fn === 'loadModel' && c.modelType === 'whisper');
n = asrLoads().length;
await engine.prepare({ ...config.defaults, localAsr: 'WHISPER_TINY_Q8_0' }, () => {});
check(asrLoads().length === n + 1 && /ggml-tiny-q8_0/.test(asrLoads()[n].src) && engine.models().some((m) => m.name === 'WHISPER_TINY_Q8_0'),
  'choices: localAsr reloads speech recognition with that model ("Download all models" then fetches it too)', asrLoads()[n]);
// — the server: a warm-up that fails (the voice cannot download) is not final —
delete process.env.FAKE_P2P;
process.env.FAKE_LOAD_FAIL = 'tts';
const { startServer } = await import(pathToFileURL(join(ROOT, '2_qvac_local', 'src', 'app-server.mjs')).href);
const srv = await startServer({ config, port: 19900 + Math.floor(Math.random() * 90), log: () => {} });
await srv.ready;
const health = async () => (await fetch(`http://127.0.0.1:${srv.port}/health`)).json();
const h1 = await health();
check(h1.models === 'ready' && /fake: this download is blocked \(Click Start to try again\.\)/.test(h1.error || ''), 'warm-up failed: the lab window says so, and to click Start', h1);
check(srv.models().length === 7, '... and the models can still be listed (to offer "Download all models")', srv.models().length);
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
