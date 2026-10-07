import type { Collective } from '../collective/collective.js';
import type { Mind, MindJSON, MindSettings } from '../mind/mind.js';
import { lawGroup, type Law, type LawSpec } from '../arc/laws.js';
import { ArcRunner, type ArcRunnerJSON, type RunnerOptions } from './arc-runner.js';
import { Persona, type PersonaJSON } from './persona.js';

/**
 * How a character and its director reach each other, one for each character. The director gives `setMind` and
 * `setCollective`, which carry out `character.mind = …` and `character.collective = …`. The character's
 * constructor fills in `fields`: the director's only way into its private fields.
 */
export type Wiring<TCtx = unknown> = {
	setMind(character:Character<TCtx>, mind:Mind<TCtx> | null):void;
	setCollective(character:Character<TCtx>, collective:Collective<TCtx> | null):void;
	fields?:CharacterFields<TCtx>;
};

/** What a character's constructor hands its director through its {@link Wiring}. */
export type CharacterFields<TCtx = unknown> = {
	/** Its own mind; null in a collective or when the host drives it. */
	setMind(mind:Mind<TCtx> | null):void;
	setCollective(collective:Collective<TCtx> | null):void;
	/** A saved character's runner part and tags. Its persona and mind are rebuilt by the director. */
	load(json:CharacterJSON):void;
	/** Keep `law` itself, not a copy, so an arc it started still counts as its own after a transfer. */
	keepLaw(law:Law):boolean;
};

export type CharacterOptions<TCtx = unknown> = RunnerOptions<TCtx> & {
	persona?:Persona;
	tags?:string[];
	/** Settings for its own mind, kept while it belongs to a collective. */
	mindSettings?:MindSettings;
	/** Its own, from its director. Without one, setting `mind` or `collective` throws. */
	wiring?:Wiring<TCtx>;
};

function unwired<TCtx>():Wiring<TCtx> {
	const fail = (character:Character<TCtx>):never => {
		throw new Error(`ArcDirector: '${character.id}' was not added to a director`);
	};
	return { setMind: fail, setCollective: fail };
}

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
	public readonly persona:Persona;
	public tags:string[];
	/** Settings for its own mind. Kept while it belongs to a collective, so leaving can give it a fresh mind. */
	public mindSettings:MindSettings | undefined;
	/** Its own mind; null in a collective or when the host drives it. */
	private _mind:Mind<TCtx> | null = null;
	private _collective:Collective<TCtx> | null = null;
	private readonly _wiring:Wiring<TCtx>;

	public constructor(opts:CharacterOptions<TCtx>) {
		super(opts);
		this.persona = opts.persona ?? new Persona();
		this.tags = [...(opts.tags ?? [])];
		this.mindSettings = opts.mindSettings;
		this._wiring = opts.wiring ?? unwired();
		this._wiring.fields = {
			setMind: (mind) => {
				this._mind = mind;
			},
			setCollective: (collective) => {
				this._collective = collective;
			},
			load: (json) => {
				this.loadJSON(json);
				this.tags = [...json.tags];
				this.mindSettings = json.mindSettings;
			},
			keepLaw: (law) => this.keepLaw(law),
		};
	}

	/** Its own mind, or its collective's. Null when the host drives it. */
	public get mind():Mind<TCtx> | null {
		return this._collective?.mind ?? this._mind;
	}

	/**
	 * Think with `mind` from now on, out of any collective. A collective's mind joins that collective instead.
	 * `null` hands the character to the host and forgets its mind's settings. Another character's mind throws.
	 * The arc it is running keeps running.
	 */
	public set mind(mind:Mind<TCtx> | null) {
		this._wiring.setMind(this, mind);
	}

	public get collective():Collective<TCtx> | null {
		return this._collective;
	}

	/**
	 * Move into `collective`, straight from any other, or leave with `null`: then it thinks with a fresh mind of
	 * its own when it had settings for one, else the host drives it. Its laws, tags and running arc come along.
	 */
	public set collective(collective:Collective<TCtx> | null) {
		this._wiring.setCollective(this, collective);
	}

	/** A character acts for itself. */
	public get voice():ArcRunner<TCtx> {
		return this;
	}

	/** In a collective, its laws live there as its own: `flee` is kept as `Tom.flee` and reaches only it. */
	public override addLaw(spec:LawSpec, pinned = false):Law | undefined {
		const home = this._collective;
		if (!home) {
			return super.addLaw(spec, pinned);
		}
		const own = home.laws.filter((law) => lawGroup(law.name) === this.id).length;
		return home.addLaw({ ...spec, who: 'me', name: `${this.id}.${spec.name ?? `law_${own + 1}`}` }, pinned);
	}

	public override removeLaw(name:string):void {
		if (this._collective) {
			this._collective.removeLaw(`${this.id}.${name}`);
			return;
		}
		super.removeLaw(name);
	}

	public override toJSON():CharacterJSON {
		return {
			...super.toJSON(),
			persona: this.persona.toJSON(),
			tags: [...this.tags],
			mind: this._mind?.toJSON(),
			mindSettings: this.mindSettings && { ...this.mindSettings },
		};
	}
}
