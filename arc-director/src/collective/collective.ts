import type { Arc } from '../arc/types.js';
import { lawGroup, type Law } from '../arc/laws.js';
import type { ArcHandler } from '../arc/run.js';
import { ArcRunner, type ArcRunnerJSON, type RunnerOptions } from '../character/arc-runner.js';
import type { Character } from '../character/character.js';
import { Persona, type PersonaJSON } from '../character/persona.js';
import { Mind, type MindJSON } from '../mind/mind.js';
import type { CharacterSpec } from '../director/types.js';
import { squadTag, isSquadTag, shortTag, shortTags } from './tags.js';
import { CHOOSE_VERB, MIND_ONLY_VERBS, STOCK_ARC_VERBS, stepDoing, type VerbRegistry } from '../arc/stock-verbs.js';
import { isFormationVerb, STOCK_COLLECTIVE_VERBS } from './verbs.js';

/**
 * Verbs only a collective's voice runs: issuing, tagging, laws, and the mind's own. Formations are its characters'.
 * Arc verbs (`loop`, `choose`, …) shape arcs, so no character needs them in its own kit.
 */
/** How many others each roster row says its units see: the nearest. */
const SEEN_PER_UNIT = 3;

/** What a group ordered without a name is called: the first free of these. */
const GROUP_LETTERS = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 'India', 'Juliett', 'Kilo', 'Lima', 'Mike', 'November', 'Oscar', 'Papa', 'Quebec', 'Romeo', 'Sierra', 'Tango', 'Uniform', 'Victor', 'Whiskey', 'Xray', 'Yankee', 'Zulu'];

const VOICE_VERBS = new Set<string>([
	...STOCK_COLLECTIVE_VERBS.filter((verb) => !isFormationVerb(verb)),
	...STOCK_ARC_VERBS,
	CHOOSE_VERB,
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
	/** Whether one of its characters is down, as the world says (`HostWorld.isDown`). */
	isDown?(id:string):boolean;
	/** Who of no part of it one of its characters sees, nearest first: each one's name, how far, and in `mind`'s words (`EnemyKnight 12/28 hp 8m (in reach)`). */
	othersSeenBy?(id:string, mind:Mind<TCtx>):{ name:string; away:number; text:string }[];
	/** One of its characters' health, where the host gives an `hp` kernel. */
	healthOf?(id:string):{ hp:number; maxHP:number } | undefined;
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
	/**
	 * Its side at a glance, for its mind's prompt (an RTS's stock, supply, queues and units grouped by kind). When
	 * set, it stands in for the roster of every unit by name and their programs.
	 */
	public status?:()=>string;
	/** Most units one `issue` may address at once. Unset to allow issue to address all units. */
	public maxUnitsPerIssue?:number;
	private _characters:Character<TCtx>[] = [];
	private _commander:Character<TCtx> | null = null;
	/** The characters each was last issued a program with. */
	private readonly _squads = new WeakMap<Character<TCtx>, readonly string[]>();
	/** The group each character is in: the name of the last order that sent it with others, also a tag of it. */
	private readonly _groupOf = new Map<Character<TCtx>, string>();
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

	/** Its characters still standing: `units`, the roster and the programs leave out the ones that are down. */
	public get standing():readonly Character<TCtx>[] {
		return this._characters.filter((c) => !this._host.isDown?.(c.id));
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

	/** Whether any of its characters but the commander runs a program: waiting then is supervising. */
	public working():boolean {
		return this._characters.some((c) => c !== this._commander && c.busy);
	}

	/**
	 * The verbs its prompt lists: its own, and as nested arc verbs (`issue`, laws, `loop`) only what it or one of its
	 * characters can run, never what no one of it has (another faction's abilities). Parsing and the reply schema keep
	 * the whole catalog, the same for every mind.
	 */
	public promptVerbs():VerbRegistry {
		const own = this.activeVerbs();
		const names = new Set([...own.list().map((spec) => spec.name), ...this._characters.flatMap((c) => c.activeVerbs().list().map((spec) => spec.name))]);
		return own.nestedTo([...names]);
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
					out.push({ source: law, watch: law.watch, arc: law.arc, rank, hold: law.hold, holdBreak: law.holdBreak });
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

	/**
	 * Give each of `characters` but the commander `arc` as its program, replacing what it ran. Two or more sent
	 * together are a group: called `group`, else what {@link groupFor} names them, and tagged so; one sent alone
	 * leaves its group. The group's name, if they are one.
	 */
	public issue(characters:readonly Character<TCtx>[], arc:Arc, group?:string):string | undefined {
		const troops = characters.filter((character) => character !== this._commander);
		const squad = troops.map((character) => character.id);
		const name = troops.length >= 2 ? this.groupFor(troops, group?.trim() || undefined) : undefined;
		for (const character of troops) {
			this.joinGroup(character, name);
			this._squads.set(character, squad);
			void character.enact(arc);
		}
		return name;
	}

	/**
	 * What `troops`, ordered together, are called: `named`; else, when most of them come from one group, its name if
	 * they take most of it (two or more left behind are then split off from it, one left loses its name), or a split
	 * off from it if they take less (`Raiders2`); else the first free letter.
	 */
	private groupFor(troops:readonly Character<TCtx>[], named?:string):string {
		if (named) {
			return named;
		}
		const [from, came] = tally(troops.map((c) => this._groupOf.get(c) ?? '')).sort((x, y) => y[1] - x[1])[0];
		if (!from || came * 2 <= troops.length) {
			return this.freeGroupName();
		}
		const members = this._characters.filter((c) => this._groupOf.get(c) === from);
		if (came * 2 <= members.length) {
			return this.splitName(from);
		}
		const left = members.filter((c) => !troops.includes(c));
		const rest = left.length >= 2 ? this.splitName(from) : undefined;
		for (const character of left) {
			this.joinGroup(character, rest);
		}
		return from;
	}

	/**
	 * The name of a group split off from `from` without one of its own: its name with the next free number, counting
	 * on from any it has (`Raiders` and `Raiders2` both split into `Raiders3` once `Raiders2` is taken).
	 */
	private splitName(from:string):string {
		const base = from.replace(/\d+$/, '') || from;
		const used = new Set(this._groupOf.values());
		let n = 2;
		while (used.has(`${base}${n}`)) {
			n += 1;
		}
		return `${base}${n}`;
	}

	/** The first group letter none of its characters goes by now. */
	private freeGroupName():string {
		const used = new Set(this._groupOf.values());
		return GROUP_LETTERS.find((letter) => !used.has(letter)) ?? `Group${used.size + 1}`;
	}

	/** `character` moves to group `name`, or out of any: its tag goes with it. */
	private joinGroup(character:Character<TCtx>, name:string | undefined):void {
		const was = this._groupOf.get(character);
		if (was === name) {
			return;
		}
		if (was !== undefined) {
			this.untagCharacters([character], was);
			this._groupOf.delete(character);
		}
		if (name !== undefined) {
			this.tagCharacters([character], name);
			this._groupOf.set(character, name);
		}
	}

	/**
	 * The characters `character` was last issued a program with that are still here, itself among them; else every
	 * character of the collective, so a law reaching each unit on its own (`spread_out`) still lines them all up.
	 */
	public squadOf(character:Character<TCtx>):string[] {
		const squad = (this._squads.get(character) ?? []).filter((id) => this.character(id));
		return squad.includes(character.id) ? squad : this._characters.map((c) => c.id);
	}

	/** The roster, the laws, and the programs the characters run, for the mind's prompt. */
	public promptSection(mind:Mind<TCtx>):string {
		const parts:string[] = [];
		const status = this.status?.();
		if (status) {
			parts.push(status);
		}
		else if (this._characters.length > 0) {
			const standing = this.standing;
			const lines = [
				'| Unit or group | Kind | HP | Doing | Last result | Others it sees | Can |',
				'|---|---|---|---|---|---|---|',
				...this.rosterRows(standing, mind).map((cells) => `| ${cells.map((cell) => cell.replace(/\|/g, '/') || '—').join(' | ')} |`),
			];
			// A law reaches `units` by default, so a commander must be told how its own laws reach it too.
			const yours = this._commander && this.refreshKit().verbs.includes('law') ? 'a law reaches you too only with who=allUnits' : '';
			const named = 'a group\'s name picks its units: units.filter("Alpha")';
			const one = this.maxUnitsPerIssue === 1 ? 'an issue names one unit' : '';
			const header = mind.compact
				? `Units (${[one, named, yours].filter(Boolean).join('; ')}):`
				: one
					? `Units (${one}; who=units.filter("Mira"), or a tag only one of them has${yours ? `; ${yours}` : ''}):`
					: `Units (issue who=units.filter("Tag") is this roster; allUnits is every troop, one program; ${named}${yours ? `; ${yours}` : ''}):`;
			parts.push(`${header}\n${lines.join('\n')}`);
			const down = this._characters.filter((c) => !standing.includes(c));
			if (down.length > 0) {
				parts.push(`Down: ${down.map((c) => mind.nameOf(c.id)).join(', ')}`);
			}
		}
		const laws = mind.lawsSection();
		if (laws) {
			parts.push(laws);
		}
		const groups = new Map<string, string[]>();
		const records:string[] = [];
		for (const character of this.standing) {
			if (character === this._commander || !character.busy || !character.arc) {
				continue;
			}
			const key = mind.namedArc(character.arc);
			groups.set(key, [...groups.get(key) ?? [], mind.nameOf(character.id)]);
			if (!character.record.empty) {
				records.push(`- ${mind.nameOf(character.id)}: ${character.record}`);
			}
		}
		if (groups.size > 0 && !status) {
			const lines = [...groups].map(([arc, names]) => `- ${names.join(', ')}: ${arc}`);
			parts.push(`Unit programs:\n${lines.join('\n')}`);
		}
		if (records.length > 0) {
			parts.push(`How each program is going (latest steps; failures say why; picked counts its choose picks). Reprogram what keeps failing, and keep what works:\n${records.join('\n')}`);
		}
		return parts.join('\n');
	}

	/** What one of its characters is at now, for its roster row: its step in that verb's words (`protecting Dawn`), waiting, or idle. */
	private activityOf(character:Character<TCtx>, mind:Mind<TCtx>):string {
		if (character.verb && character.lastStep) {
			return character.verb === 'wait' ? 'waiting' : stepDoing(character.lastStep, this.verbs, (id) => mind.nameOf(id) || id);
		}
		return character.busy ? 'waiting' : 'idle';
	}

	/** How its last step went, for its roster row: `shoot failed: no target`, `protect ok`; so a program that failed and ended is seen. */
	private lastOf(character:Character<TCtx>):string {
		const last = character.lastResult;
		if (!last?.verb || last.preempted) {
			return '';
		}
		return last.ok ? `${last.verb} ok` : `${last.verb} failed${last.reason ? `: ${last.reason}` : ''}`;
	}

	/**
	 * Its roster's rows, in roster order: one for each group of two or more standing, where its first member stands,
	 * and one for each character on its own: name, kind, health, what it is at, how its last step went, who it sees,
	 * and what it can do.
	 */
	private rosterRows(standing:readonly Character<TCtx>[], mind:Mind<TCtx>):string[][] {
		const groups = new Map<string, Character<TCtx>[]>();
		for (const character of standing) {
			const name = character === this._commander ? undefined : this._groupOf.get(character);
			if (name !== undefined) {
				groups.set(name, [...groups.get(name) ?? [], character]);
			}
		}
		const rows:string[][] = [];
		const shown = new Set<string>();
		for (const character of standing) {
			const name = this._groupOf.get(character);
			const members = name === undefined ? undefined : groups.get(name);
			if (name !== undefined && members && members.length >= 2) {
				if (!shown.has(name)) {
					shown.add(name);
					rows.push(this.groupRow(name, members, mind));
				}
				continue;
			}
			rows.push(this.groupRow(`${mind.nameOf(character.id)}${character === this._commander ? ' (you)' : ''}`, [character], mind));
		}
		return rows;
	}

	/** The roster row of `members`, one character or a group, under `title`. */
	private groupRow(title:string, members:readonly Character<TCtx>[], mind:Mind<TCtx>):string[] {
		const you = members.includes(this._commander!);
		// Its kind is its tags, but for the group it is in: that is the row's name.
		const kinds = tally(members.map((c) => shortTags(this.id, c.tags).filter((t) => t !== this._groupOf.get(c)).join(', ') || 'unit'));
		const health = members.map((c) => this._host.healthOf?.(c.id)).filter((h) => h !== undefined);
		const seen = new Map<string, { away:number; text:string }>();
		for (const c of members) {
			for (const other of this._host.othersSeenBy?.(c.id, mind) ?? []) {
				if (other.away < (seen.get(other.name)?.away ?? Infinity)) {
					seen.set(other.name, other);
				}
			}
		}
		const last = members.map((c) => this.lastOf(c)).filter(Boolean);
		const failed = last.filter((l) => l.includes(' failed'));
		const own = [...new Set(members.flatMap((c) => this.verbsOf(c).own))];
		const lacks = [...new Set(members.flatMap((c) => this.verbsOf(c).lacks))];
		return [
			title,
			members.length === 1 ? kinds[0][0] : kinds.map(([kind, n]) => `${n} ${kind}`).join(' + '),
			health.length > 0 ? `${Math.ceil(health.reduce((sum, h) => sum + h.hp, 0))}/${health.reduce((sum, h) => sum + h.maxHP, 0)}` : '',
			you ? '' : counted(members.map((c) => this.activityOf(c, mind)), members.length),
			you ? '' : tally(failed.length > 0 ? failed : last.slice(0, 1)).map(([text, n]) => (n > 1 ? `${text} ×${n}` : text)).join('; '),
			[...seen.values()].sort((a, b) => a.away - b.away).slice(0, SEEN_PER_UNIT).map((o) => o.text).join('; '),
			[own.length > 0 ? own.join(', ') : '', lacks.length > 0 ? `not ${lacks.join(', ')}` : ''].filter(Boolean).join('; '),
		];
	}

	/** What `character` can do that the collective's own kit cannot, and what of that kit it cannot do: its roster line. */
	private verbsOf(character:Character<TCtx>):{ own:string[]; lacks:string[] } {
		const active = character.activeVerbs();
		const kit = this.refreshKit().verbs;
		return {
			own: active.list().map((spec) => spec.name).filter((verb) => !kit.includes(verb)),
			lacks: kit.filter((verb) => !VOICE_VERBS.has(verb) && !active.has(verb)),
		};
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

/** Each distinct entry of `items` and how many times it comes, in first-seen order. */
function tally(items:readonly string[]):[string, number][] {
	const counts = new Map<string, number>();
	for (const item of items) {
		counts.set(item, (counts.get(item) ?? 0) + 1);
	}
	return [...counts];
}

/** `items` as one phrase when all agree, else each with its count: `2 going to Mistgreen; 1 idle`. */
function counted(items:readonly string[], of:number):string {
	const counts = tally(items);
	return counts.length === 1 ? counts[0][0] : counts.map(([item, n]) => `${n === of ? '' : `${n} `}${item}`).join('; ');
}
