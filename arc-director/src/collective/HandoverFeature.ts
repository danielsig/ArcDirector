import type { ArcRunner } from '../character/arc-runner.js';
import type { Character } from '../character/Character.js';
import type { ArcDirector } from '../director/ArcDirector.js';
import { Feature } from '../director/Feature.js';
import { URGENT } from '../director/ModelSlots.js';
import { keptText, nameTags, type MemoryRecord } from '../memory/store.js';
import { idsIn, parseTextWithIDs, type TextWithIDs } from '../character/text-with-ids.js';
import { internalsOf } from '../internals.js';
import type { Collective } from './Collective.js';
import { chatHandover, HANDOVER_THREAD, type Handover, type Journey, type MemoryEdit } from './handover.js';

/**
 * After characters change collectives, one model call fixes the memories of everyone involved: what went stale in a
 * collective left, and what a character or a collective joined should now remember. Moves within `ticks` director ticks
 * (default 1) share one call. It takes the default model's next free slot, ahead of thinks still waiting, never stops a
 * think, and nothing waits for it. Every director has it; `withHandover({ handover: false })` turns it off.
 */
export class HandoverFeature<TCtx = unknown> extends Feature<TCtx> {
	private readonly _options:HandoverOptions<TCtx> = {};
	/** Moves waiting for the next handover, one per character: its first `from`, its latest `to`. */
	private readonly _journeys = new Map<Character<TCtx>, Journey<TCtx>>();
	private _waited = 0;

	public override readonly order = 70;

	public configure(options:HandoverOptions<TCtx>):this {
		Object.assign(this._options, options);
		return this;
	}

	public override characterMoved(character:Character<TCtx>, from:Collective<TCtx> | null, to:Collective<TCtx> | null):void {
		if (this._options.handover !== false) {
			const was = this._journeys.get(character);
			this._journeys.set(character, { character, from: was ? was.from : from, to });
		}
	}

	public override runnerRemoved(runner:ArcRunner<TCtx>):void {
		this._journeys.delete(runner as Character<TCtx>);
	}

	public override beforeThinks():void {
		const director = this.director;
		const model = director.getModel();
		const { handover = chatHandover, ticks = 1 } = this._options;
		if (this._journeys.size === 0 || (this._waited += 1) < ticks || !model || !handover) {
			return;
		}
		const journeys = [...this._journeys.values()].filter((j) => j.from !== j.to && hasIdentity(j.character));
		this._journeys.clear();
		this._waited = 0;
		if (journeys.length === 0) {
			return;
		}
		void model.run(URGENT, (chat) => handover(journeys, chat))
			.then((edits) => this.apply(edits, journeys))
			.catch((err:unknown) => director.log({ name: HANDOVER_THREAD, message: `failed: ${err instanceof Error ? err.message : String(err)}`, error: true }));
	}

	/**
	 * A handover's edits. Pinned memories and unknown ids are left alone; embeddings follow, unawaited. The model was shown
	 * everyone by id, so its text is kept by the ids it was shown: those its memories name, the names its book gives,
	 * and everyone who moved and where.
	 */
	private apply(edits:MemoryEdit[], journeys:Journey<TCtx>[]):void {
		const { time, models } = this.director;
		const known = new Set(journeys.flatMap(({ character, from, to }) => [character, from, to].flatMap((owner) => (owner
			? [owner.id, ...owner.persona.names.ids(), ...owner.persona.memory.all().flatMap((m) => idsIn(keptText(m)))]
			: []))));
		const ided = (text:string):TextWithIDs => parseTextWithIDs(text, (word) => (known.has(word) ? word : undefined));
		const embed = (record:MemoryRecord):void => {
			void models.embed([record.text]).then(([vec]) => {
				record.embedding = vec;
			}, () => undefined);
		};
		for (const edit of edits) {
			const memory = (this.director.character(edit.id) ?? this.director.collective(edit.id))?.persona.memory;
			const editable = (id:string):boolean => !!memory?.all().some((m) => m.id === id && !m.pinned);
			for (const id of (memory && edit.remove) ?? []) {
				if (editable(id)) {
					memory!.remove(id);
				}
			}
			for (const { id, text } of (memory && edit.rewrite) ?? []) {
				if (editable(id) && text.trim()) {
					embed(internalsOf(memory!).rewrite(id, ided(text.trim()))!);
				}
			}
			for (const line of ((memory && edit.add) ?? []).map((text) => text.trim()).filter(Boolean)) {
				embed(internalsOf(memory!).add({ category: 'semantic', text: ided(line), tags: nameTags(line), timestamp: time }, time));
			}
		}
	}
}

/** What `withHandover` takes. */
export type HandoverOptions<TCtx = unknown> = {
	/** Director ticks whose moves share one call. Default 1. */
	ticks?:number;
	/** Your own handover, or `false` for none. Default: a call to the default chat model. */
	handover?:Handover<TCtx> | false;
};

/** Whether a character has an identity worth a memory handover: a role or traits. */
function hasIdentity<TCtx>(character:Character<TCtx>):boolean {
	const { role, traits } = character.persona.identity;
	return !!role || (traits?.length ?? 0) > 0;
}

declare module '../director/ArcDirector.js' {
	interface ArcDirector<TCtx, TEntity> {
		/** {@link HandoverFeature}, which every director has: `withHandover({ ticks: 2 })`, or `{ handover: false }`. */
		withHandover(options:HandoverOptions<TCtx>):this;
		getHandover():HandoverFeature<TCtx> | undefined;
	}
}
export function withHandover<TCtx>(this:ArcDirector<TCtx>, options:HandoverOptions<TCtx>):ArcDirector<TCtx> {
	return this.configureFeature(HandoverFeature<TCtx>, () => new HandoverFeature<TCtx>(), (handover) => handover.configure(options));
}
