// Takes the screenshots of the README (docs/screenshots/*.png): the studio in Chromium, on the example agent
// "Museum guide", with the SIMULATED engine (no model, no microphone: the replies of the patterns are the real
// ones, as written in the agent; the bottom-left corner of each picture says "Simulated engine").
//   node docs/screenshots/capture.mjs        (needs Playwright, like the browser tests: see tests/README.md)
// Run it again after a change to the studio's interface, and commit the pictures.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, loadPlaywright, makeFakeMicWav, until } from '../../tests/helpers.mjs';

const OUT = dirname(fileURLToPath(import.meta.url));
const port = 18650 + Math.floor(Math.random() * 200);
const url = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, [join(ROOT, 'app', 'src', 'server.mjs'), '--mock', '--port', String(port)],
  { env: { ...process.env, VIK_AGENTS: mkdtempSync(join(tmpdir(), 'vik-shots-')) }, stdio: 'ignore' });
process.on('exit', () => server.kill());
if (!(await until(async () => { try { return (await (await fetch(`${url}/health`)).json()).models === 'ready'; } catch { return false; } }, 15000))) throw new Error('the local server did not start');

const { chromium } = loadPlaywright();
// a silent microphone: Start needs one, the sentences are typed
const wav = makeFakeMicWav(join(tmpdir(), 'vik-shots-mic.wav'), { lead: 1, speech: 0, tail: 5 });
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`, '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1360, height: 860 }, deviceScaleFactor: 1 });
await page.goto(`${url}/`);
await page.waitForSelector('#agentSelect option[value="museum-guide"]', { state: 'attached' });
await page.selectOption('#agentSelect', 'museum-guide');
await until(() => page.evaluate(() => window.agent.settings.agent === 'museum-guide'), 5000);
await page.getByRole('button', { name: 'Not now' }).click();           // the tutorial's offer
const view = async (v) => { await page.click(`.nav button[data-view="${v}"]`); await page.waitForTimeout(400); };
const shot = async (name) => { await page.waitForTimeout(300); await page.screenshot({ path: join(OUT, `${name}.png`) }); console.log(`▸ ${name}.png`); };

// — Talk: a short conversation, and why the agent answered —
await view('talk');
await page.click('#start');
const live = () => page.evaluate(() => document.querySelector('#live').dataset.state);
const quiet = () => until(async () => (await live()) === 'listening', 30000);    // the agent has finished speaking
await until(async () => (await live()) !== 'idle', 15000);
await quiet();                                                           // its greeting is said
const say = async (text) => { await page.fill('#sayText', text); await page.keyboard.press('Enter'); };
await say('When do you open?');
await until(async () => (await live()) === 'speaking', 10000); await quiet();
await say('Tell me about the Water Lilies');
await until(async () => (await live()) === 'speaking', 10000); await quiet();
// the last one fires a pattern with a written line: with the simulated engine, a reply a language model would
// write is a stock sentence, which would not match the question in the picture
await say('How much is a ticket?');
await until(async () => (await live()) === 'speaking', 10000);           // pictured while it speaks
await page.waitForTimeout(900);
await page.evaluate(() => document.activeElement && document.activeElement.blur());
await shot('talk');
await page.click('#stop');
await page.waitForTimeout(600);

// — the four parts of an agent —
await view('persona');
await shot('persona');
await view('knowledge');
await page.locator('input[placeholder^="Say something"]').pressSequentially('who painted the Water Lilies?', { delay: 5 });
await page.waitForTimeout(1200);
await page.evaluate(() => document.activeElement && document.activeElement.blur());
await shot('knowledge');
await view('interactions');
await page.fill('#tryText', 'are you open on Sunday?');
await shot('interactions');
await view('voice');
await shot('voice');

// — this computer's settings: where the replies are written —
await view('settings');
await shot('settings');

// — saving and reopening: the Manage menu —
await view('persona');
await page.click('#agentMenuBtn');
await shot('manage');

await browser.close();
server.kill();
