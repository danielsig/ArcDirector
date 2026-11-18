import { showNamingText } from '../character/text-with-ids.js';
import { isArc, type Arc, type ArcResult } from '../arc/arc-types.js';
import { lawGroup, lawHandler, type Law } from '../arc/laws.js';
import type { ArcHandler } from '../arc/run.js';
import { ArcRunner, type ArcRunnerJSON, type ProgramState, type RunnerFields, type RunnerOptions } from '../character/arc-runner.js';
import type { Character } from '../character/Character.js';
import { hand, internalsOf } from '../internals.js';
import { Mind, type MindJSON } from '../mind/mind.js';
import { programFilesSection, type ProgramFile } from '../mind/prompt.js';
import type { ArcDirector } from '../director/ArcDirector.js';
import type { CharacterSpec } from '../director/director-types.js';
import { squadTag, isSquadTag, shortTag, shortTags } from './tags.js';
import { CHOOSE_VERB, MIND_ONLY_VERBS, PASS_VERB, STOCK_ARC_VERBS, stepDoing, type VerbRegistry } from '../arc/stock-verbs.js';
import { isFormationVerb, STOCK_COLLECTIVE_VERBS } from './collective-verbs.js';
import { evaluateWho } from './who.js';

/** How many others each roster row says its units see: the nearest. */
const SEEN_PER_UNIT = 3;

/** What a group ordered without a name is called: the first free of these. */
const GROUP_LETTERS = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 'India', 'Juliett', 'Kilo', 'Lima', 'Mike', 'November', 'Oscar', 'Papa', 'Quebec', 'Romeo', 'Sierra', 'Tango', 'Uniform', 'Victor', 'Whiskey', 'Xray', 'Yankee', 'Zulu'];

/**
 * Verbs only a collective's voice runs: issuing, tagging, laws, and the mind's own. Formations are its characters'.
 * Arc verbs (`loop`, `choose`, …) shape arcs, so no character needs them in its own kit.
 */
const VOICE_VERBS = new Set<string>([
	...STOCK_COLLECTIVE_VERBS.filter((verb) => !isFormationVerb(verb)),
	...STOCK_ARC_VERBS,
	CHOOSE_VERB,
	...MIND_ONLY_VERBS,
]);

/** A collective's part of a save. Its characters are saved on their own and listed here by id. */
export type CollectiveJSON = ArcRunnerJSON & {
	mind:MindJSON;
	/** Its characters' ids, in order. */
	characters:string[];
	commander?:string;
};

/** What a collective's constructor hands its director: the director's only way into its private fields. */
export type CollectiveFields<TCtx> = RunnerFields<TCtx> & {
	/** Its characters, in order. */
	setCharacters(characters:Character<TCtx>[]):void;
	/** The commander left: drop the post, stop the think it was the voice for, and tell the host. */
	vacate(character:Character<TCtx>):void;
	/** A saved collective's runner part. Its persona, mind and characters are rebuilt by the director. */
	load(json:CollectiveJSON):void;
	/** Keep `law` itself, not a copy, so an arc it started still counts as its own after a transfer. */
	keepLaw(law:Law):boolean;
	/**
	 * The laws that may reach `member`: the collective's own (when `matches` says their `who` names it), then its
	 * own `member.name` laws. Ranks follow that order, so the collective's own laws outrank a member's.
	 */
	lawHandlersFor(member:Character<TCtx>, matches:(law:Law)=>boolean):ArcHandler[];
};

export type CollectiveOptions<TCtx = unknown> = RunnerOptions<TCtx> & {
	/** The director it is in: its world, its cast, and what its features say of the roster. */
	director:ArcDirector<TCtx>;
	mind?:Mind<TCtx>;
};

/**
 * Characters sharing one mind. The mind's arcs run on the `commander`, or on the collective itself while it has
 * none (a hive). Its own laws reach its characters by `who`; a character's own law lives here as
 * `Tom.flee` and reaches only Tom.
 */
export class Collective<TCtx = unknown> extends ArcRunner<TCtx> {
	public readonly mind:Mind<TCtx>;
	/** Most units one `command` may address at once. Unset to allow command to address all units. */
	public maxUnitsPerCommand?:number;
	private _characters:Character<TCtx>[] = [];
	private _commander:Character<TCtx> | null = null;
	/** The characters each was last issued a program with. */
	private readonly _squads = new WeakMap<Character<TCtx>, readonly string[]>();
	/** The group each character is in: the name of the last order that sent it with others, also a tag of it. */
	private readonly _groupOf = new Map<Character<TCtx>, string>();
	private readonly _director:ArcDirector<TCtx>;

	constructor(opts:CollectiveOptions<TCtx>) {
		super({ ...opts, defaultLawWho: opts.defaultLawWho ?? 'units' });
		this.mind = opts.mind ?? new Mind<TCtx>();
		this._director = opts.director;
		hand(this, {
			setCharacters: (characters) => {
				this._characters = characters;
			},
			vacate: (character) => this.vacate(character),
			load: (json) => this.loadJSON(json),
			keepLaw: (law) => this.keepLaw(law),
			lawHandlersFor: (member, matches) => this.lawHandlersFor(member, matches),
		} satisfies Omit<CollectiveFields<TCtx>, keyof RunnerFields<TCtx>>);
	}

	public get characters():readonly Character<TCtx>[] {
		return this._characters;
	}

	/** Its characters still standing: `units`, the roster and the programs leave out the fallen. */
	public get standing():readonly Character<TCtx>[] {
		return this._characters.filter((c) => !this._director.world?.hasFallen?.(c.id));
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
		// A unit that takes command leaves its group: its row is its own, `(you)`, and its group's name no longer picks it.
		this.joinGroup(character, undefined);
		this._commander = character;
	}

	/** The commander, or the collective itself while it has none. */
	public get voice():ArcRunner<TCtx> {
		return this._commander ?? this;
	}

	/** Its mind thinks for itself. */
	public get owner():ArcRunner<TCtx> {
		return this;
	}

	/** It stands nowhere itself: its commander speaks and walks for its mind, and without one a character of its must. */
	public get embodied():boolean {
		return false;
	}

	/**
	 * Whether `arc`, a reply of its mind, changes nothing: what remains of its voice's program, or commands each of whose
	 * units runs that command's arc already, from the step it is on ({@link ArcRunner.runs}).
	 */
	public override runs(arc:Arc):boolean {
		if (this._commander?.runs(arc) ?? super.runs(arc)) {
			return true;
		}
		const catalog = arc.length > 0 && arc.every((step) => step.verb === 'command') ? internalsOf(this._director).watches.catalog(this.voice) : undefined;
		return !!catalog && arc.every((step) => {
			const units = typeof step.args.who === 'string' ? evaluateWho(step.args.who, catalog, this).filter((c) => c !== this._commander) : [];
			return isArc(step.args.arc) && units.length > 0 && units.every((c) => c.runs(step.args.arc as Arc));
		});
	}

	/** Whether any of its characters but the commander runs a program: waiting then is supervising. */
	public working():boolean {
		return this._characters.some((c) => c !== this._commander && c.busy);
	}

	/**
	 * The verbs its prompt lists: its own, and as nested arc verbs (`command`, laws, `loop`) only what it or one of its
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

	/** A new character, in this collective: `character(id)` then. Its kit is its spec's, or the director's default. */
	public addCharacter(spec:CharacterSpec<TCtx>):this {
		internalsOf(this._director).cast.addTo(spec, this);
		return this;
	}

	/** Remove one of its characters for good, as `ArcDirector.removeCharacter` does. */
	public removeCharacter(id:string):this {
		if (!this.character(id)) {
			throw new Error(`ArcDirector: no '${id}' in '${this.id}'`);
		}
		this._director.removeCharacter(id);
		return this;
	}

	/** The commander left: drop the post, stop the think it was the voice for, and tell the host. */
	private vacate(character:Character<TCtx>):void {
		if (this._commander !== character) {
			return;
		}
		this._commander = null;
		this.mind.abortThink();
		internalsOf(this._director).tell('onCommanderVacant', this, character);
	}

	public override lawsTakeWho():boolean {
		return true;
	}

	/** Own law names hold no `.`; `Tom.flee` is Tom's, and Tom must be here. */
	protected override lawNameOK(name:string):boolean {
		const group = lawGroup(name);
		return group === '' || this.character(group) !== undefined;
	}

	private lawHandlersFor(member:Character<TCtx>, matches:(law:Law)=>boolean):ArcHandler[] {
		const out:ArcHandler[] = [];
		this.laws
			.filter((law) => [ '', member.id ].includes(lawGroup(law.name)))
			.forEach((law, rank) => {
				if (lawGroup(law.name) !== '' || matches(law)) {
					out.push(lawHandler(law, rank, member.id));
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
	 * Give each of `characters` but the commander `arc` as its program, replacing what it ran, or, to `append`, after
	 * it: its endless step ends, a loop at the end of its round (`ArcRunner.append`). Two or more sent together are a
	 * group: called `group`, else what {@link groupFor} names them, and tagged so; one sent alone leaves its group.
	 * The group's name, if they are one.
	 */
	public command(characters:readonly Character<TCtx>[], arc:Arc, group?:string, append = false):string | undefined {
		const troops = characters.filter((character) => character !== this._commander);
		const squad = troops.map((character) => character.id);
		const name = troops.length >= 2 ? this.groupFor(troops, group?.trim() || undefined) : undefined;
		for (const character of troops) {
			this.joinGroup(character, name);
			this._squads.set(character, squad);
			// The program it runs already, however it was worded this time, goes on as it is.
			if (character.runs(arc)) {
				continue;
			}
			// Run beside what it does, or after it, this is no program of its own: the orders it is under stand.
			const joins = character.liveArc && (append || character.takesNoBody(arc));
			// Its own copy: what is appended to it later is not appended to the others'.
			const orders = character.enact(structuredClone(arc), undefined, undefined, append ? 'append' : 'merge');
			if (joins) {
				continue;
			}
			character.orders = orders;
			void orders.finally(() => {
				// Parked on its `when`s, it is still under these orders.
				if (character.orders === orders && !character.arcSession?.parked) {
					character.orders = undefined;
				}
			});
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
		const status = internalsOf(this._director).features.map((feature) => feature.rosterStatus(this)).find(Boolean);
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
			const one = this.maxUnitsPerCommand === 1 ? 'a command names one unit' : '';
			const header = mind.compact
				? `Units (${[one, named, yours].filter(Boolean).join('; ')}):`
				: one
					? `Units (${one}; who=units.filter("Mira"), or a tag only one of them has${yours ? `; ${yours}` : ''}):`
					: `Units (command who=units.filter("Tag") is this roster; allUnits is every troop, one program; ${named}${yours ? `; ${yours}` : ''}):`;
			parts.push(`${header}\n${lines.join('\n')}`);
			const down = this._characters.filter((c) => !standing.includes(c));
			if (down.length > 0) {
				parts.push(`Fallen: ${down.map((c) => mind.nameOf(c.id)).join(', ')}`);
			}
		}
		const programs = this.standing
			.filter((character) => character !== this._commander)
			.flatMap((character) => {
				const state = character.programState();
				return state ? [{ character, name: mind.nameOf(character.id), state }] : [];
			});
		const laws = mind.lawsSection(this.lawsRunning(programs, mind));
		if (laws) {
			parts.push(laws);
		}
		const records = this.standing
			.filter((character) => character !== this._commander && character.busy && character.arc && !character.record.empty)
			.map((character) => `- ${mind.nameOf(character.id)}: ${character.record.toString((id) => mind.nameOf(id))}`);
		if (records.length > 0) {
			parts.push(`How each program is going (latest steps; failures say why; picked counts its choose picks). Reprogram what keeps failing, and keep what works:\n${records.join('\n')}`);
		}
		const commander = this._commander ?? this;
		const keep = commander.activeVerbs().has(PASS_VERB) ? mind.shownSteps([{ verb: PASS_VERB, args: {} }], commander.verbs, mind.arcFormat) : undefined;
		const files = programFilesSection(this.programFiles(programs, mind), keep);
		if (files) {
			parts.push(files);
		}
		return parts.join('\n');
	}

	/** By law name, who runs it now and at what step: `for Tom: flee(Wolf)`, for the Laws section. */
	private lawsRunning(programs:readonly UnitProgram<TCtx>[], mind:Mind<TCtx>):Map<string, string> {
		const by = new Map<string, Map<string, string[]>>();
		for (const { name, state } of programs) {
			if (state.law) {
				const step = state.law.step ? mind.namedArc([state.law.step]) : '';
				const steps = by.get(state.law.name) ?? new Map<string, string[]>();
				by.set(state.law.name, steps.set(step, [...steps.get(step) ?? [], name]));
			}
		}
		return new Map([...by].map(([law, steps]) => [law, [...steps].map(([step, names]) => `for ${names.join(', ')}${step ? `: ${step}` : ''}`).join('; ')]));
	}

	/**
	 * Its units' programs, running or ended, as files: one a program and group, named as its units are addressed (the
	 * group, or the one unit), each step a unit is on marked with who is there, like threads in a debugger, a step a
	 * reaction holds marked apart, and how it ended for each that finished.
	 */
	private programFiles(programs:readonly UnitProgram<TCtx>[], mind:Mind<TCtx>):ProgramFile[] {
		const files = new Map<string, ProgramDraft<TCtx>>();
		for (const unit of programs) {
			const { character, state } = unit;
			const lines = mind.programLines(state.arc, undefined, character.verbs).lines;
			// Named as its units are addressed: its group (units.filter("Vanguard") is exactly them), or the one unit.
			const name = this._groupOf.get(character) ?? unit.name;
			const key = `${name}\n${lines.join('\n')}`;
			const file = files.get(key) ?? { name, lines, units: [], on: [] };
			file.units.push(unit);
			for (const mark of state.marks) {
				const line = mind.programLines(state.arc, mark.step, character.verbs).at;
				if (line >= 0) {
					file.on.push({ line, name: unit.name, seconds: mark.seconds, held: mark.heldBy && mind.holderText(mark.heldBy) });
				}
			}
			files.set(key, file);
		}
		const health = (unit:UnitProgram<TCtx>):string => {
			const h = internalsOf(this._director).watches.healthOf(unit.character.id);
			return h ? ` ${h.hp}/${h.maxHP} hp` : '';
		};
		return [...files.values()].map(({ name, lines, units, on }) => {
			const running = units.filter((unit) => unit.state.running);
			const ended = units.filter((unit) => !unit.state.running);
			const marks = new Map<number, string>();
			const put = (line:number, mark:string):void => {
				marks.set(line, marks.has(line) ? `${marks.get(line)}; ${mark}` : mark);
			};
			const named = (there:readonly { name:string; seconds:number }[]):string => (there.length > 4 ? `${there.length} units`
				: there.length === 1 ? `${there[0].name}, ${there[0].seconds}s` : there.map((unit) => unit.name).join(', '));
			const moving = on.filter((mark) => !mark.held);
			for (const line of new Set(moving.map((mark) => mark.line))) {
				const there = moving.filter((mark) => mark.line === line);
				put(line, there.length === units.length && on.length === units.length
					? `← now, ${Math.max(...there.map((mark) => mark.seconds))}s`
					: `← ${named(there)}`);
			}
			for (const key of new Set(on.filter((mark) => mark.held).map((mark) => `${mark.line}:${mark.held}`))) {
				const there = on.filter((mark) => mark.held && `${mark.line}:${mark.held}` === key);
				put(there[0].line, `⏸ ${there.length > 4 ? `${there.length} units` : there.map((mark) => mark.name).join(', ')}, while ${there[0].held} runs`);
			}
			const endings = new Map<string, { ending:Ending; names:string[] }>();
			for (const unit of ended) {
				const ending = endingOf(unit.state.result, (id) => this.mind.nameOf(id));
				const key = `${ending.how}:${ending.why}`;
				endings.set(key, { ending, names: [...endings.get(key)?.names ?? [], unit.name] });
			}
			// All ended alike: how, once; else who ended how.
			const same = running.length === 0 && endings.size === 1;
			return {
				path: `programs/${name}.arc`,
				// Who runs it, as a who picks them all, and each by the name that picks it alone, its health beside it: a
				// program can be right for some of its units and wrong for one.
				who: `units.filter("${name}") = ${units.map((unit) => `${unit.name}${health(unit)}`).join(', ')}`,
				lines,
				marks,
				running: running.length > 0,
				seconds: Math.max(0, ...running.map((unit) => unit.state.seconds)),
				endings: [...endings.values()].map(({ ending, names }) => endingText(ending, same ? undefined : names.join(', '))),
			};
		});
	}

	/** What one of its characters is at now, for its roster row: its step in that verb's words (`protecting Dawn`), waiting, or idle. */
	private activityOf(character:Character<TCtx>, mind:Mind<TCtx>):string {
		if (character.verb && character.lastStep) {
			return character.verb === 'wait' ? 'waiting' : stepDoing(character.lastStep, this.verbs, (id) => mind.nameOf(id) || id);
		}
		return character.busy ? 'waiting' : 'idle';
	}

	/**
	 * How its last step went, for its roster row: `shoot failed: no target`, `protect ok`. None once its program has
	 * ended: its program file says how, once.
	 */
	private lastOf(character:Character<TCtx>):string {
		const last = character.lastResult;
		if (!last?.verb || last.status === 'stopped' || character.programState()?.running === false) {
			return '';
		}
		return last.status === 'ok' ? `${last.verb} ok` : `${last.verb} failed${last.reason ? `: ${showNamingText(last.reason, (id) => this.mind.nameOf(id))}` : ''}`;
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
		const health = members.map((c) => internalsOf(this._director).watches.healthOf(c.id)).filter((h) => h !== undefined);
		const seen = new Map<string, { away:number; text:string }>();
		for (const c of members) {
			for (const other of internalsOf(this._director).features.flatMap((feature) => feature.othersSeenBy(c.id, this, mind))) {
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

/** How a program ended: done, failed and why, or stopped by another. */
type Ending = { how:'done' | 'failed' | 'stopped'; why:string };

function endingOf(result:ArcResult | undefined, name:(id:string)=>string):Ending {
	if (result?.status === 'failed') {
		return { how: 'failed', why: (result.reason && showNamingText(result.reason, name)) || result.verb || '' };
	}
	return result?.status === 'stopped' ? { how: 'stopped', why: '' } : { how: 'done', why: 'ok' };
}

/** `done, ok`, `failed: no path`, `stopped`; with `who`, who ended so: `done: Mira, ok`, `failed: Mira, no path`. */
function endingText({ how, why }:Ending, who?:string):string {
	if (how === 'stopped') {
		return who ? `stopped: ${who}` : 'stopped';
	}
	return who ? `${how}: ${who}, ${why}` : `${how}${how === 'done' ? ',' : ':'} ${why}`;
}

/** One of its characters, by the name its mind knows it by, and the program it runs or ran. */
type UnitProgram<TCtx> = { character:Character<TCtx>; name:string; state:ProgramState };

/** One group's program, or one unit's, as the roster gathers it: who runs it, its lines, and where each is in it. */
type ProgramDraft<TCtx> = { name:string; lines:string[]; units:UnitProgram<TCtx>[]; on:{ line:number; name:string; seconds:number; held?:string }[] };
