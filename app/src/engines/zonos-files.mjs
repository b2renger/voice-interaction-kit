// The files Zonos's in-browser engine needs, served to the studio's window (config.json, "models.tts.zonos"):
//   /zonos/engine/…   the engine itself (engine.js, worker.js, codec-worker.js), built from Zyphra's sources by
//                     scripts/build-zonos-engine.mjs into app/zonos-engine/ ("engineDir"). The installers carry it.
//   /zonos/models/…   its model (the web/ folder of huggingface.co/Zyphra/ZONOS3-Mini: about 1 GB for the first
//                     voice). A file is downloaded once from "models" (a URL), kept in "modelsDir"
//                     (~/.qvac/models/zonos3-web, next to the other models), and served from there ever after:
//                     once downloaded, the voice works offline. "models": "" = never download.
//                     The engine also asks for optional parts and takes a 404 as "there is none" (any other
//                     failure stops it): what the source does not have is remembered (absent.json), so that
//                     the answer is the same offline.
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const ZONOS_MODELS_URL = 'https://huggingface.co/Zyphra/ZONOS3-Mini/resolve/main/web/';
const TYPES = { '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.wasm': 'application/wasm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' };

/** `rel` inside `dir`, or null when it would leave it. */
function inside(dir, rel) {
  if (!rel || rel.includes('\0') || rel.includes('\\')) return null;
  const root = resolve(dir);
  const file = resolve(root, `.${sep}${rel}`);
  return file.startsWith(root + sep) ? file : null;
}

function sendFile(req, res, file, cache) {
  const size = statSync(file).size;
  res.writeHead(200, { 'content-type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream', 'content-length': size, 'cache-control': cache });
  if (req.method === 'HEAD') { res.end(); return; }
  createReadStream(file).on('error', () => res.destroy()).pipe(res);
}
const notFound = (res, text = 'Not found') => { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }); res.end(text); };

/**
 * @param {{engineDir?: string, modelsDir?: string, models?: string}} cfg  @param {string} appDir  the app's folder
 */
export function createZonosFiles(cfg = {}, appDir, log = () => {}) {
  const engineDir = resolve(appDir, String(cfg.engineDir || 'zonos-engine'));
  const modelsDir = resolve(String(cfg.modelsDir || join(homedir(), '.qvac', 'models', 'zonos3-web')));
  const upstream = cfg.models === '' ? '' : String(cfg.models || ZONOS_MODELS_URL).replace(/\/*$/, '/');
  const downloads = new Map();      // rel → the download in progress (one at a time per file)
  let announced = false;
  // what the source said it does not have: {rel: when}. Asked again after a week (it may have been added since).
  const absentFile = join(modelsDir, 'absent.json');
  const ABSENT_FOR_MS = 7 * 24 * 3600 * 1000;
  let absent = null;
  const absentList = () => { if (!absent) { try { absent = JSON.parse(readFileSync(absentFile, 'utf8')); } catch { absent = {}; } } return absent; };
  const remember = (rel) => { absentList()[rel] = Date.now(); try { mkdirSync(modelsDir, { recursive: true }); writeFileSync(absentFile, JSON.stringify(absent)); } catch { /* read-only folder: asked again next time */ } };

  /** Downloads `rel` into the models folder. Resolves to its HTTP status when the source does not have it. */
  function download(rel, file) {
    if (downloads.has(rel)) return downloads.get(rel);
    const job = (async () => {
      const r = await fetch(upstream + rel.split('/').map(encodeURIComponent).join('/'));
      if (!r.ok || !r.body) { try { await r.body?.cancel(); } catch { /* closed */ } if (r.status === 404) remember(rel); return r.status || 502; }
      if (!announced) { announced = true; log(`▸ Zonos voice: downloading its model into ${modelsDir} (once; about 1 GB)`); }
      mkdirSync(dirname(file), { recursive: true });
      const part = `${file}.part`;
      try {
        await pipeline(Readable.fromWeb(r.body), createWriteStream(part));
        const expected = Number(r.headers.get('content-length'));
        if (expected && !r.headers.get('content-encoding') && statSync(part).size !== expected) throw new Error(`incomplete (${statSync(part).size} of ${expected} bytes)`);
        renameSync(part, file);
      } catch (e) { rmSync(part, { force: true }); throw e; }
      return 200;
    })().finally(() => downloads.delete(rel));
    downloads.set(rel, job);
    return job;
  }

  return {
    engineDir, modelsDir, upstream,
    /** Is the engine in this copy of VIK? */
    enginePresent: () => existsSync(join(engineDir, 'engine.js')),
    /** Answers GET/HEAD /zonos/engine/… and /zonos/models/…; false when the path is not one of them. */
    handle(req, res, path) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return false;
      if (path.startsWith('/zonos/engine/')) {
        const file = inside(engineDir, path.slice('/zonos/engine/'.length));
        if (!file || !existsSync(file) || !statSync(file).isFile()) notFound(res, 'The Zonos engine is not in this copy of VIK.');
        else sendFile(req, res, file, 'no-store');
        return true;
      }
      if (!path.startsWith('/zonos/models/')) return false;
      const rel = path.slice('/zonos/models/'.length);
      const file = inside(modelsDir, rel);
      if (!file) { notFound(res); return true; }
      if (existsSync(file) && statSync(file).isFile()) { sendFile(req, res, file, 'no-store'); return true; }
      if (!upstream) { notFound(res); return true; }
      const since = absentList()[rel];
      if (since && Date.now() - since < ABSENT_FOR_MS) { notFound(res); return true; }
      download(rel, file).then((status) => {
        if (status === 200) sendFile(req, res, file, 'no-store');
        else { res.writeHead(status === 404 ? 404 : 502, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }); res.end(status === 404 ? 'Not found' : `The model's source answered ${status}.`); }
      }, (e) => {
        if (since) { notFound(res); return; }           // known to be absent, and the source cannot be asked: still absent
        log(`✖ Zonos voice: could not download ${rel} — ${e.message}`);
        if (!res.headersSent) { res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }); res.end(`Download failed: ${e.message}`); } else res.destroy();
      });
      return true;
    },
  };
}
