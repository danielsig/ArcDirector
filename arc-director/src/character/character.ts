import type { Collective } from '../collective/collective.js';
import type { Mind, MindJSON, MindSettings } from '../mind/mind.js';
import { lawGroup, type Law, type LawSpec } from '../arc/laws.js';
import { ArcRunner, type ArcRunnerJSON, type RunnerOptions } from './arc-runner.js';
import { Persona, type PersonaJSON } from './persona.js';

/** How a character's director carries out `character.mind = …` and `character.collective = …`. */
export type Wiring<TCtx = unknown> = {
	setMind(character:Character<TCtx>, mind:Mind<TCtx> | null):void;
	setCollective(character:Character<TCtx>, collective:Collective<TCtx> | null):void;
};

export type CharacterOptions<TCtx = unknown> = RunnerOptions<TCtx> & {
	persona?:Persona;
	tags?:string[];
	/** Settings for its own mind, kept while it belongs to a collective. */
	mindSettings?:MindSettings;
	/** Its director's. Without one, setting `mind` or `collective` throws. */
	wiring?:Wiring<TCtx>;
};

const UNWIRED:Wiring = {
	setMind: (character) => {
		throw new Error(`ArcDirector: '${character.id}' was not added to a director`);
	},
	setCollective: (character) => {
		throw new Error(`ArcDirector: '${character.id}' was not added to a director`);
	},
};

/** A character's part of a save. Membership is saved on its collective. */
export type CharacterJSON = ArcRunnerJSON & {
	persona:PersonaJSON;
	tags:string[];
	/** Its own mind's thinking state. Absent in a collective, or when the host drives it. */
	mind?:MindJSON;
	mindSettings?:MindSettings;
};

/**
 * Runs arcs in the world: an NPC or a Player. It holds its persona and its tags. Its `mind` writes its
 * arcs: its own mind, its collective's shared one, or none when the host drives it.
 */
export class Character<TCtx = unknown> extends ArcRunner<TCtx> {
	readonly persona:Persona;
	tags:string[];
	/** Settings for its own mind. Kept while it belongs to a collective, so leaving can give it a fresh mind. */
	mindSettings:MindSettings | undefined;
	/** @internal Its own mind; null in a collective or when the host drives it. Only the director sets it. */
	ownMind:Mind<TCtx> | null = null;
	/** @internal The collective it belongs to. Only the director sets it. */
	memberOf:Collective<TCtx> | null = null;
	private readonly wiring:Wiring<TCtx>;

	constructor(opts:CharacterOptions<TCtx>) {
		super(opts);
		this.persona = opts.persona ?? new Persona();
		this.tags = [...(opts.tags ?? [])];
		this.mindSettings = opts.mindSettings;
		this.wiring = opts.wiring ?? UNWIRED as Wiring<TCtx>;
	}

	/** Its own mind, or its collective's. Null when the host drives it. */
	get mind():Mind<TCtx> | null {
		return this.memberOf?.mind ?? this.ownMind;
	}

	/**
	 * Think with `mind` from now on, out of any collective. A collective's mind joins that collective instead.
	 * `null` hands the character to the host and forgets its mind's settings. Another character's mind throws.
	 * The arc it is running keeps running.
	 */
	set mind(mind:Mind<TCtx> | null) {
		this.wiring.setMind(this, mind);
	}

	get collective():Collective<TCtx> | null {
		return this.memberOf;
	}

	/**
	 * Move into `collective`, straight from any other, or leave with `null`: then it thinks with a fresh mind of
	 * its own when it had settings for one, else the host drives it. Its laws, tags and running arc come along.
	 */
	set collective(collective:Collective<TCtx> | null) {
		this.wiring.setCollective(this, collective);
	}

	/** A character acts for itself. */
	get voice():ArcRunner<TCtx> {
		return this;
	}

	/** In a collective, its laws live there as its own: `flee` is kept as `Tom.flee` and reaches only it. */
	override addLaw(spec:LawSpec, pinned = false):Law | undefined {
		const home = this.memberOf;
		if (!home) {
			return super.addLaw(spec, pinned);
		}
		const own = home.laws.filter((law) => lawGroup(law.name) === this.id).length;
		return home.addLaw({ ...spec, who: 'me', name: `${this.id}.${spec.name ?? `law_${own + 1}`}` }, pinned);
	}

	override removeLaw(name:string):void {
		if (this.memberOf) {
			this.memberOf.removeLaw(`${this.id}.${name}`);
			return;
		}
		super.removeLaw(name);
	}

	override toJSON():CharacterJSON {
		return {
			...super.toJSON(),
			persona: this.persona.toJSON(),
			tags: [...this.tags],
			mind: this.ownMind?.toJSON(),
			mindSettings: this.mindSettings && { ...this.mindSettings },
		};
	}

	/** @internal A saved character's runner part and tags. Its persona and mind are rebuilt by the director. */
	load(json:CharacterJSON):void {
		this.loadJSON(json);
		this.tags = [...json.tags];
		this.mindSettings = json.mindSettings;
	}
}
