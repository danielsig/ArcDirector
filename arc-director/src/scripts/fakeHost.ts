import {
	ArcDirector,
	formatArc,
	goToNamedInteractable,
	STOCK_VERBS,
} from '../index.js';
import { fixtureParagraph, fixtureSight, type FixtureCtx } from './scene.js';
import { resolveInferenceBaseURL, probeHttp } from './probe.js';

function sleep(ms:number):Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

async function main():Promise<void> {
	const paragraph = fixtureParagraph();
	console.log('scene:');
	console.log(paragraph);
	console.log('');

	const mock = process.env.ARC_DIRECTOR_MOCK === '1';
	const director = new ArcDirector<FixtureCtx>()
		.withPriorityQueue({
			maxParallel: 1,
			processInterval: 0,
			heartbeatStart: 0.01,
			heartbeatMin: 0.01,
		})
		.addStockVerbs()
		.withDefaultKit({ verbs: STOCK_VERBS })
		.onVerb((call) => {
			console.log(`host execute: ${call.verb}`, call.args);
			return { ok: true, verb: call.verb };
		})
		.withSight({ look: () => fixtureSight() })
		.withContext(() => ({ paragraph }))
		.addCharacter({
			id: 'Guard',
			mind: {},
			identity: { role: 'Guard', traits: ['dutiful'] },
			goals: [{ text: 'Go to EastGate', priority: 1 }],
			memories: [{
				text: 'I am a dungeon guard. I go to the named interactable I can see. EastGate is the door in the east wall.',
				tags: ['gate', 'EastGate'],
				pinned: true,
			}],
		});

	if (mock) {
		director.withFakeInference(goToNamedInteractable());
	}
	else {
		const baseURL = await resolveInferenceBaseURL();
		if (!await probeHttp(baseURL)) {
			console.log('No local model at ARC_DIRECTOR_BASE_URL (default LM Studio http://127.0.0.1:1234/v1).');
			console.log('Start LM Studio with `lms server start`, or rerun with ARC_DIRECTOR_MOCK=1.');
			process.exitCode = 1;
			return;
		}
		director.withHttpInference({ baseURL, timeoutMs: 180_000 });
	}

	try {
		await director.start();
	}
	catch (err:unknown) {
		console.error(err instanceof Error ? err.message : err);
		process.exitCode = 1;
		return;
	}

	if (!mock) {
		console.log(`model: ${director.model}`);
	}

	director.tick(1, 1);
	const t0 = Date.now();
	while (!director.character('Guard')?.mind?.lastArc) {
		if (Date.now() - t0 > 180_000) {
			throw new Error('Guard returned no arc');
		}
		await sleep(20);
	}
	const arc = director.character('Guard')!.mind!.lastArc!;
	console.log('arc:', formatArc(arc));
	console.log(JSON.stringify(arc, null, 2));
	director.dispose();
}

main().catch((err:unknown) => {
	console.error(err);
	process.exitCode = 1;
});
