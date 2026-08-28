import {
	Agent,
	FakeProvider,
	OpenAICompatProvider,
	VerbRegistry,
	formatPlan,
	goToNamedInteractable,
	registerCoreVerbs,
	withQueue,
	type InferenceProvider,
	type PerceptionRecipe,
} from '../index.js';
import { fixtureParagraph, type FixtureCtx } from './scene.js';
import { resolveInferenceBaseURL, resolveLiveModel, probeOpenAI } from './probe.js';

function recipe():PerceptionRecipe<FixtureCtx> {
	return {
		push: {
			environment: {
				description: 'English scene. Names only. No coordinates.',
				gather: (ctx) => ctx.paragraph,
			},
		},
		tools: {},
	};
}

async function liveProvider():Promise<{ provider:InferenceProvider; baseURL:string } | null> {
	if (process.env.ARC_DIRECTOR_MOCK === '1') {
		return { provider: new FakeProvider(goToNamedInteractable()), baseURL: 'mock' };
	}
	const baseURL = await resolveInferenceBaseURL();
	if (!await probeOpenAI(baseURL)) {
		return null;
	}
	return { provider: withQueue(new OpenAICompatProvider({ baseURL, timeoutMs: 180_000 }), 1), baseURL };
}

async function main():Promise<void> {
	const paragraph = fixtureParagraph();
	console.log('scene:');
	console.log(paragraph);
	console.log('');

	const live = await liveProvider();
	if (!live) {
		console.log('No local model at ARC_DIRECTOR_BASE_URL (default LM Studio http://127.0.0.1:1234/v1).');
		console.log('Start LM Studio with `lms server start`, or rerun with ARC_DIRECTOR_MOCK=1.');
		process.exitCode = 1;
		return;
	}
	const { provider, baseURL } = live;
	const model = baseURL === 'mock' ? 'mock' : await resolveLiveModel(baseURL);
	if (baseURL !== 'mock') {
		console.log(`provider: ${baseURL}  model: ${model}`);
	}

	const agent = new Agent<FixtureCtx>({
		id: 'Guard',
		identity: {
			name: 'Guard',
			role: 'A dungeon guard. Walk to the named interactable you can see. Never emit coordinates.',
			traits: ['dutiful'],
		},
		goals: [{ text: 'Go to EastGate', priority: 1 }],
		provider,
		verbs: registerCoreVerbs(new VerbRegistry()),
		recipe: recipe(),
		context: () => ({ paragraph }),
		execute: async (step) => {
			console.log(`host execute: ${step.verb}`, step.args);
			return { ok: true, verb: step.verb };
		},
		model: process.env.ARC_DIRECTOR_MODEL ?? model,
		heartbeat: 30,
		strategicInterval: 10_000,
	});
	await agent.remember('EastGate is the door in the east wall.', ['gate', 'EastGate'], 0);

	const plan = await agent.tick(1);
	if (!plan) {
		throw new Error('agent returned no plan');
	}
	console.log('plan:', formatPlan(plan));
	console.log(JSON.stringify(plan, null, 2));
}

main().catch((err:unknown) => {
	console.error(err);
	process.exitCode = 1;
});
