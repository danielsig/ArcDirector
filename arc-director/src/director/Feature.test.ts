import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { STOCK_VERBS } from '../arc/stock-verbs.js';
import type { ArcRunner } from '../character/arc-runner.js';
import type { Character } from '../character/Character.js';
import type { Collective } from '../collective/Collective.js';
import { PriorityThinkQueue } from '../think/queue.js';
import { ArcDirector } from './ArcDirector.js';
import './shortcuts.js';
import { Feature, type FeatureTick } from './Feature.js';

type Ctx = { id:string };

/** Writes down each hook it hears, under its name. */
class Recorder extends Feature<Ctx> {
	constructor(public readonly name:string, public readonly heard:string[], public override readonly order = 100) {
		super();
	}

	public override install():void {
		this.heard.push(`${this.name} install`);
	}
	public override beforeWatches(_tick:FeatureTick):void {
		this.heard.push(`${this.name} beforeWatches`);
	}
	public override beforeMoves(_tick:FeatureTick):void {
		this.heard.push(`${this.name} beforeMoves`);
	}
	public override afterMoves(_tick:FeatureTick):void {
		this.heard.push(`${this.name} afterMoves`);
	}
	public override beforeThinks(_tick:FeatureTick):void {
		this.heard.push(`${this.name} beforeThinks`);
	}
	public override runnerAdded(runner:ArcRunner<Ctx>):void {
		this.heard.push(`${this.name} added ${runner.id}`);
	}
	public override runnerRemoved(runner:ArcRunner<Ctx>):void {
		this.heard.push(`${this.name} removed ${runner.id}`);
	}
	public override characterMoved(character:Character<Ctx>, from:Collective<Ctx> | null, to:Collective<Ctx> | null):void {
		this.heard.push(`${this.name} moved ${character.id} ${from?.id ?? '-'} ${to?.id ?? '-'}`);
	}
}

function director():ArcDirector<Ctx> {
	return new ArcDirector<Ctx>()
		.addFake()
		.withVerbs((v) => v.addStock())
		.withDefaultKit({ verbs: [...STOCK_VERBS] })
		.onVerb((call) => ({ status: 'ok', verb: call.verb }))
		.withContext((id) => ({ id }));
}

describe('Feature', () => {
	it('runs each tick hook in its gap, lowest order first, then in the order added', () => {
		const heard:string[] = [];
		const queue = new PriorityThinkQueue();
		const sample = queue.tick.bind(queue);
		queue.tick = (dt, catalogs) => {
			heard.push('watches sampled');
			return sample(dt, catalogs);
		};
		const late = new Recorder('late', heard, 200);
		const first = new Recorder('first', heard);
		const second = new Recorder('second', heard);
		const built = director().withQueue(queue).addFeature(late).addFeature(first).addFeature(second);
		assert.equal(built.getFeature(Recorder), first);
		heard.length = 0;
		built.tick(0.1);
		const gaps = ['beforeWatches', 'beforeMoves', 'afterMoves', 'beforeThinks'];
		assert.deepEqual(heard, gaps.flatMap((gap) => [
			...['first', 'second', 'late'].map((name) => `${name} ${gap}`),
			...gap === 'beforeWatches' ? ['watches sampled'] : [],
		]));
	});

	it('meets the cast: joining, moving, leaving', async () => {
		const heard:string[] = [];
		const built = director()
			.addCharacter({ id: 'Ada', mind: {} })
			.addCollective({ id: 'Watch', characters: [{ id: 'Bo' }] });
		built.tick(0.1);
		// Added once the cast is wired, it meets everyone in it.
		built.addFeature(new Recorder('f', heard));
		assert.deepEqual(heard, ['f install', 'f added Ada', 'f added Watch', 'f added Bo']);
		heard.length = 0;
		built.character('Ada')!.collective = built.collective('Watch')!;
		assert.deepEqual(heard, ['f moved Ada - Watch']);
		heard.length = 0;
		built.removeCollective('Watch');
		assert.deepEqual(heard, ['f moved Bo Watch -', 'f moved Ada Watch -', 'f removed Watch']);
		heard.length = 0;
		built.removeCharacter('Ada');
		assert.deepEqual(heard, ['f removed Ada']);
	});

	it('belongs to one director', () => {
		const feature = new Recorder('f', []);
		director().addFeature(feature);
		assert.throws(() => director().addFeature(feature), /one director/);
	});
});
