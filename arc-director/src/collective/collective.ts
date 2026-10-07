import type { Arc } from '../arc/types.js';
import { lawGroup, type Law } from '../arc/laws.js';
import type { ArcHandler } from '../arc/run.js';
import { ArcRunner, type ArcRunnerJSON, type RunnerOptions } from '../character/arc-runner.js';
import type { Character } from '../character/character.js';
import { Persona, type PersonaJSON } from '../character/persona.js';
import { Mind, type MindJSON } from '../mind/mind.js';
import type { CharacterSpec } from '../director/types.js';
import { squadTag, isSquadTag, shortTag, shortTags } from './tags.js';
import { MIND_ONLY_VERBS, STOCK_ARC_VERBS } from '../arc/stock-verbs.js';
import { isFormationVerb, STOCK_COLLECTIVE_VERBS } from './verbs.js';

/** Verbs only a collective's voice runs: issuing, tagging, laws, and the mind's own. Formations are its characters'. */
const VOICE_VERBS = new Set<string>([
	...STOCK_COLLECTIVE_VERBS.filter((verb) => !isFormationVerb(verb)),
	...STOCK_ARC_VERBS,
	...MIND_ONLY_VERBS,
]);

/** A collective's part of a save. Its characters are saved on their own and listed here by id. */
export type CollectiveJSON = ArcRunnerJSON & {
	persona:PersonaJSON;
	mind:MindJSON;
	/** Its characters' ids, in order. */
	characters:string[];
	commander?:string;
};

/**
 * How a collective and its director reach each other, one for each collective. The director gives `addCharacter`
 * and `removeCharacter`. The collective's constructor fills in `fields`: the director's only way into its private
 * fields.
 */
export type CollectiveHost<TCtx> = {
	addCharacter(spec:CharacterSpec<TCtx>, into:Collective<TCtx>):Character<TCtx>;
	removeCharacter(id:string):void;
	fields?:CollectiveFields<TCtx>;
};

/** What a collective's constructor hands its director through its {@link CollectiveHost}. */
export type CollectiveFields<TCtx> = {
	/** Its characters, in order. */
	setCharacters(characters:Character<TCtx>[]):void;
	/** The commander left: drop the post, stop the think it was the voice for, and tell the host. */
	vacate(character:Character<TCtx>):void;
	/** A saved collective's runner part. Its persona, mind and characters are rebuilt by the director. */
	load(json:CollectiveJSON):void;
	/** Keep `law` itself, not a copy, so an arc it started still counts as its own after a transfer. */
	keepLaw(law:Law):boolean;
};

export type CollectiveOptions<TCtx = unknown> = RunnerOptions<TCtx> & {
	host:CollectiveHost<TCtx>;
	persona?:Persona;
	mind?:Mind<TCtx>;
	/** The commander left or died. The host may name a new one (`collective.commander = …`). */
	onCommanderVacant?:(character:Character<TCtx>)=>void;
};

/**
 * Characters sharing one mind. The mind's arcs run on the `commander`, or on the collective itself while it has
 * none (a hive). Its own laws reach its characters by `who`; a character's own law lives here as
 * `Tom.flee` and reaches only Tom.
 */
export class Collective<TCtx = unknown> extends ArcRunner<TCtx> {
	public readonly persona:Persona;
	public readonly mind:Mind<TCtx>;
	public onCommanderVacant?:(character:Character<TCtx>)=>void;
	private _characters:Character<TCtx>[] = [];
	private _commander:Character<TCtx> | null = null;
	/** The characters each was last issued a program with. */
	private readonly _squads = new WeakMap<Character<TCtx>, readonly string[]>();
	private readonly _host:CollectiveHost<TCtx>;

	constructor(opts:CollectiveOptions<TCtx>) {
		super({ ...opts, defaultLawWho: opts.defaultLawWho ?? 'units' });
		this.persona = opts.persona ?? new Persona();
		this.mind = opts.mind ?? new Mind<TCtx>();
		this._host = opts.host;
		this.onCommanderVacant = opts.onCommanderVacant;
		this._host.fields = {
			setCharacters: (characters) => {
				this._characters = characters;
			},
			vacate: (character) => this.vacate(character),
			load: (json) => this.loadJSON(json),
			keepLaw: (law) => this.keepLaw(law),
		};
	}

	public get characters():readonly Character<TCtx>[] {
		return this._characters;
	}

	public character(id:string):Character<TCtx> | undefined {
		return this._characters.find((c) => c.id === id);
	}

	/** The character the mind acts through, or null when it has none. */
	public get commander():Character<TCtx> | null {
		return this._commander;
	}

	public set commander(character:Character<TCtx> | null) {
		if (character === null) {
			if (this._commander) {
				this.vacate(this._commander);
			}
			return;
		}
		if (!this._characters.includes(character)) {
			throw new Error(`ArcDirector: '${character.id}' is not in '${this.id}'`);
		}
		this._commander = character;
	}

	/** The commander, or the collective itself while it has none. */
	public get voice():ArcRunner<TCtx> {
		return this._commander ?? this;
	}

	/** It stands nowhere itself: its commander speaks and walks for its mind, and without one a character of its must. */
	public get embodied():boolean {
		return false;
	}

	/** With no commander it has no body, so its mind is offered only the verbs it runs itself, and `wait`. */
	protected override withheldVerbs():readonly string[] {
		const withheld = super.withheldVerbs();
		if (this._commander) {
			return withheld;
		}
		return [...withheld, ...this.refreshKit().verbs.filter((verb) => !VOICE_VERBS.has(verb) && verb !== 'wait')];
	}

	/** A new character, in this collective. Its kit is its spec's, or the director's default. */
	public addCharacter(spec:CharacterSpec<TCtx>):Character<TCtx> {
		return this._host.addCharacter(spec, this);
	}

	/** Remove one of its characters for good, as `ArcDirector.removeCharacter` does. */
	public removeCharacter(id:string):void {
		if (!this.character(id)) {
			throw new Error(`ArcDirector: no '${id}' in '${this.id}'`);
		}
		this._host.removeCharacter(id);
	}

	/** The commander left: drop the post, stop the think it was the voice for, and tell the host. */
	private vacate(character:Character<TCtx>):void {
		if (this._commander !== character) {
			return;
		}
		this._commander = null;
		this.mind.abortThink();
		this.onCommanderVacant?.(character);
	}

	public override lawsTakeWho():boolean {
		return true;
	}

	/** Own law names hold no `.`; `Tom.flee` is Tom's, and Tom must be here. */
	protected override lawNameOK(name:string):boolean {
		const group = lawGroup(name);
		return group === '' || this.character(group) !== undefined;
	}

	/**
	 * The laws that may reach `member`: the collective's own (when `matches` says their `who` names it), then its
	 * own `member.name` laws. Ranks follow that order, so the collective's own laws outrank a member's.
	 */
	public lawHandlersFor(member:Character<TCtx>, matches:(law:Law)=>boolean):ArcHandler[] {
		const out:ArcHandler[] = [];
		this.laws
			.filter((law) => [ '', member.id ].includes(lawGroup(law.name)))
			.forEach((law, rank) => {
				if (lawGroup(law.name) !== '' || matches(law)) {
					out.push({ source: law, watch: law.watch, arc: law.arc, rank });
				}
			});
		return out;
	}

	public tagCharacters(characters:readonly Character<TCtx>[], short:string):void {
		const stored = squadTag(this.id, short);
		for (const character of characters) {
			if (!character.tags.includes(stored)) {
				character.tags = [...character.tags, stored];
			}
		}
	}

	public untagCharacters(characters:readonly Character<TCtx>[], short:string):void {
		const stored = squadTag(this.id, short);
		for (const character of characters) {
			character.tags = character.tags.filter((t) => t !== stored);
		}
	}

	public ownsTag(stored:string):boolean {
		return isSquadTag(this.id, stored);
	}

	public shortOf(stored:string):string {
		return shortTag(this.id, stored);
	}

	/** Give each of `characters` but the commander `arc` as its program, replacing what it ran. */
	public issue(characters:readonly Character<TCtx>[], arc:Arc):void {
		const troops = characters.filter((character) => character !== this._commander);
		const squad = troops.map((character) => character.id);
		for (const character of troops) {
			this._squads.set(character, squad);
			void character.enact(arc);
		}
	}

	/** The characters `character` was last issued a program with that are still here, itself among them; else itself alone. */
	public squadOf(character:Character<TCtx>):string[] {
		const squad = (this._squads.get(character) ?? []).filter((id) => this.character(id));
		return squad.includes(character.id) ? squad : [character.id];
	}

	/** The roster, the laws, and the programs the characters run, for the mind's prompt. */
	public promptSection(mind:Mind<TCtx>):string {
		const parts:string[] = [];
		if (this._characters.length > 0) {
			const lines = this._characters.map((character) => {
				const tags = shortTags(this.id, character.tags);
				const lacks = this.lacking(character);
				const notes = [
					character === this._commander ? 'you' : '',
					lacks.length > 0 ? `cannot ${lacks.join(', ')}` : '',
				].filter(Boolean);
				const name = mind.nameOf(character.id);
				const note = notes.length > 0 ? ` (${notes.join('; ')})` : '';
				return tags.length > 0 ? `- ${name}: ${tags.join(', ')}${note}` : `- ${name}${note}`;
			});
			parts.push(`Units (issue who=units.filter("Tag") is this roster; allUnits is every troop, one program):\n${lines.join('\n')}`);
		}
		const laws = mind.lawsSection();
		if (laws) {
			parts.push(laws);
		}
		const groups = new Map<string, string[]>();
		for (const character of this._characters) {
			if (character === this._commander || !character.busy || !character.arc) {
				continue;
			}
			const key = mind.namedArc(character.arc);
			groups.set(key, [...groups.get(key) ?? [], mind.nameOf(character.id)]);
		}
		if (groups.size > 0) {
			const lines = [...groups].map(([arc, names]) => `- ${names.join(', ')}: ${arc}`);
			parts.push(`Unit programs:\n${lines.join('\n')}`);
		}
		return parts.join('\n');
	}

	/** Verbs of this collective's kit a character cannot run with its own. Its voice's verbs do not count. */
	private lacking(character:Character<TCtx>):string[] {
		const own = character.activeVerbs();
		return this.refreshKit().verbs.filter((verb) => !VOICE_VERBS.has(verb) && !own.has(verb));
	}

	public override toJSON():CollectiveJSON {
		return {
			...super.toJSON(),
			persona: this.persona.toJSON(),
			mind: this.mind.toJSON(),
			characters: this._characters.map((c) => c.id),
			commander: this._commander?.id,
		};
	}
}
