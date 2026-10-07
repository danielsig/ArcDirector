import type { Arc } from '../arc/types.js';
import { lawGroup, type Law } from '../arc/laws.js';
import type { ArcHandler } from '../arc/run.js';
import { ArcRunner, type ArcRunnerJSON, type RunnerOptions } from '../character/arc-runner.js';
import type { Character } from '../character/character.js';
import { Persona, type PersonaJSON } from '../character/persona.js';
import { Mind, type MindJSON } from '../mind/mind.js';
import type { CharacterSpec } from '../director/types.js';
import { squadTag, isSquadTag, shortTag } from './tags.js';
import { MIND_ONLY_VERBS, STOCK_ARC_VERBS } from '../arc/stock-verbs.js';
import { STOCK_COLLECTIVE_VERBS } from './verbs.js';

/** Verbs only a collective's voice runs: issuing, tagging, formations, laws, and the mind's own. */
const VOICE_VERBS = new Set<string>([...STOCK_COLLECTIVE_VERBS, ...STOCK_ARC_VERBS, ...MIND_ONLY_VERBS]);

/** A collective's part of a save. Its characters are saved on their own and listed here by id. */
export type CollectiveJSON = ArcRunnerJSON & {
	persona:PersonaJSON;
	mind:MindJSON;
	/** Its characters' ids, in order. */
	characters:string[];
	commander?:string;
};

/** @internal What a collective asks of the director that runs it. */
export type CollectiveHost<TCtx> = {
	addCharacter(spec:CharacterSpec<TCtx>, into:Collective<TCtx>):Character<TCtx>;
	removeCharacter(id:string):void;
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
	readonly persona:Persona;
	readonly mind:Mind<TCtx>;
	onCommanderVacant?:(character:Character<TCtx>)=>void;
	/** @internal Its characters, in order. Only the director changes it. */
	members:Character<TCtx>[] = [];
	private chief:Character<TCtx> | null = null;
	private readonly host:CollectiveHost<TCtx>;

	constructor(opts:CollectiveOptions<TCtx>) {
		super({ ...opts, defaultLawWho: opts.defaultLawWho ?? 'units' });
		this.persona = opts.persona ?? new Persona();
		this.mind = opts.mind ?? new Mind<TCtx>();
		this.host = opts.host;
		this.onCommanderVacant = opts.onCommanderVacant;
	}

	get characters():readonly Character<TCtx>[] {
		return this.members;
	}

	character(id:string):Character<TCtx> | undefined {
		return this.members.find((c) => c.id === id);
	}

	/** The character the mind acts through, or null when it has none. */
	get commander():Character<TCtx> | null {
		return this.chief;
	}

	set commander(character:Character<TCtx> | null) {
		if (character === null) {
			if (this.chief) {
				this.vacate(this.chief);
			}
			return;
		}
		if (!this.members.includes(character)) {
			throw new Error(`ArcDirector: '${character.id}' is not in '${this.id}'`);
		}
		this.chief = character;
	}

	/** The commander, or the collective itself while it has none. */
	get voice():ArcRunner<TCtx> {
		return this.chief ?? this;
	}

	/** A new character, in this collective. Its kit is its spec's, or the director's default. */
	addCharacter(spec:CharacterSpec<TCtx>):Character<TCtx> {
		return this.host.addCharacter(spec, this);
	}

	/** Remove one of its characters for good, as `ArcDirector.removeCharacter` does. */
	removeCharacter(id:string):void {
		if (!this.character(id)) {
			throw new Error(`ArcDirector: no '${id}' in '${this.id}'`);
		}
		this.host.removeCharacter(id);
	}

	/** @internal The commander left: drop the post, stop the think it was the voice for, and tell the host. */
	vacate(character:Character<TCtx>):void {
		if (this.chief !== character) {
			return;
		}
		this.chief = null;
		this.mind.abortThink();
		this.onCommanderVacant?.(character);
	}

	override lawsTakeWho():boolean {
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
	lawHandlersFor(member:Character<TCtx>, matches:(law:Law)=>boolean):ArcHandler[] {
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

	tagCharacters(characters:readonly Character<TCtx>[], short:string):void {
		const stored = squadTag(this.id, short);
		for (const character of characters) {
			if (!character.tags.includes(stored)) {
				character.tags = [...character.tags, stored];
			}
		}
	}

	untagCharacters(characters:readonly Character<TCtx>[], short:string):void {
		const stored = squadTag(this.id, short);
		for (const character of characters) {
			character.tags = character.tags.filter((t) => t !== stored);
		}
	}

	ownsTag(stored:string):boolean {
		return isSquadTag(this.id, stored);
	}

	shortOf(stored:string):string {
		return shortTag(this.id, stored);
	}

	/** Give each of `characters` but the commander `arc` as its program, replacing what it ran. */
	issue(characters:readonly Character<TCtx>[], arc:Arc):void {
		for (const character of characters) {
			if (character !== this.chief) {
				void character.enact(arc);
			}
		}
	}

	/** The roster, the laws, and the programs the characters run, for the mind's prompt. */
	promptSection(mind:Mind<TCtx>):string {
		const parts:string[] = [];
		if (this.members.length > 0) {
			const lines = this.members.map((character) => {
				const tags = character.tags.map((t) => this.shortOf(t)).filter((t) => t.length > 0);
				const lacks = this.lacking(character);
				const notes = [
					character === this.chief ? 'you' : '',
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
		for (const character of this.members) {
			if (character === this.chief || !character.busy || !character.arc) {
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

	override toJSON():CollectiveJSON {
		return {
			...super.toJSON(),
			persona: this.persona.toJSON(),
			mind: this.mind.toJSON(),
			characters: this.members.map((c) => c.id),
			commander: this.chief?.id,
		};
	}

	/** @internal A saved collective's runner part. Its persona, mind and characters are rebuilt by the director. */
	load(json:CollectiveJSON):void {
		this.loadJSON(json);
	}
}
