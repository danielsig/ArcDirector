import {
	Agent,
	FakeProvider,
	HttpProvider,
	VerbRegistry,
	formatPlan,
	goToNamedInteractable,
	registerCoreVerbs,
	withQueue,
	type ActionPlan,
	type InferenceProvider,
	type PerceptionRecipe,
} from '../index.js';
import { fixtureParagraph, type FixtureCtx } from './scene.js';
import { resolveInferenceBaseURL, resolveLiveModel, probeHttp } from './probe.js';

const NAMES = new Set(['EastGate']);
const RUNS = 20;

function recipe():PerceptionRecipe<FixtureCtx> {
	return {
		push: {
			environment: {
				description: 'English scene with grouped trees and one PascalCase interactable. No coordinates.',
				gather: (ctx) => ctx.paragraph,
			},
		},
		tools: {},
	};
}

function walk(plan:ActionPlan, visit:(p:ActionPlan)=>void):void {
	visit(plan);
	if (plan.then) {
		walk(plan.then.plan, visit);
	}
}

function isValidGoTo(plan:ActionPlan):boolean {
	let ok = false;
	walk(plan, (p) => {
		if (p.head.verb === 'go_to' && typeof p.head.args.name === 'string' && NAMES.has(p.head.args.name)) {
			ok = true;
		}
		for (const key of Object.keys(p.head.args)) {
			if (key === 'x' || key === 'z' || key === 'y') {
				ok = false;
			}
		}
	});
	return ok;
}

async function makeProvider():Promise<{ provider:InferenceProvider; mock:boolean; baseURL:string }> {
	if (process.env.ARC_DIRECTOR_MOCK === '1') {
		return { provider: new FakeProvider(goToNamedInteractable()), mock: true, baseURL: 'mock' };
	}
	const baseURL = await resolveInferenceBaseURL();
	if (!await probeHttp(baseURL)) {
		throw new Error(
			`Local model not reachable at ${baseURL}. Start the local server or set ARC_DIRECTOR_MOCK=1.`,
		);
	}
	return { provider: withQueue(new HttpProvider({ baseURL, timeoutMs: 180_000 }), 1), mock: false, baseURL };
}

async function main():Promise<void> {
	const paragraph = fixtureParagraph();
	if (!paragraph.includes('EastGate') || /\(\s*-?\d/.test(paragraph)) {
		throw new Error(`fixture scene looks wrong: ${paragraph}`);
	}
	console.log('scene:', paragraph);

	const { provider, mock, baseURL } = await makeProvider();
	const model = mock ? 'mock' : await resolveLiveModel(baseURL);
	console.log(mock ? 'provider: mock' : `provider: live ${baseURL} (${model})`);

	let pass = 0;
	const failures:string[] = [];
	for (let i = 0; i < RUNS; i++) {
		const agent = new Agent<FixtureCtx>({
			id: 'Guard',
			identity: {
				name: 'Guard',
				role: 'A dungeon guard. When you see a named interactable such as EastGate, walk to it with go_to. Never emit coordinates.',
			},
			goals: [{ text: 'Go to EastGate', priority: 1 }],
			provider,
			verbs: registerCoreVerbs(new VerbRegistry()),
			recipe: recipe(),
			context: () => ({ paragraph }),
			model,
			heartbeat: 30,
			strategicInterval: 10_000,
			toolRoundCap: 2,
			planRetryCap: 2,
		});
		await agent.remember('EastGate is the door in the east wall.', ['gate', 'EastGate'], 0);
		try {
			const plan = await agent.tick(1);
			if (!plan) {
				failures.push(`#${i + 1}: no plan`);
				continue;
			}
			if (!isValidGoTo(plan)) {
				failures.push(`#${i + 1}: ${formatPlan(plan)}`);
				continue;
			}
			pass += 1;
			console.log(`#${i + 1} ok  ${formatPlan(plan)}`);
		}
		catch (err) {
			failures.push(`#${i + 1}: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	console.log(`${pass}/${RUNS} valid go_to(Name) plans`);
	if (failures.length > 0) {
		console.error('failures:');
		for (const f of failures) {
			console.error(' ', f);
		}
	}
	if (pass !== RUNS) {
		process.exitCode = 1;
	}
}

main().catch((err:unknown) => {
	console.error(err);
	process.exitCode = 1;
});
