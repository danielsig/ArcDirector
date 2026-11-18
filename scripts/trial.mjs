// Model trials: real thinks of a few small scenes, by model × variant × format, scored and tabled.
//
//   node scripts/trial.mjs <trial-file> [--models a,b] [--tasks a,b] [--samples N] [--budget N] [--cap N]
//                          [--format text,json,schema] [--thinking BUDGET] [--out DIR | --resume DIR] [--fake]
//                          [--url URL] [--ctx N] [--parallel N] [--progress 10,50]
//
// A trial file's default export (see scripts/trial-example.mjs):
//   tasks     [{ id, scene, score?, fake? }]: `scene` is a `Scenario` (arc-director/testing `playScenario`), or
//             `(variant, format) => Scenario` for inputs that differ by variant; given `thinks: 1, seconds: 3,
//             done: () => false` unless it says. `fake`: Arc text replies `--fake` gives in turn.
//   variants  { name: patch or [patch, …] } (default `{ base: {} }`). A patch changes one message of every think
//             request: `append` (a line at the end), `replace: [pattern, text]` (must match). Which message: `in`
//             (its role, default system), `at` (the nth of that role, default 0, negative from the end), and in a
//             message of parts, `part` (the nth text part, default 0). `verbs`: scene verbs added, so the parser and
//             schema know them. Texts may be `(format) => text`.
//   score     (run, task) => { name: count or boolean }: a task's own `score` wins. `run` holds `arc` (Arc text, block
//             layout, or null), `steps` (the Arc), `valid` (an Arc with no repair), `reply` (the last reply text that
//             carried no tool call, raw), `replies` (every think turn's text), `repairs` (the library's reasons),
//             `tools` (`name(args)` per tool call), `capped`, `error`, and `calls` (every request and its reply).
//   models    default model IDs, when `--models` gives none.
//   mind      `withMind` settings over the run's own: `{ repairRetries: 0 }` scores first replies in a syntax the
//             library does not read yet without paying for a repair turn each.
//   load      LM Studio load settings over the model's own (`{ eval_batch_size: 2048 }`).
//   cap       requests a think may make (`--cap` wins): the think ends there, scored as `capped`.
//
// Each think is the game's: the library's own prompt, tools, tool choice, endpoint, tool loop, repairs (one retry, per
// step, as `game/src/director/adapter.ts`) and thinking budget (`--thinking`, 0 = off), each model at its makers'
// sampling. The run copies `arc-director/dist` into `<out>/dist` first and imports only that copy, so a rebuild meanwhile
// cannot break it: build the library before a run. Out (default `<os temp>/arc-trials/<trial>-<time>`): `replies.jsonl`
// (every think in full, those the budget cut off too, as `cut`), `judged.jsonl` (each finished think's counts),
// `prompt-<format>-<variant>-<task>.txt` (the first request of each), `table.md`. `--resume DIR` goes on with an earlier
// out, its library copy and its finished thinks: it runs only the cells missing, and tables them all.
//
// Models: LM Studio at `--url` (default http://localhost:1234; the desktop's over LM Link or its LAN address). Each
// model runs alone (everything else unloaded): as it is loaded already, else as LM Studio loads it, with the trial's
// `load`, `--ctx` and `--parallel` over that (32768 and 4 when it is not loaded); it is reloaded only when one of those
// differs. Its context and slots become the library's `contextLength` and `maxParallel`, which size each think to its
// slot. At the end, or on Ctrl+C, whatever was loaded at the start is loaded again as it was. `--budget` (default 200)
// caps requests per run: thinks under way when it runs out are cut off and saved, the rest are not run. `--fake` runs
// it all on the library's fake provider, with no server: a dry run.
//
// Progress: a `PROGRESS <n>% (<done>/<thinks>, <s>s, ETA <s>s)` line as the thinks to run pass each of `--progress`'s percents
// (default 10,50), for an agent waiting on the run to report; none in the run's first 20 s.
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const { values: opt, positionals: [trialFile] } = parseArgs({
	allowPositionals: true,
	options: {
		models: { type: 'string' },
		tasks: { type: 'string' },
		samples: { type: 'string', default: '1' },
		budget: { type: 'string', default: '200' },
		cap: { type: 'string' },
		format: { type: 'string', default: 'text' },
		thinking: { type: 'string', default: '0' },
		out: { type: 'string' },
		resume: { type: 'string' },
		fake: { type: 'boolean', default: false },
		url: { type: 'string', default: 'http://localhost:1234' },
		ctx: { type: 'string' },
		parallel: { type: 'string' },
		progress: { type: 'string', default: '10,50' },
	},
});
if (!trialFile) {
	console.error('usage: node scripts/trial.mjs <trial-file> [--models a,b] [--tasks a,b] [--samples N] [--budget N] [--cap N] [--format text,json,schema] [--fake] [--out DIR | --resume DIR]');
	process.exit(1);
}

const trial = (await import(pathToFileURL(resolve(trialFile)).href)).default;
const variants = trial.variants ?? { base: {} };
const formats = opt.format.split(',');
const models = opt.fake ? ['fake'] : opt.models?.split(',') ?? trial.models ?? [];
const tasks = opt.tasks?.split(',').map((id) => trial.tasks.find((t) => t.id === id) ?? fail(`no task ${id}`)) ?? trial.tasks;
const samples = Number(opt.samples);
const budget = Number(opt.budget);
const cap = Number(opt.cap ?? trial.cap ?? Infinity);
const thinking = Number(opt.thinking);
// The loaded model's, once it is loaded.
let ctx = Number(opt.ctx ?? 32768);
let parallel = Number(opt.parallel ?? 4);
if (models.length === 0) {
	fail('no models: pass --models, list them in the trial, or pass --fake');
}

function fail(message) {
	throw new Error(message);
}

// ---- The library, copied ----

const out = resolve(opt.resume ?? opt.out ?? join(tmpdir(), 'arc-trials', `${basename(trialFile, '.mjs')}-${new Date().toISOString().replace(/[:.]/g, '-')}`));
const dist = join(out, 'dist');
mkdirSync(out, { recursive: true });
if (!opt.resume || !existsSync(dist)) {
	cpSync(fileURLToPath(new URL('../arc-director/dist', import.meta.url)), dist, { recursive: true, filter: (src) => !/\.(d\.ts|map)$|\.test\.js$/.test(src) });
	writeFileSync(join(dist, 'package.json'), '{ "type": "module" }\n');
}
const lib = await import(pathToFileURL(join(dist, 'index.js')).href);
const testing = await import(pathToFileURL(join(dist, 'testing/index.js')).href);
console.log(`out: ${out}`);

// ---- Variants ----

const PASS = { text: 'pass()', json: '{"steps":[{"verb":"pass"}]}', schema: '{"steps":[{"verb":"pass"}]}' };
const of = (x, ...args) => (typeof x === 'function' ? x(...args) : x);

/** A think's request, not a `choose` pick's (log probabilities) or a handover's. */
const isThink = (req) => req.topLogprobs === undefined && !!req.thread && !req.thread.startsWith('handover');

/** `messages` with each of `patches` applied to the message (and text part) it names. */
function patch(messages, patches, format) {
	for (const p of patches.filter((x) => x.append || x.replace)) {
		const where = `${p.in ?? 'system'} message ${p.at ?? 0}${p.part ? ` part ${p.part}` : ''}`;
		const at = messages.flatMap((m, i) => (m.role === (p.in ?? 'system') ? [i] : [])).at(p.at ?? 0);
		const content = messages[at]?.content;
		const parts = Array.isArray(content) ? content.flatMap((c, i) => (c.type === 'text' ? [i] : [])) : [];
		const part = parts.at(p.part ?? 0);
		let text = typeof content === 'string' ? content : content?.[part]?.text ?? fail(`variant: no ${where} to patch`);
		if (p.replace) {
			const next = text.replace(p.replace[0], of(p.replace[1], format));
			text = next !== text ? next : fail(`variant: ${p.replace[0]} not found in the ${where}`);
		}
		if (p.append) {
			text = `${text.trimEnd()}\n${of(p.append, format)}`;
		}
		messages = messages.with(at, { ...messages[at], content: typeof content === 'string' ? text : content.with(part, { ...content[part], text }) });
	}
	return messages;
}

/** A copy of `x` deep in its objects and arrays, its functions kept, so no think changes the next one's scene. */
const copy = (x) => (Array.isArray(x) ? x.map(copy) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([k, y]) => [k, copy(y)])) : x);

// ---- A think ----

let requests = 0;
let stopped = '';
const dumped = new Set();

/** The fake provider's replies for `task`: its `fake` lines in turn, then `pass`. Picks get `A`, handovers `{}`. */
function fakeChat(task, format) {
	let n = 0;
	const replies = format === 'text' ? task.fake ?? [] : [];
	return (req) => ({ toolCalls: [], content: req.topLogprobs !== undefined ? 'A' : !isThink(req) ? '{}' : replies[n++] ?? PASS[format] });
}

/** What a request's body holds besides its settings: kept as `messages`, tool names and `schema` instead. */
const BULK = new Set(['messages', 'input', 'tools', 'response_format', 'text']);

/**
 * One think of `task` as the game thinks, under `variant` and `format` on `model`: what it sent, got and made of it.
 * Each request is patched by the variant, counted against the budget and the think's cap, and kept in `run.calls`.
 */
async function think({ model, task, variant, format, s }) {
	const run = { model, variant, format, task: task.id, s, arc: null, steps: null, valid: false, reply: null, replies: [], repairs: [], tools: [], capped: false, error: undefined, calls: [] };
	const patches = [variants[variant]].flat();
	const scene = { thinks: 1, seconds: 3, done: () => false, ...copy(of(task.scene, variant, format)) };
	scene.verbs = Object.assign({ ...scene.verbs }, ...patches.map((p) => p.verbs));
	const spec = { id: model, contextLength: ctx, maxParallel: parallel, batchWait: 0, thinking: thinking > 0, thinkingBudget: thinking > 0 ? thinking : undefined };
	const config = opt.fake
		? { chat: fakeChat(task, format), models: { main: { id: 'fake', batchWait: 0 } } }
		: { baseURL: `${opt.url}/v1`, models: { main: spec } };
	const provider = (opt.fake ? new testing.Fake(config) : new lib.LMStudio(config)).configure(config);
	const chat = provider.transport.chat.bind(provider.transport);
	// Think requests in the think under way.
	let turns = 0;
	provider.transport.chat = async (req) => {
		const isTurn = isThink(req);
		const messages = isTurn ? patch(req.messages, patches, format) : req.messages;
		if (isTurn && turns >= cap) {
			run.capped = true;
			throw new Error(`capped at ${cap} requests`);
		}
		if (stopped || requests >= budget) {
			if (!stopped) {
				stopped = `budget of ${budget} requests reached`;
				console.log(`${stopped}: cutting off the thinks under way`);
			}
			run.cut = true;
			throw new Error(stopped);
		}
		requests++;
		turns += isTurn ? 1 : 0;
		// A copy: the library adds the next turns to its own list.
		const call = { thread: req.thread, think: isTurn, messages: [...messages], tools: req.tools?.map((t) => t.name), toolChoice: req.toolChoice, schema: !!req.responseFormat };
		run.calls.push(call);
		const name = join(out, `prompt-${format}-${variant}-${task.id}.txt`);
		if (isTurn && !dumped.has(name)) {
			dumped.add(name);
			writeFileSync(name, messages.map((m) => `===== ${m.role}\n${typeof m.content === 'string' ? m.content : JSON.stringify(m.content, null, '\t')}`).join('\n'));
		}
		const t0 = Date.now();
		const res = await chat({ ...req, messages, onRequest: (sent) => {
			Object.assign(call, { path: sent.path, settings: Object.fromEntries(Object.entries(sent.body).filter(([k]) => !BULK.has(k))) });
			req.onRequest?.(sent);
		} });
		Object.assign(call, { ms: Date.now() - t0, reply: res.content, reasoning: res.reasoning, toolCalls: res.toolCalls, tokens: res.outputTokens, truncated: res.truncated });
		return res;
	};
	const t0 = Date.now();
	try {
		await testing.playScenario(scene, (d) => d
			.addProvider(provider)
			.withMind({ arcFormat: format, repairRetries: 1, repairPerStep: true, repairUnknownFields: true, ...trial.mind })
			.onThink((e) => {
				if (e.kind === 'start') {
					turns = 0;
				}
				else if (e.kind === 'retry') {
					run.repairs.push(e.reason);
				}
				else if (e.kind === 'tool') {
					run.tools.push(`${e.tool}(${e.args})`);
				}
				else if (e.kind === 'end' && e.arc) {
					run.steps = e.arc;
					run.arc = lib.formatArcBlocks(e.arc);
				}
			}));
	}
	catch (err) {
		// A capped think ended as it was meant to.
		run.error = run.capped ? undefined : err instanceof Error ? err.message : String(err);
	}
	const thinkCalls = run.calls.filter((c) => c.think);
	run.replies = thinkCalls.map((c) => c.reply ?? '');
	run.reply = thinkCalls.findLast((c) => c.reply && !c.toolCalls?.length)?.reply ?? null;
	run.valid = run.arc !== null && run.repairs.length === 0;
	run.ms = Date.now() - t0;
	return run;
}

// ---- Models ----

const LOAD_KEYS = ['context_length', 'parallel', 'flash_attention', 'offload_kv_cache_to_gpu', 'eval_batch_size', 'num_experts'];

async function api(path, body) {
	const res = await fetch(`${opt.url}/api/v1/${path}`, body && { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
	if (!res.ok) {
		throw new Error(`LM Studio ${path} ${res.status}: ${(await res.text()).slice(0, 200)}`);
	}
	return res.json();
}

/** Every loaded instance: its model, id, and how it was loaded (only the load settings). */
async function loaded() {
	const { models: list } = await api('models');
	return list.flatMap((m) => (m.loaded_instances ?? []).map((inst) => ({
		model: m.key,
		id: inst.id,
		config: Object.fromEntries(LOAD_KEYS.filter((k) => inst.config?.[k] !== undefined).map((k) => [k, inst.config[k]])),
	})));
}

/** Exactly `want` loaded ({ model, config } each, config only what must match), everything else unloaded first. */
async function useModels(want, now) {
	const fits = (inst, w) => inst.model === w.model && Object.entries(w.config).every(([k, x]) => inst.config[k] === x);
	for (const inst of now.filter((i) => !want.some((w) => fits(i, w)))) {
		console.log(`unloading ${inst.id}`);
		await api('models/unload', { instance_id: inst.id });
	}
	for (const w of want.filter((x) => !now.some((i) => fits(i, x)))) {
		console.log(`loading ${w.model} ${JSON.stringify(w.config)}`);
		await api('models/load', { model: w.model, ...w.config });
	}
}

/** `model` loaded alone: as it is, else as LM Studio loads it, with the trial's `load`, `--ctx` and `--parallel` over that. */
async function useModel(model) {
	const now = await loaded();
	const config = {
		...now.find((i) => i.model === model)?.config ?? { context_length: 32768, parallel: 4 },
		...trial.load,
		...opt.ctx && { context_length: Number(opt.ctx) },
		...opt.parallel && { parallel: Number(opt.parallel) },
	};
	await useModels([{ model, config }], now);
	ctx = config.context_length ?? ctx;
	parallel = config.parallel ?? parallel;
}

// ---- The run ----

const repliesFile = join(out, 'replies.jsonl');
const judgedFile = join(out, 'judged.jsonl');
const cellOf = (r) => [r.model, r.variant, r.format, r.task?.id ?? r.task, r.s].join(' | ');
const judged = existsSync(judgedFile) && opt.resume ? readFileSync(judgedFile, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [];
const finished = new Set(judged.map(cellOf));
const cut = [];
const atStart = opt.fake ? [] : await loaded();
process.once('SIGINT', () => {
	stopped = 'interrupted';
	console.log('interrupted: cutting off the thinks under way');
});

/** A model's thinks still to run. Sample-major, so a cut budget still covers every cell evenly. */
function jobsOf(model) {
	const jobs = [];
	for (let s = 0; s < samples; s++) {
		for (const format of formats) {
			for (const task of tasks) {
				for (const variant of Object.keys(variants)) {
					jobs.push({ model, task, variant, format, s });
				}
			}
		}
	}
	return jobs.filter((job) => !finished.has(cellOf(job)));
}

const thinksToRun = models.reduce((n, model) => n + jobsOf(model).length, 0);
const milestones = opt.progress.split(',').map(Number).sort((a, b) => a - b);
const runStart = Date.now();
let thinksRun = 0;

/** One more think done: a line for each `--progress` percent it passes, unless the run is under 20 s old. */
function progressed() {
	thinksRun++;
	const seconds = (Date.now() - runStart) / 1000;
	while (milestones.length > 0 && thinksRun * 100 >= milestones[0] * thinksToRun) {
		const percent = milestones.shift();
		if (seconds >= 20) {
			const eta = Math.round(seconds * (thinksToRun - thinksRun) / thinksRun);
			console.log(`PROGRESS ${percent}% (${thinksRun}/${thinksToRun}, ${Math.round(seconds)}s, ETA ${eta}s)`);
		}
	}
}

try {
	for (const model of models) {
		const todo = jobsOf(model);
		if (stopped || todo.length === 0) {
			continue;
		}
		if (!opt.fake) {
			await useModel(model);
		}
		await Promise.all(Array.from({ length: opt.fake ? 1 : parallel }, async () => {
			for (let job = todo.shift(); job && !stopped; job = todo.shift()) {
				const run = await think(job);
				// One cut off before its first request never ran.
				if (run.cut && run.calls.length === 0) {
					break;
				}
				appendFileSync(repliesFile, `${JSON.stringify(run)}\n`);
				progressed();
				const head = `${model} ${run.variant} ${run.format} ${run.task} s${run.s} req=${run.calls.length}`;
				if (run.cut) {
					cut.push(run);
					console.log(`${head} CUT OFF`);
					continue;
				}
				const counts = Object.fromEntries(Object.entries((job.task.score ?? trial.score)(run, job.task)).map(([k, n]) => [k, Number(n)]));
				const row = { model, variant: run.variant, format: run.format, task: run.task, s: run.s, valid: run.valid, arc: run.arc !== null, capped: run.capped, repairs: run.repairs.length, requests: run.calls.length, tokens: run.calls.reduce((n, c) => n + (c.tokens ?? 0), 0), counts };
				judged.push(row);
				appendFileSync(judgedFile, `${JSON.stringify(row)}\n`);
				const why = run.error ?? run.repairs[0];
				const verdict = run.valid ? 'valid' : run.capped ? 'CAPPED' : `${run.arc ? 'repaired' : 'NO ARC'}: ${why?.replace(/\s+/g, ' ').slice(0, 80)}`;
				console.log(`${head} ${verdict} :: ${(run.arc ?? run.reply ?? '').replace(/\s+/g, ' ').slice(0, 100)}`);
			}
		}));
	}
}
finally {
	if (atStart.length > 0) {
		console.log('restoring the models loaded at the start');
		await useModels(atStart, await loaded());
	}
}

// ---- The table ----

const names = [...new Set(judged.flatMap((r) => Object.keys(r.counts)))];
const cells = Map.groupBy(judged, (r) => `${r.model} | ${r.variant} | ${r.format}`);
const heads = ['model', 'variant', 'format', 'n', 'valid', 'repaired', 'no arc', 'capped', ...names, 'req', 'out tok/think'];
const lines = [`| ${heads.join(' | ')} |`, `|${' --- |'.repeat(heads.length)}`];
for (const [key, rows] of cells) {
	const sum = (f) => rows.reduce((n, r) => n + f(r), 0);
	const cols = [rows.length, sum((r) => r.valid), sum((r) => r.arc && !r.valid), sum((r) => !r.arc), sum((r) => !!r.capped), ...names.map((k) => sum((r) => r.counts[k] ?? 0)), sum((r) => r.requests), (sum((r) => r.tokens) / rows.length).toFixed(0)];
	lines.push(`| ${key} | ${cols.join(' | ')} |`);
}
const table = lines.join('\n');
writeFileSync(join(out, 'table.md'), `${table}\n`);
const spent = cut.reduce((n, r) => n + r.calls.length, 0);
console.log(`\n${table}\n\n${judged.length} thinks; this run spent ${requests} requests${cut.length > 0 ? `, ${spent} of them on ${cut.length} thinks cut off (saved as \`cut\` in replies.jsonl)` : ''}${stopped ? `; stopped: ${stopped}` : ''}. Out: ${out}`);
