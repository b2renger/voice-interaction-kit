// Tests for the text module (2_qvac_local/src/text.mjs) and its consistency with the browser core.
//   node tests/test-text.mjs
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { check, summary, ROOT } from './helpers.mjs';
import { nextSentences, speakable, heardNothing, parseTag, ReplyParser, systemPrompt, classifyInterjection, isBackchannel, isStopPhrase } from '../2_qvac_local/src/text.mjs';

// — sentences —
let r = nextSentences('Hello! I am Ada. How', 0);
check(JSON.stringify(r.sentences) === JSON.stringify(['Hello!', 'I am Ada.']), 'sentences: cut at sentence ends', r.sentences);
r = nextSentences('Hello! I am Ada. How are you?', r.next, true);
check(JSON.stringify(r.sentences) === JSON.stringify(['How are you?']), 'sentences: the rest at the end', r.sentences);
check(nextSentences('It is 3.5 degrees. ', 0).sentences[0] === 'It is 3.5 degrees.', 'sentences: "3.5" does not cut');
check(nextSentences('Call Mr. Smith tomorrow. ', 0).sentences.length === 1 && nextSentences('Appelle M. Dupont demain. ', 0).sentences.length === 1,
  'sentences: "Mr." (and French "M.") does not cut');
const long = `${'word '.repeat(20)}again, ${'and then '.repeat(20)}`;
check(nextSentences(long, 0).sentences[0].endsWith('again,'), 'sentences: a sentence that is too long is cut at a comma');

// — voice —
check(speakable('**Hello** _you_! See [the site](https://x.org) 🙂') === 'Hello you! See the site', 'voice: no markdown, link or emoji');
check(speakable('# Title\n- one\n- two') === 'Title one two', 'voice: no headings or bullets');
check(speakable('<think>hmm</think>Yes.') === 'Yes.', 'voice: no model reasoning');

// — heard nothing —
for (const s of ['...', 'Subtitles by the Amara.org community', 'Merci d\'avoir regardé !', 'Thanks for watching!', '[Music]']) check(heardNothing(s), `heard nothing: "${s}"`);
for (const s of ['Yes', 'No thanks.', 'Thanks for watching my drawing, what do you think?']) check(!heardNothing(s), `heard: "${s}"`);

// — tags —
check(JSON.stringify(parseTag('choices: Painting | Sculpture')) === JSON.stringify({ type: 'ui.choices', question: '', options: ['Painting', 'Sculpture'] }), 'choices tag');
check(parseTag('mood: Happy').mood === 'happy', 'mood tag');
check(parseTag('note: nothing') === null, 'unknown tag ignored');

// — streaming (the French tags [[choix: …]] and [[humeur: …]] are still accepted, mapped to English) —
const p = new ReplyParser();
const pieces = ['<thi', 'nk>\nlet me think</th', 'ink>\n\nHello! Would you rather see', ' the painting or the sculpture? [[cho', 'ix: Painting | Sculpture]] [[humeur: curieux]]'];
const said = []; const ui = [];
for (const piece of pieces) { const o = p.push(piece); said.push(...o.sentences); ui.push(...o.ui); }
const end = p.end(); said.push(...end.sentences); ui.push(...end.ui);
check(JSON.stringify(said) === JSON.stringify(['Hello!', 'Would you rather see the painting or the sculpture?']), 'streaming: sentences said in order, without reasoning or tags', said);
check(ui.length === 2 && ui[0].type === 'ui.choices' && ui[0].options[1] === 'Sculpture' && ui[1].mood === 'curious', 'streaming: tags → events (French aliases mapped to English)', ui);
check(p.text === 'Hello! Would you rather see the painting or the sculpture?', 'streaming: clean text shown', p.text);
const q = new ReplyParser();
q.push('The price is [about] 3 euros.');
check(q.end() && q.text === 'The price is [about] 3 euros.', 'streaming: ordinary brackets stay', q.text);
const z = new ReplyParser();
const zs = [...z.push('End without a period').sentences, ...z.end().sentences];
check(zs[0] === 'End without a period', 'streaming: the last sentence without punctuation is said');

// — what is said over the agent (interruptAfterMs): carry on, stop, or a real interruption —
{
  const kinds = (list) => list.map((t) => classifyInterjection(t));
  const enBack = ['Mm-hmm.', 'Mmmm hmm!', 'Uh-huh', 'Yeah, yeah.', 'Oh, okay.', 'I see.', 'All right.', 'Got it!', 'Right.', 'Sure'];
  const frBack = ['Oui.', 'Ouais', 'D\'accord.', 'Mmh…', 'Ah oui !', 'Je vois.', 'Ah bon ?', 'Super !', 'Voilà.'];
  check(kinds(enBack).every((k) => k === 'backchannel'), 'backchannels (en): "mm-hmm", "yeah, yeah", "oh, okay"…', kinds(enBack));
  check(kinds(frBack).every((k) => k === 'backchannel'), 'backchannels (fr): "oui", "d\'accord", "ah bon ?"…', kinds(frBack));
  const enStop = ['Stop!', 'Wait, wait.', 'Hold on.', 'Hang on', 'Be quiet!', 'Stop talking.', 'One second.', 'No, stop.', 'Please wait'];
  const frStop = ['Stop !', 'Attends !', 'Arrête.', 'Arrête-toi !', 'Chut…', 'Une seconde.', 'Un instant.'];
  check(kinds(enStop).every((k) => k === 'stop'), 'stop phrases (en): "stop", "wait, wait", "hold on", "no, stop"…', kinds(enStop));
  check(kinds(frStop).every((k) => k === 'stop'), 'stop phrases (fr): "attends", "arrête-toi", "chut"…', kinds(frStop));
  check(kinds(['', '...', '(coughs)', '[BLANK_AUDIO]', 'Thanks for watching!']).every((k) => k === 'noise'), 'noise: empty, "(coughs)", Whisper\'s hallucinations');
  const others = ['What time is it?', 'Yes, tell me more about the painting.', 'Okay but where is the exit?', 'Stop the music and tell me a story', 'Yes yes yes yes', 'Nice painting'];
  check(kinds(others).every((k) => k === 'other'), 'anything else is a real interruption (questions, long sentences, more than 3 words)', kinds(others));
  check(isBackchannel('Yeah okay sure') && !isBackchannel('Yeah okay sure right'), 'backchannel: a whole utterance of at most 3 words');
  check(!isStopPhrase('Okay') && isStopPhrase('Okay, stop'), 'stop: needs a stop phrase, may come with a backchannel');
}

// — the same prompt on both sides —
const core = readFileSync(join(ROOT, 'common', 'voice-core.js'), 'utf8');
const ctx = {};
vm.runInNewContext(core + ';this.VC = VoiceCore;', ctx);
const s = Object.assign({}, ctx.VC.DEFAULTS, { name: 'Zoe', persona: 'Gardener.', language: 'fr', speakingStyle: 'slow' });
check(ctx.VC._.systemPrompt(s, 'local') === systemPrompt(s, 'local'), 'prompt: identical in the browser and the backend (local)');
check(ctx.VC._.systemPrompt(s, 'gemini') === systemPrompt(s, 'gemini'), 'prompt: identical (gemini)');

// Gemini tools: JSON text (a settings field), or already an array (written as is in a persona file)
const decl = [{ name: 'change_color', description: 'Changes the color of the scene.' }];
check(ctx.VC._.parseExtraTools(JSON.stringify(decl)).list.length === 1, 'tools: as JSON text');
const fromArray = ctx.VC._.parseExtraTools(decl);
check(fromArray.list.length === 1 && fromArray.error === null, 'tools: as an array, from a persona file', fromArray);

process.exit(summary() ? 1 : 0);
