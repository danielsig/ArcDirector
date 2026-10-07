import {
	FakeProvider,
	HttpProvider,
	STOCK_VERBS,
	VerbRegistry,
	formatArc,
	goToNamedInteractable,
	registerStockVerbs,
	soloCharacter,
	type Arc,
	type InferenceProvider,
	type Sense,
	type ToolSpec,
} from '../index.js';
import { fixtureParagraph, type FixtureCtx } from './scene.js';
import { resolveInferenceBaseURL, resolveLiveModel, probeHttp } from './probe.js';

const NAMES = new Set(['EastGate']);
const RUNS = 20;

function perception():{ senses:Record<string, Sense<FixtureCtx>>; tools:Record<string, ToolSpec<FixtureCtx>> } {
	return {
		senses: {
			environment: {
				description: 'English scene with grouped trees and one PascalCase interactable. No coordinates.',
				gather: (ctx) => ctx.paragraph,
			},
		},
		tools: {},
	};
}

function eachArc(arc:Arc, visit:(p:Arc)=>void):void {
	visit(arc);
	if (arc.group) {
		eachArc(arc.group, visit);
	}
	if (arc.then) {
		eachArc(arc.then.arc, visit);
	}
}

function isValidGoTo(arc:Arc):boolean {
	let ok = false;
	eachArc(arc, (p) => {
		const head = p.head;
		if (!head) {
			return;
		}
		if (head.verb === 'go_to' && typeof head.args.target === 'string' && NAMES.has(head.args.target)) {
			ok = true;
		}
		for (const key of Object.keys(head.args)) {
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
	return { provider: new HttpProvider({ baseURL, timeoutMs: 180_000 }), mock: false, baseURL };
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
		const guard = soloCharacter<FixtureCtx>({
			id: 'Guard',
			identity: { role: 'Guard' },
			goals: [{ text: 'Go to EastGate', priority: 1 }],
			provider,
			verbs: registerStockVerbs(new VerbRegistry()),
			kit: { verbs: STOCK_VERBS },
			...perception(),
			context: () => ({ paragraph }),
			model,
			heartbeat: 30,
			strategicInterval: 10_000,
			toolRoundCap: 2,
			arcRetryCap: 2,
		});
		guard.persona.memory.add({
			text: 'I am a dungeon guard. When I see a named interactable such as EastGate, I go to it with go_to. Never emit coordinates.',
			pinned: true,
		}, 0);
		const mind = guard.mind!;
		await mind.remember('EastGate is the door in the east wall.', ['gate', 'EastGate'], 0);
		try {
			const arc = await mind.tick(1);
			if (!arc) {
				failures.push(`#${i + 1}: no arc`);
				continue;
			}
			if (!isValidGoTo(arc)) {
				failures.push(`#${i + 1}: ${formatArc(arc)}`);
				continue;
			}
			pass += 1;
			console.log(`#${i + 1} ok  ${formatArc(arc)}`);
		}
		catch (err) {
			failures.push(`#${i + 1}: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	console.log(`${pass}/${RUNS} valid go_to(Name) arcs`);
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
