// SIMULATED engine: same interface as the QVAC engine, without any model.
// It is for testing the whole chain (and designing the interface) while the real models download:
//   - "recognition": an energy detector that writes ready-made sentences (a short burst of sound,
//     under 450 ms, is heard as "Mm-hmm.", a backchannel: to try "Talk over it this long to interrupt");
//   - "model": ready-made replies, sent word by word (sometimes with choices and a mood);
//   - "voice": a synthetic voice hum, as long as the sentence (a different timbre per local voice engine).
import { AsyncQueue, rmsS16, clamp, num } from '../util.mjs';

const HEARD = [
  'Hello, can you tell me about this room?',
  'What do you recommend I look at?',
  'I prefer the sculpture.',
  'Thanks, that\'s very clear.',
];
const REPLIES = [
  'Hello! Welcome to the great gallery. Would you like to start with painting or sculpture? [[choices: Painting | Sculpture]] [[mood: happy]]',
  'I recommend the big painting at the back, it tells the story of a storm. Shall I describe it? [[choices: Yes | No thanks]]',
  'Great choice. The statue by the window was carved from a single block of marble. [[mood: excited]]',
  'My pleasure. Feel free to ask if you have another question.',
];

// Test hooks (environment, or "mock" in config.json):
//   MOCK_LLM_DELAY_MS (mock.llmDelayMs) an extra delay before the model's first word (default 0): a slow reply,
//                                       to try the spoken fillers
//   MOCK_SHORT_TEXT (mock.shortText)    what a short burst is heard as (default "Mm-hmm.")
const SHORT_SEGMENT_MS = 450;

export async function createMockEngine(config = {}) {
  const mc = (config && config.mock) || {};
  const shortText = String(process.env.MOCK_SHORT_TEXT || mc.shortText || 'Mm-hmm.');
  const llmDelayMs = clamp(num(process.env.MOCK_LLM_DELAY_MS != null ? process.env.MOCK_LLM_DELAY_MS : mc.llmDelayMs, 0), 0, 60000);
  let loaded = false;
  let heardIndex = 0;
  let replyIndex = 0;
  let voiceEngine = 'supertonic';
  return {
    name: 'mock',
    info() {
      return {
        engine: 'mock',
        voiceEngine,
        voices: voiceEngine === 'supertonic' ? ['F1', 'F2', 'F3', 'F4', 'F5', 'M1', 'M2', 'M3', 'M4', 'M5'] : [],
        models: { asr: 'simulated', llm: 'simulated', tts: `simulated (${voiceEngine})` },
      };
    },

    // Each conversation replays the same little script from the start: a demo repeats identically.
    newConversation() { heardIndex = 0; replyIndex = 0; },

    async prepare(settings, onProgress) {
      voiceEngine = ['parler', 'chatterbox'].includes(settings && settings.localVoiceEngine) ? settings.localVoiceEngine : 'supertonic';
      if (loaded) return;
      for (const [stage, p] of [['recognition', 50], ['recognition', 100], ['model', 100], ['voice', 100]]) {
        onProgress && onProgress({ stage, progress: p });
        await new Promise((r) => setTimeout(r, 40));
      }
      loaded = true;
    },

    openAsr(opts, cb) {
      const th = opts.startSensitivity === 'low' ? 0.06 : 0.03;
      const endSilence = clamp(num(opts.endSilenceMs, 800), 200, 5000);
      let speaking = false; let aboveMs = 0; let belowMs = 0; let segMs = 0; let textSent = true; let eotSent = true;
      let carry = Buffer.alloc(0);
      let closed = false;
      const BLOCK = 1600;                                    // 50 ms at 16 kHz, in bytes
      return {
        write(buf) {
          if (closed) return;
          carry = carry.length ? Buffer.concat([carry, buf]) : buf;
          while (carry.length >= BLOCK) {
            const block = carry.subarray(0, BLOCK);
            carry = carry.subarray(BLOCK);
            const level = rmsS16(block);
            if (level > th) {
              aboveMs += 50; belowMs = 0;
              if (!speaking && aboveMs >= 150) { speaking = true; segMs = aboveMs; textSent = false; eotSent = false; cb.onVad(true); }
              else if (speaking) segMs += 50;
            } else {
              aboveMs = 0;
              if (speaking || !eotSent) belowMs += 50;
              if (speaking && belowMs >= 300) {
                speaking = false; cb.onVad(false);
                if (!textSent) {
                  textSent = true;
                  const t = segMs < SHORT_SEGMENT_MS ? shortText : HEARD[heardIndex++ % HEARD.length];
                  setTimeout(() => { if (!closed) cb.onText(t); }, 120);   // "recognition" takes a little time
                }
              }
              if (!speaking && !eotSent && belowMs >= endSilence) { eotSent = true; cb.onEndOfTurn(); }
            }
          }
        },
        close() { closed = true; },
      };
    },

    generate({ onDelta }) {
      const text = REPLIES[replyIndex++ % REPLIES.length];
      const words = text.split(/(?<=\s)/);
      let cancelled = false;
      let timer = 0;
      const t0 = Date.now();
      let first = null;
      const done = new Promise((resolve) => {
        let i = 0;
        const step = () => {
          if (cancelled) { resolve({ text: words.slice(0, i).join(''), firstTokenMs: first, cancelled: true }); return; }
          if (i >= words.length) { resolve({ text, firstTokenMs: first }); return; }
          if (first === null) first = Date.now() - t0;
          onDelta(words[i++]);
          timer = setTimeout(step, 30);
        };
        timer = setTimeout(step, 350 + llmDelayMs);           // "thinking time"
      });
      return { done, cancel() { cancelled = true; clearTimeout(timer); } };
    },

    speak({ voice, speed, engine }) {
      const q = new AsyncQueue();
      const rate = engine === 'parler' ? 44100 : 24000;               // like the real engines (Supertonic: 24 kHz here)
      const f0 = engine === 'parler' ? 170 : engine === 'chatterbox' ? 150 : String(voice || 'F1').startsWith('M') ? 115 : 205;
      const sp = engine === 'parler' ? 1 : clamp(num(speed, 1), 0.5, 2);
      let chain = Promise.resolve();
      let cancelled = false;
      return {
        frames: q,
        write(sentence) {
          chain = chain.then(async () => {
            if (cancelled) return;
            const sec = clamp((0.06 * sentence.length) / sp, 0.4, 7);
            const pcm = syntheticVoice(sec, f0, rate);
            const frame = Math.round(0.25 * rate);
            for (let i = 0; i < pcm.length && !cancelled; i += frame) {
              q.push({ pcm: pcm.subarray(i, i + frame), sampleRate: rate, text: i === 0 ? sentence : '' });
              await new Promise((r) => setTimeout(r, 15));          // faster than real time, like a real TTS
            }
          });
        },
        end() { chain = chain.then(() => q.end()); },
        cancel() { cancelled = true; q.end(); },
      };
    },

    async close() {},
  };
}

function syntheticVoice(seconds, f0, rate) {
  const n = Math.round(seconds * rate);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const syll = Math.max(0, Math.sin(2 * Math.PI * 4.5 * t));
    const env = Math.min(1, t * 20, (seconds - t) * 20);
    const f = f0 * (1 + 0.08 * Math.sin(2 * Math.PI * 0.8 * t));
    const v = 0.3 * env * syll * (Math.sin(2 * Math.PI * f * t) + 0.5 * Math.sin(4 * Math.PI * f * t) + 0.2 * Math.sin(6 * Math.PI * f * t)) / 1.7;
    out[i] = Math.round(clamp(v, -1, 1) * 32767);
  }
  return out;
}
