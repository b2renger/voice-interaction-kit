// Talk: the conversation as it happens. The agent's presence, the words, the choices, and why it answered
// (the decision model's events). Also the hub: this window is the brain, the clients (cables, p5.js, pages)
// follow it and drive it (CONTRACT.md, "The clients protocol").
import { $, h, seconds, pct } from './ui.js';
import { settings } from './state.js';

const STATE_WORDS = { idle: 'ready', connecting: 'connecting', listening: 'listening', hearing: 'hearing you', thinking: 'thinking', speaking: 'speaking', ended: 'ended', error: 'something went wrong' };
const LIVE_WORDS = { idle: 'Ready', connecting: 'Connecting', listening: 'Listening', hearing: 'Hearing you', thinking: 'Thinking', speaking: 'Speaking', ended: 'Ended', error: 'Error' };

/** The banner above the words: a status, a warning, an error; with a progress bar while models load. */
export function banner(kind, text, progress) {
  const b = $('#banner');
  b.hidden = !text;
  b.className = `banner${kind ? ` ${kind}` : ''}`;
  b.textContent = text || '';
  if (text && typeof progress === 'number') {
    const p = Math.round(Math.min(100, Math.max(0, progress)));
    b.append(h('div', { class: 'bar', role: 'progressbar', 'aria-valuenow': p, 'aria-valuemin': 0, 'aria-valuemax': 100 }, h('i', { style: `width:${p}%` })));
  }
}

export function initTalk(agent) {
  let mood = 'neutral';
  let lastDecision = null;        // the turn being written in the trace: its stage and signals go under it
  const stateWord = () => { const st = agent.state; $('#stateWord').textContent = `${STATE_WORDS[st] || st}${mood !== 'neutral' && ['listening', 'hearing', 'thinking', 'speaking'].includes(st) ? `, ${mood}` : ''}`; };

  // — the state: everywhere (the top bar too, so you can talk from any view) —
  agent.on('state', (ev) => {
    const st = ev.state;
    stateWord();
    $('#liveState').textContent = LIVE_WORDS[st] || st;
    $('#live').dataset.state = st;
    const live = ['listening', 'hearing', 'thinking', 'speaking'].includes(st);
    $('#start').hidden = live || st === 'connecting';
    $('#stop').hidden = !(live || st === 'connecting');
    $('#start').disabled = st === 'connecting';
    $('#interrupt').disabled = !(st === 'thinking' || st === 'speaking');
    if (!live) $('#liveCaption').textContent = '';
  });
  agent.on('start', () => { banner('', ''); });
  agent.on('status', (ev) => { if (ev.text) banner('', ev.text, ev.progress); else banner('', ''); });
  agent.on('error', (ev) => banner(ev.fatal ? 'err' : 'warn', ev.message));

  // — the words —
  agent.on('user.start', () => { $('#userCap').textContent = '…'; });
  agent.on('user.partial', (ev) => { $('#userCap').textContent = ev.text; $('#liveCaption').textContent = `You: ${ev.text}`; });
  agent.on('user.text', (ev) => { $('#userCap').textContent = ev.text; });
  agent.on('not.understood', () => { $('#userCap').textContent = '(not understood)'; });
  agent.on('thinking', () => { $('#botCap').textContent = '…'; clearChoices(); });
  agent.on('bot.text', (ev) => { $('#botCap').textContent = ev.text; $('#liveCaption').textContent = `${settings().name || 'Agent'}: ${ev.text}`; });
  agent.on('bot.start', (ev) => { if (ev.waitMs != null) $('#mWait').textContent = seconds(ev.waitMs); });
  agent.on('ui.choices', (ev) => showChoices(ev.question, ev.options));
  agent.on('ui.mood', (ev) => { mood = ev.mood; stateWord(); });
  agent.on('ended', () => { mood = 'neutral'; lastDecision = null; });
  agent.on('turn', (ev) => {
    $('#mTurns').textContent = agent.conversation().length;
    if (ev.ms.speech != null) $('#mSpeech').textContent = seconds(ev.ms.speech);
    if (lastDecision && ev.ms.firstSound != null) {
      lastDecision.append(h('p', { class: 'note' }, `Felt wait ${seconds(ev.ms.firstSound)}, whole reply ${seconds(ev.ms.total)}${ev.interrupted ? ', cut off' : ''}.`));
      lastDecision = null;
    }
  });

  function clearChoices() { $('#choices').replaceChildren(); }
  function showChoices(question, options) {
    $('#choices').replaceChildren(
      question ? h('div', { class: 'q' }, question) : '',
      ...options.map((o) => h('button', { type: 'button', onclick: () => { clearChoices(); agent.choose(o); } }, o)),
    );
  }

  // — why it answered: the decision model's choices, the stages, the signals —
  const trace = $('#trace');
  const add = (li) => { trace.prepend(li); while (trace.children.length > 60) trace.lastChild.remove(); $('#traceHint').hidden = true; return li; };
  agent.on('decision', (d) => {
    const took = d.pattern
      ? [d.kind === 'otherwise' ? `Otherwise: ${d.pattern.name}` : d.pattern.name, d.entry ? h('span', {}, d.entry.key) : '',
        d.score != null ? h('span', { class: 'score' }, pct(d.score)) : '']
      : ['A free answer'];
    const others = d.candidates.filter((c) => !d.pattern || c.id !== d.pattern.id || (c.entry && d.entry && c.entry.key !== d.entry.key)).slice(0, 3);
    lastDecision = add(h('li', {},
      d.text ? h('p', { class: 'said' }, `“${d.text}”`) : h('p', { class: 'said' }, d.pattern && d.pattern.kind === 'signal' ? 'A signal' : 'The conversation starts'),
      h('p', { class: 'took' }, took),
      d.kind === 'free' ? h('p', { class: 'note' }, 'No pattern was close enough: the language model answers, with what it knows.') : '',
      others.length ? h('p', { class: 'others' }, `Next: ${others.map((c) => `${c.name}${c.entry ? ` (${c.entry.key})` : ''} ${pct(c.score)}`).join(', ')}`) : '',
      d.matcher ? h('p', { class: 'note' }, `Stage ${d.stage}, decided by ${d.matcher} in ${d.ms} ms.`) : ''));
  });
  // under the turn that caused them; on their own otherwise
  const note = (text) => { if (lastDecision) lastDecision.append(h('p', { class: 'note' }, text)); else add(h('li', { class: 'event' }, text)); };
  agent.on('stage', (ev) => { if (ev.from) note(`Now in the stage ${ev.stage}.`); });
  agent.on('signal', (ev) => note(`Signal to the clients: ${ev.name}${ev.value ? ` = ${ev.value}` : ''}.`));
  agent.on('voice', (ev) => note(ev.voice ? `Now speaking with the voice “${ev.name}”.` : 'Back to its own voice.'));

  // — every event, for the curious —
  agent.on('*', (ev) => {
    if (ev.type === 'state') return;
    const detail = ev.text || ev.message || (ev.options ? ev.options.join(' | ') : '') || ev.mood || ev.stage || ev.name
      || (ev.type === 'turn.prediction' ? `p ${Number(ev.probability).toFixed(2)}, ${ev.complete ? 'complete' : 'not finished'}` : '')
      || (ev.type === 'user.away' ? `silent ${seconds(ev.afterMs)}, ${ev.count} times` : '') || '';
    const box = $('#events');
    box.prepend(h('div', {}, h('span', {}, (ev.t / 1000).toFixed(1)), h('span', {}, ev.type + (detail ? `: ${String(detail).slice(0, 90)}` : ''))));
    while (box.children.length > 150) box.lastChild.remove();
  });

  drawPresence(agent);
  return { hub: connectHub(agent) };
}

// — the presence: rings that breathe with the voices, in the colour of the state —
function drawPresence(agent) {
  const cv = $('#presence');
  const g = cv.getContext('2d');
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const colorOf = (st) => css({ listening: '--listen', hearing: '--hear', thinking: '--think', speaking: '--speak', error: '--fail' }[st] || '--idle');
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  const sm = { user: 0, bot: 0, r: 0 };
  const ripples = [];
  let lastRipple = 0;
  function frame(t) {
    const W = cv.width; const H = cv.height; const cx = W / 2; const cy = H / 2;
    const s = t / 1000;
    const st = agent.state;
    const lv = agent.levels();
    sm.user += (lv.user - sm.user) * 0.25;
    sm.bot += (lv.bot - sm.bot) * 0.3;
    const live = ['listening', 'hearing', 'thinking', 'speaking'].includes(st);
    let r = W * 0.16;
    if (!still.matches) {
      if (st === 'listening') r *= 1 + 0.03 * Math.sin(s * 1.4) + 0.18 * sm.user;
      if (st === 'hearing') r *= 1.04 + 0.4 * sm.user;
      if (st === 'thinking') r *= 0.92;
      if (st === 'speaking') r *= 1 + 0.45 * sm.bot;
    }
    sm.r += (r - sm.r) * 0.2;
    const level = st === 'speaking' ? sm.bot : sm.user;
    if (live && !still.matches && t - lastRipple > (st === 'thinking' ? 900 : 520 - 300 * level)) { ripples.push({ born: t, strength: 0.25 + level }); lastRipple = t; }
    g.clearRect(0, 0, W, H);
    g.save();
    const col = colorOf(st);
    // ripples: they leave the body and fade, faster when the voice is louder
    for (let i = ripples.length - 1; i >= 0; i--) {
      const age = (t - ripples[i].born) / 2600;
      if (age > 1) { ripples.splice(i, 1); continue; }
      g.strokeStyle = col;
      g.globalAlpha = (1 - age) * 0.5 * Math.min(1, ripples[i].strength);
      g.lineWidth = 2.5;
      g.beginPath(); g.arc(cx, cy, sm.r + age * W * 0.3, 0, Math.PI * 2); g.stroke();
    }
    g.globalAlpha = 1;
    // the body
    g.fillStyle = col;
    g.beginPath(); g.arc(cx, cy, sm.r, 0, Math.PI * 2); g.fill();
    // thinking: an arc that turns around the body
    if (st === 'thinking') {
      g.strokeStyle = col; g.lineWidth = 5; g.lineCap = 'round';
      const a = still.matches ? 0 : s * 3.2;
      g.beginPath(); g.arc(cx, cy, sm.r * 1.32, a, a + 1.1); g.stroke();
    }
    // a still ring when nothing happens
    if (!live) {
      g.strokeStyle = col; g.globalAlpha = 0.45; g.lineWidth = 2;
      g.beginPath(); g.arc(cx, cy, sm.r * 1.35, 0, Math.PI * 2); g.stroke();
    }
    g.restore();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

// — the hub: this window publishes the conversation; the clients' commands drive it —
function connectHub(agent) {
  let ws = null;
  let levels = '';
  const send = (m) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); };
  const info = () => { const s = settings(); send({ type: 'info', name: s.name || '', engine: s.engine }); };
  const command = (c) => {
    if (c.type === 'start') $('#start').click();
    else if (c.type === 'stop') $('#stop').click();
    else if (c.type === 'interrupt') agent.interrupt();
    else if (c.type === 'text') agent.sendText(c.text);
    else if (c.type === 'context') agent.sendContext(c.text);
    else if (c.type === 'choose') { $('#choices').replaceChildren(); agent.choose(c.option); }
    else if (c.type === 'tool.result') agent.sendToolResult(c.id, c.result);
    else if (c.type === 'signal') agent.sendSignal(c.name, c.value);
  };
  (function open() {
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/brain`);
    ws.onopen = info;
    ws.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.type === 'command' && m.command) command(m.command);
    };
    ws.onclose = (e) => { if (e.reason !== 'another lab window took over') setTimeout(open, 1000); };
  })();
  agent.on('*', (ev) => send({ type: 'event', event: ev }));
  setInterval(() => {                                   // the levels, about 30 times a second while they move
    const l = agent.levels();
    const u = Math.round(l.user * 1000) / 1000; const b = Math.round(l.bot * 1000) / 1000;
    if (`${u}/${b}` !== levels) { levels = `${u}/${b}`; send({ type: 'levels', user: u, bot: b }); }
  }, 33);
  return { info };
}
