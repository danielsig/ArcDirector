// Screenshots a page in headless Chrome once its title reads "ready" (WebGL works, no browser library).
//
//   node kindling/scripts/shoot.mjs <url> <out.png> [width=1200] [height=800]
//
// WAIT=<seconds> shoots after that long instead of waiting for the "ready" title.
// EVAL=<js> prints that expression's value from the page before the screenshot (for debugging).
// FRAMES=<n> EVERY=<seconds> takes n screenshots that far apart instead of one, to <out>-0.png, <out>-1.png, …
// PROFILE=<seconds> records a CPU profile that long (after WAIT/EVAL) and prints the functions with the most self time.
// Set CHROME to the browser binary when it is not in the usual Windows, macOS or Linux place.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [url, out, w = '1200', h = '800'] = process.argv.slice(2);
if (!url || !out) {
	console.error('usage: node shoot.mjs <url> <out.png> [width] [height]');
	process.exit(1);
}

const chrome = process.env.CHROME ?? [
	'C:/Program Files/Google/Chrome/Application/chrome.exe',
	'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
	'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
	'/usr/bin/google-chrome',
	'/usr/bin/chromium',
].find(existsSync);
if (!chrome) {
	throw new Error('no Chrome found; set CHROME');
}

const profile = await mkdtemp(join(tmpdir(), 'shoot-'));
const proc = spawn(chrome, [
	'--headless=new',
	'--remote-debugging-port=0',
	`--user-data-dir=${profile}`,
	`--window-size=${w},${h}`,
	'--hide-scrollbars',
	'--use-angle=default',
	'--ignore-gpu-blocklist',
	'about:blank',
]);

const wsURL = await new Promise((resolve, reject) => {
	let err = '';
	proc.stderr.on('data', (d) => {
		err += d;
		const m = /DevTools listening on (ws:\/\/\S+)/.exec(err);
		if (m) {
			resolve(m[1]);
		}
	});
	proc.on('exit', () => reject(new Error(`chrome exited: ${err}`)));
});

const browser = new WebSocket(wsURL);
await new Promise((r) => browser.addEventListener('open', r, { once: true }));
let nextID = 1;
const pending = new Map();
browser.addEventListener('message', (e) => {
	const msg = JSON.parse(e.data);
	if (msg.method === 'Runtime.exceptionThrown') {
		console.error('page error:', msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
	} else if (msg.method === 'Runtime.consoleAPICalled' && (msg.params.type === 'error' || msg.params.type === 'warning')) {
		console.error(`page ${msg.params.type}:`, msg.params.args.map((a) => a.value ?? a.description).join(' '));
	}
	pending.get(msg.id)?.(msg);
	pending.delete(msg.id);
});
function send(method, params = {}, sessionId) {
	const id = nextID++;
	browser.send(JSON.stringify({ id, method, params, sessionId }));
	return new Promise((resolve, reject) => pending.set(id, (m) => (m.error ? reject(new Error(m.error.message)) : resolve(m.result))));
}

try {
	const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
	const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
	await send('Emulation.setDeviceMetricsOverride', { width: Number(w), height: Number(h), deviceScaleFactor: 1, mobile: false }, sessionId);
	await send('Runtime.enable', {}, sessionId);
	await send('Page.navigate', { url }, sessionId);
	const deadline = Date.now() + 60000;
	if (process.env.WAIT) {
		await new Promise((r) => setTimeout(r, Number(process.env.WAIT) * 1000));
	}
	while (!process.env.WAIT) {
		const { result } = await send('Runtime.evaluate', { expression: 'document.title' }, sessionId);
		if (result.value === 'ready') {
			break;
		}
		if (Date.now() > deadline) {
			throw new Error(`page never became ready (title: ${result.value})`);
		}
		await new Promise((r) => setTimeout(r, 250));
	}
	if (process.env.EVAL) {
		const { result } = await send('Runtime.evaluate', { expression: process.env.EVAL, awaitPromise: true, returnByValue: true }, sessionId);
		console.log('eval:', JSON.stringify(result.value ?? result.description));
	}
	if (process.env.PROFILE) {
		await send('Profiler.enable', {}, sessionId);
		await send('Profiler.setSamplingInterval', { interval: 200 }, sessionId);
		await send('Profiler.start', {}, sessionId);
		await new Promise((r) => setTimeout(r, Number(process.env.PROFILE) * 1000));
		const { profile: cpu } = await send('Profiler.stop', {}, sessionId);
		const self = new Map();
		const byID = new Map(cpu.nodes.map((n) => [n.id, n]));
		const dt = cpu.timeDeltas;
		cpu.samples.forEach((id, i) => {
			const f = byID.get(id).callFrame;
			const key = `${f.functionName || '(anon)'} ${f.url.split('/').pop()}:${f.lineNumber + 1}`;
			self.set(key, (self.get(key) ?? 0) + (dt[i] ?? 0) / 1000);
		});
		const total = [...self.values()].reduce((a, b) => a + b, 0);
		console.log(`profile: ${total.toFixed(0)} ms sampled`);
		for (const [k, v] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 25)) {
			console.log(`  ${v.toFixed(0).padStart(6)} ms  ${k}`);
		}
	}
	const frames = Number(process.env.FRAMES ?? 0);
	for (let i = 0; i < Math.max(1, frames); i++) {
		if (i > 0) {
			await new Promise((r) => setTimeout(r, Number(process.env.EVERY ?? 0.5) * 1000));
		}
		const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
		const file = frames ? out.replace(/(\.png)?$/, `-${i}.png`) : out;
		await writeFile(file, Buffer.from(data, 'base64'));
		console.log(file);
	}
} finally {
	browser.close();
	proc.kill();
	await rm(profile, { recursive: true, force: true }).catch(() => {});
}
