import type { VerbArgMap } from '../arc/stock-verbs.js';
import type { ArcResult, CountMap, StepArg } from '../arc/types.js';
import type { VerbAlias, VerbCall } from '../director/types.js';
import { buildCatalog, dummyEntity, type HostKernels } from '../expr/natives.js';
import { SampleCache, type Catalog, type ExprEntity, type ExprVal } from '../expr/types.js';
import { DEFAULT_YOU_SYMBOL, type MapMark, type MapSense } from '../mind/map.js';
import type { SpeechUtterance } from '../mind/talk.js';
import type { Inventory } from '../perception/inventory.js';
import type { KindSpec } from '../rts/types.js';
import { doingOf } from '../arc/stock-verbs.js';
import type { Sight } from '../perception/types.js';
import { geometryKernels } from '../world/kernels.js';
import { RESERVED_TAGS, type HostWorld, type Outcome, type PathStep, type Pose, type Transfer, type Vec } from '../world/types.js';
import { distance } from '../world/vec.js';
import { ABILITIES, FIGHTERS, Fighter, type Effect, type StatusKind, type Tactic } from './combat.js';

/** Where someone or something is, seen from the one the scene is about, and what a character there has. */
export type SceneSpot = {
	away:number;
	side:'ahead' | 'behind' | 'left' | 'right';
	/** Paces east (+) and south (+) of its point on its side: anywhere, not only on the four lines out from `me`. */
	offset?:[number, number];
	hp?:[number, number];
	/** What kind of fighter stands here, of {@link FIGHTERS}: its health, speed and abilities. */
	as?:string;
	/** Whose side a fighter is on. Default: a foe's (`them`). The scene's character and its squad are `us`. */
	team?:string;
	/** How a fighter nobody commands fights. Default: it stands still. */
	tactic?:Tactic;
	/** Whom a charging fighter goes for first. Default: the nearest foe. */
	focus?:string;
	/** Where a marching fighter (`tactic: 'march'`) heads: a place, a thing or someone, by name. */
	toward?:string;
	/** How near its post a foe must come for a guard (`tactic: 'guard'`) to go for it, in paces. Default {@link GUARD}. */
	guard?:number;
	/** What already ails a fighter when the scene starts: a burn, a root. */
	suffering?:Effect[];
	/** A squad fighter's tags, which its commander's orders can pick it by. */
	tags?:string[];
	/** What a character here carries, one entry per item. */
	carrying?:string[];
	gold?:number;
	/** A character's standing offers, to anyone. */
	offers?:{ give:CountMap; get:CountMap }[];
	/** What `examine` tells of it. Default: nothing out of the ordinary. */
	description?:string;
	/**
	 * What it is in the scene's RTS ({@link Scene.rts}): one of its kinds, such as a building, a worker or a
	 * resource node. Default: its fighter kind (`as`).
	 */
	kind?:string;
	/** What a resource node has left to gather. */
	amount?:number;
};

/**
 * The scene as an RTS (`withRTS`): its kinds, beyond the fighters (each fighter kind is one already, its abilities its
 * verbs), and the stock each side starts with, by side: `us`, or an ally's id.
 */
export type SceneRTSSpec = {
	kinds?:Record<string, KindSpec>;
	stock?:Record<string, CountMap>;
	/** Characters of other sides allied with `me`'s: whom `tribute` reaches. */
	allies?:string[];
};

/** One character's moment, as a scenario stages it: who and what is where, how hurt, what it carries, and what it wants. */
export type Scene = {
	me:{ id:string; hp?:[number, number]; as?:string };
	/** Characters around, by name. */
	others?:Record<string, SceneSpot>;
	/** Fighters `me` commands, by name: its collective, which it thinks for and issues orders to. */
	squad?:Record<string, SceneSpot>;
	/** Things and places around, by name. Any of them can be picked up. */
	things?:Record<string, SceneSpot>;
	/** What `me` carries, one entry per item. */
	carrying?:string[];
	/** Gold in `me`'s purse. */
	gold?:number;
	goal:string;
	/** The scene is an RTS, which `me`'s squad plays with the stock RTS verbs. */
	rts?:SceneRTSSpec;
};

/**
 * A verb only this scene has, as a game would give its NPCs (`construct`, `recruit`): `run` acts on the world and says
 * what happened, or how it failed (`short 40 Wood`); or it is an alias, an arc of other verbs.
 */
export type SceneVerb = {
	args?:VerbArgMap;
	help?:string;
	/** How others see one running it, with `{arg}` holes (`reviving {target}`). Default: the verb with `-ing`. */
	seen?:string;
	/**
	 * `me`'s squad runs it too, as an order (`issue(who=…, arc=ambush(…))`), not only `me`. In an RTS scene a kind's
	 * own verbs come from its `KindSpec.verbs` instead.
	 */
	units?:boolean;
} & (
	/**
	 * What happened, or a promise of it, for a verb that ends later (a battle move that waits for its round to resolve,
	 * a revive held for seconds). When a reaction or a new order takes over, the step ends at once, interrupted, and
	 * `signal` aborts: a verb that keeps work going (a revive's progress, its sound) stops it there.
	 */
	| { run:(world:SceneWorld, call:{ who:string; args:Readonly<Record<string, StepArg>>; signal:AbortSignal })=>string | Outcome | Promise<string | Outcome> }
	| VerbAlias
);

/** How a scene's world answers beyond walking, carrying and trading. */
export type SceneRules = {
	/** Verbs this scene adds for `me` (and its squad's commander), beside the stock ones. */
	verbs?:Record<string, SceneVerb>;
	/**
	 * What using an item does, by `'Item>Target'`, or `'Item'` used on nothing: what happened, or how it failed
	 * (`the Forge is cold`). Any other use does nothing.
	 */
	uses?:Record<string, (world:SceneWorld)=>string | Outcome>;
	/** Whether `from` can see `to`. Default: everyone sees everything. */
	sees?:(world:SceneWorld, from:string, to:string)=>boolean;
	/** What stops a walk onto `point` now (`Bridge is raised`), if anything. Default: nothing. */
	blocks?:(world:SceneWorld, point:Vec)=>string | undefined;
	/** What the watch language reads on `id` now, beyond who it is: a kiln's `heat`. Default: nothing more. */
	fields?:(world:SceneWorld, id:string)=>Record<string, number | boolean> | undefined;
	/**
	 * What a blow deals once it lands, from what it would: more from high ground, less behind cover, as the scene's
	 * rules have it. Default: what it would.
	 */
	damage?:(world:SceneWorld, by:string, target:string, damage:number)=>number;
	/** What sight notes on `id` now beyond its health, statuses and side (`knocked`). Default: nothing more. */
	notes?:(world:SceneWorld, id:string)=>string | undefined;
	/**
	 * Paces a close-in fighter needs to itself to strike a foe: one standing that near an ally nearer the same foe (or as
	 * near, and placed first) waits its turn, so a column fights one at a time and a ring all at once. Default: no limit.
	 */
	crowding?:number;
};

/** The side `me` and its squad fight on, and every other fighter's by default. */
export const US = 'us';
export const THEM = 'them';
/** Paces a second a character who is no fighter walks. */
const WALK = 3;
/** How long a fighter waiting to act waits at a time, in seconds. */
const BEAT = 0.5;
/** How close counts as in reach. */
const REACH = 1.5;
/** What counts as nearby, so `flee` knows how far to run. */
const NEAR = 8;
/** How near its post a foe must come for a guard to go for it, by default. */
const GUARD = 6;
/** How far past its reach a marching fighter turns aside to fight what it meets. */
const MARCH_REACH = 2;
/** How long after using an ability a fighter is still seen doing it, in seconds: about two of its blows. */
const SEEN_DOING = 2;
/** The longest reach a blow has that {@link SceneRules.crowding} limits: close in. */
const CLOSE_IN = 2;

/** `me` stands at the origin facing north (−Z), its right hand east (+X). */
const FACING:Pick<Pose, 'facing' | 'right'> = { facing: [0, -1], right: [1, 0] };

/** The grid steps from a whole pace: itself and its four neighbors. */
const GRID = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]];

/** Each {@link SceneSpot} side as a direction from the origin. */
const SIDES = { ahead: [0, -1], behind: [0, 1], left: [-1, 0], right: [1, 0] } as const;

function pointOf(spot:SceneSpot):Vec {
	return SIDES[spot.side].map((d, i) => d * spot.away + (spot.offset?.[i] ?? 0));
}

/**
 * Every kind a scene has: each fighter kind as an RTS kind (its basic attack's reach, its abilities as its verbs,
 * `Splash` when one hits many foes at once), then the scene's own.
 */
export function sceneKinds(scene:Pick<Scene, 'rts'>):Record<string, KindSpec> {
	const fighters = Object.entries(FIGHTERS).map(([name, kind]):[string, KindSpec] => {
		const basic = kind.abilities.find((a) => ABILITIES[a].repeat);
		const splash = kind.abilities.some((a) => ABILITIES[a].splash && (ABILITIES[a].on ?? 'foe') === 'foe');
		return [name, { range: basic ? ABILITIES[basic].range : 1, verbs: [...kind.abilities], tags: splash ? ['Splash'] : [] }];
	});
	return { ...Object.fromEntries(fighters), ...scene.rts?.kinds };
}

/** A blank square the map is stamped on. Where there is no canvas to stamp it, the legend alone names what is there. */
const BLANK_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
const MAP_SIZE = 256;
/** One per mark, in scene order. */
const MARKS = ['🔴', '🔵', '🟢', '🟡', '🟣', '🟠', '🟤', '⚫', '⚪'];

/**
 * A scene played out on an open grid: characters walk, items lie on the ground or change hands, trades and uses
 * happen, and foes fall. The director's stock verbs act on it as on any game's world, so what an arc does to it is
 * what it would do in play. Asked afterwards whether a goal was reached.
 */
export class SceneWorld implements HostWorld<string> {
	public readonly scene:Scene;
	/** Lines spoken, with who heard them. */
	public readonly said:SpeechUtterance[] = [];
	/** What uses made true (`VaultDoor open`). */
	public readonly flags = new Set<string>();
	/** What a case's rules measure as play goes on (a kiln's heat, buckets carried), by name. */
	public readonly meters = new Map<string, number>();
	/** Characters who fell, in order. */
	public readonly downed:string[] = [];
	/** Seconds since the arc started. */
	public time = 0;
	/** Whether a squad fighter, its commander too, is idle (or only waiting), so it strikes back at foes in reach on its own. Set by whoever stages it. */
	public idle:((id:string)=>boolean) | undefined;
	private readonly _rules:SceneRules;
	/** Every kind on the scene, fighters' and the RTS's: what a thing's kind tags it with. */
	public readonly kinds:Readonly<Record<string, KindSpec>>;
	private readonly _characters:string[];
	/** `me`, its squad, and who joined the squad since: whom `me`'s mind runs. */
	private readonly _commanded = new Set<string>();
	/** Where characters stand and things lie. A carried item has no point. */
	private readonly _points = new Map<string, Vec>();
	/** What each character holds, by item. */
	private readonly _held = new Map<string, Map<string, number>>();
	/** Everyone with health: fighters, and the hurt. */
	private readonly _fighters = new Map<string, Fighter>();
	/** Each one's kind, of {@link kinds}. */
	private readonly _kinds = new Map<string, string>();
	/** What each resource node has left. */
	private readonly _amounts = new Map<string, number>();
	/** Whose side each character or thing is on, when it has one. */
	private readonly _teams = new Map<string, string>();
	/** Each side's stock in an RTS, by team: `us`, or an ally's id. */
	private readonly _stock = new Map<string, CountMap>();
	/** Things and places, the scene's own and any that came since (a fallen fighter's box, a banner). */
	private readonly _things = new Set<string>();
	/** What `examine` tells of a thing that came since. */
	private readonly _descriptions = new Map<string, string>();
	/** Fighters inside a building or transport: out of every fight until they come out. */
	private readonly _sheltered = new Set<string>();
	/** How far each character may still walk this tick. */
	private readonly _stride = new Map<string, number>();
	/** Where each marching fighter heads, by name. */
	private readonly _toward = new Map<string, string>();
	/** Each guard's post, and how near it a foe must come. */
	private readonly _posts = new Map<string, { at:Vec; within:number }>();
	/** Casts a verb is running ({@link useAbility}), which land when it says. */
	private readonly _verbCasts = new WeakSet<object>();
	/** How often each character was stopped ({@link abort}), so an ability running for it gives way. */
	private readonly _aborts = new Map<string, number>();
	/** What to stop when each one is aborted: the verbs running for it that end later. */
	private readonly _onAbort = new Map<string, Set<()=>void>>();
	private _dt = 0;

	constructor(scene:Scene, rules:SceneRules = {}) {
		this.scene = scene;
		this._rules = rules;
		this.kinds = sceneKinds(scene);
		for (const [team, stock] of Object.entries(scene.rts?.stock ?? {})) {
			this._stock.set(team, { ...stock });
		}
		this._characters = [scene.me.id];
		this._points.set(scene.me.id, [0, 0]);
		this.join(scene.me.id, { ...scene.me, team: US }, scene, true);
		for (const [id, spot] of Object.entries(scene.squad ?? {})) {
			this.place(id, pointOf(spot), { ...spot, team: US }, true);
		}
		for (const [id, spot] of Object.entries(scene.others ?? {})) {
			this.place(id, pointOf(spot), spot);
		}
		for (const [id, spot] of Object.entries(scene.things ?? {})) {
			this._things.add(id);
			this._points.set(id, pointOf(spot));
			this.join(id, spot, spot);
		}
	}

	/**
	 * A character at `point`: one of the scene's, or one that comes later (trained, a site laid out). `commanded`: of
	 * `me`'s squad, whom its mind runs.
	 */
	public place(id:string, point:Vec, spot:Omit<SceneSpot, 'away' | 'side'>, commanded = false):void {
		this._characters.push(id);
		this._points.set(id, point);
		this.join(id, spot, spot, commanded);
	}

	/** What `id` holds, fights as, is and is worth, from its spot. */
	private join(id:string, spot:Pick<SceneSpot, 'hp' | 'as' | 'team' | 'tactic' | 'focus' | 'suffering' | 'kind' | 'amount' | 'toward' | 'guard'>, held:Pick<SceneSpot, 'carrying' | 'gold'>, commanded = false):void {
		for (const item of [...held.carrying ?? [], ...Array<string>(held.gold ?? 0).fill('gold')]) {
			this.add(id, item, 1);
		}
		this.enlist(id, spot);
		const kind = spot.kind ?? spot.as;
		if (kind) {
			this._kinds.set(id, kind);
		}
		if (spot.amount !== undefined) {
			this._amounts.set(id, spot.amount);
		}
		if (spot.toward) {
			this._toward.set(id, spot.toward);
		}
		if (spot.tactic === 'guard') {
			this._posts.set(id, { at: [...this._points.get(id) ?? [0, 0]], within: spot.guard ?? GUARD });
		}
		const team = spot.team ?? this._fighters.get(id)?.team;
		if (team) {
			this._teams.set(id, team);
		}
		if (commanded) {
			this._commanded.add(id);
		}
	}

	/**
	 * A thing that comes into the scene now, where `at` stands (someone or something by name) or at a point: a fallen
	 * fighter's box, a banner. It holds `carrying`, which the scene's own rules hand out (`take`); `description` is what
	 * `examine` tells.
	 */
	public addThing(id:string, at:string | Vec, more:{ carrying?:string[]; description?:string } = {}):void {
		const point = typeof at === 'string' ? this._points.get(this.find(at) ?? at) : at;
		if (!point) {
			return;
		}
		this._things.add(id);
		this._points.set(id, [...point]);
		for (const item of more.carrying ?? []) {
			this.add(id, item, 1);
		}
		if (more.description) {
			this._descriptions.set(id, more.description);
		}
	}

	/** Gone from the scene, as a site taken down: neither down nor anywhere. */
	public remove(id:string):void {
		this._points.delete(id);
		this._characters.splice(this._characters.indexOf(id) >>> 0, 1);
		this._commanded.delete(id);
	}

	/** A fighter for `id`, if it fights or has health. */
	private enlist(id:string, spot:Pick<SceneSpot, 'hp' | 'as' | 'team' | 'tactic' | 'focus' | 'suffering'>):void {
		const kind = spot.as ? FIGHTERS[spot.as] : undefined;
		if (spot.as && !kind) {
			throw new Error(`no fighter kind ${spot.as}`);
		}
		if (kind || spot.hp) {
			const hp = spot.hp ?? [kind!.hp, kind!.hp];
			const fighter = new Fighter(kind ?? { hp: hp[1], speed: WALK, abilities: [] }, spot.team ?? THEM, { ...spot, hp, kindName: spot.as });
			for (const effect of spot.suffering ?? []) {
				fighter.suffer(effect, 0, id);
			}
			this._fighters.set(id, fighter);
		}
	}

	/** `id`'s kind, of {@link kinds}. */
	public kindOf(id:string):string | undefined {
		return this.isDown(id) || (!this._points.has(id) && !this._characters.includes(id)) ? undefined : this._kinds.get(id);
	}

	/** Whose side `id` is on, if any. */
	public sideOf(id:string):string | undefined {
		return this._teams.get(id);
	}

	/** What `id`'s kind tags it with in the watch language: the kind's name and its own tags (`Splash`). */
	public tagsOf(id:string):string[] {
		const kind = this._kinds.get(id);
		return kind ? [kind, ...(this.kinds[kind]?.tags ?? []).filter((t) => !t.includes(':'))] : [];
	}

	/** What resource node `id` has left. */
	public amountOf(id:string):number {
		return this._amounts.get(id) ?? 0;
	}

	/** Up to `n` taken out of resource node `id`: how many. */
	public draw(id:string, n:number):number {
		const took = Math.min(n, this.amountOf(id));
		this._amounts.set(id, this.amountOf(id) - took);
		return took;
	}

	/** `team`'s stock in an RTS. */
	public stockOf(team:string):CountMap {
		return { ...this._stock.get(team) };
	}

	public addStock(team:string, bundle:CountMap):void {
		const stock = this._stock.get(team) ?? {};
		for (const [k, v] of Object.entries(bundle)) {
			stock[k] = (stock[k] ?? 0) + v;
		}
		this._stock.set(team, stock);
	}

	/** Everyone and everything placed and standing: characters, and things on the ground. */
	public get placed():string[] {
		return [...this._points.keys()].filter((id) => !this.isDown(id));
	}

	/** `amount` of `id`'s health back, as a repair: whether it is whole again. */
	public mend(id:string, amount:number):boolean {
		const f = this._fighters.get(id);
		f?.heal(amount);
		return !f || f.hp >= f.maxHP;
	}

	/** Whether `id` is inside a building or transport. */
	public isSheltered(id:string):boolean {
		return this._sheltered.has(id);
	}

	/** `id` goes inside a building or transport (or comes out): no one can hit it there, and it hits no one. */
	public shelter(id:string, inside:boolean):void {
		if (inside) {
			this._sheltered.add(id);
		}
		else {
			this._sheltered.delete(id);
		}
	}

	/**
	 * `by`'s basic attack at `target`, when it is ready: it lands at once. Whether `target` was in its reach, as an RTS
	 * asks of an attack.
	 */
	public strike(by:string, target:string):boolean {
		const f = this._fighters.get(by);
		const name = f?.kind.abilities.find((a) => ABILITIES[a].repeat);
		if (!f || !name || this.isDown(by) || this.isDown(target) || this._sheltered.has(target) || !this._fighters.has(target)) {
			return false;
		}
		if (this.distance(by, target) > ABILITIES[name].range || !this.sees(by, target)) {
			return false;
		}
		if (f.wait(name, this.time) === 0 && f.allowed(name, this.time) && !this.crowded(by, name, target)) {
			f.used(name, this.time);
			this.land(by, name, target);
		}
		return true;
	}

	/** Whether `by` has no room for its `name` at `target` now ({@link SceneRules.crowding}): an ally ahead of it is in the way. */
	private crowded(by:string, name:string, target:string):boolean {
		const room = this._rules.crowding;
		if (!room || ABILITIES[name].range > CLOSE_IN) {
			return false;
		}
		const team = this.team(by);
		const mine = this.distance(by, target);
		const order = this._characters.indexOf(by);
		return this.characters.some((ally) => {
			if (ally === by || this.team(ally) !== team || this._sheltered.has(ally) || this.distance(ally, by) >= room) {
				return false;
			}
			const theirs = this.distance(ally, target);
			return theirs <= CLOSE_IN && (theirs < mine || (theirs === mine && this._characters.indexOf(ally) < order));
		});
	}

	/** Every character still standing: `me` first. */
	public get characters():string[] {
		return this._characters.filter((id) => !this.isDown(id));
	}

	// Queries

	public find(id:string):string | undefined {
		if (this.isDown(id)) {
			return undefined;
		}
		return this._points.has(id) ? id : this._characters.find((who) => this.count(who, id) > 0);
	}

	public getPose(id:string):Pose | undefined {
		const point = this._points.get(id);
		return point && (id === this.scene.me.id ? { point, ...FACING } : { point });
	}

	/** A grid of whole paces, reached from anywhere by its nearest points, so every walk meets every goal. */
	public getNeighbors([x, z]:Vec):Vec[] {
		return GRID.map(([dx, dz]) => [Math.round(x) + dx, Math.round(z) + dz]).filter((point) => point[0] !== x || point[1] !== z);
	}

	/** Light and sound pass everywhere; who sees whom is the rules' `sees`. A walk onto a point the rules' `blocks` close is blocked. */
	public canPass(what:string, _from:Vec, to:Vec):PathStep {
		const blocked = what === 'light' || what === 'sound' ? undefined : this._rules.blocks?.(this, to);
		return blocked ? { blocked } : {};
	}

	public getReach():number {
		return REACH;
	}

	public getDescription(_character:string, target:string):string | undefined {
		if (!this._points.has(target)) {
			return undefined;
		}
		const spot = this.scene.things?.[target] ?? this.scene.others?.[target] ?? this.scene.squad?.[target];
		return spot?.description ?? this._descriptions.get(target) ?? `${target}, nothing out of the ordinary.`;
	}

	/** Whether `from` sees `to`, by the rules' `sees`: who `find` says they are, if anyone. */
	public sees(from:string, to:string):boolean {
		const a = this.find(from);
		const b = this.find(to);
		return a !== undefined && b !== undefined && (this._rules.sees?.(this, a, b) ?? true);
	}

	// Commands

	/** Walk toward `point` as far as this tick's stride allows; true once there. */
	public steerToward(character:string, point:Vec | null):boolean {
		const at = this._points.get(character);
		if (!point || !at) {
			return false;
		}
		const fighter = this._fighters.get(character);
		if (fighter && !fighter.canMove(this.time)) {
			return false;
		}
		const left = this._stride.get(character) ?? (fighter?.speed(this.time) ?? WALK) * this._dt;
		const gap = distance(at, point);
		const step = Math.min(gap, left);
		this._points.set(character, gap > 0 ? at.map((v, i) => v + ((point[i] - v) * step) / gap) : [...point]);
		this._stride.set(character, left - step);
		return step >= gap;
	}

	public validateTransfer({ verb, thing, from, to, quantity = 1 }:Transfer<string>):string | undefined {
		if (verb === 'pick_up') {
			if (from !== thing || this._characters.includes(thing)) {
				return `${from} has ${thing}`;
			}
			return this.sees(to!, thing) ? undefined : `too dark to see ${thing}`;
		}
		if (this.count(from, thing) < quantity) {
			return verb === 'offer' ? `not enough ${thing}` : `you do not have ${quantity} ${thing}`;
		}
		return undefined;
	}

	public transfer({ verb, thing, from, to, quantity = 1 }:Transfer<string>):()=>void {
		if (verb === 'pick_up') {
			const at = this._points.get(thing)!;
			this._points.delete(thing);
			this.add(to!, thing, 1);
			return () => {
				this.add(to!, thing, -1);
				this._points.set(thing, at);
			};
		}
		this.add(from, thing, -quantity);
		if (to) {
			this.add(to, thing, quantity);
			return () => {
				this.add(to, thing, -quantity);
				this.add(from, thing, quantity);
			};
		}
		this._points.set(thing, [...this._points.get(from)!]);
		return () => {
			this._points.delete(thing);
			this.add(from, thing, quantity);
		};
	}

	public useItem(character:string, item:string, target?:string):Outcome {
		if (this.count(character, item) === 0) {
			return { ok: false, reason: `you do not carry ${item}` };
		}
		// Used on yourself is used on nothing.
		const use = this._rules.uses?.[target && target !== character ? `${item}>${target}` : item];
		if (!use) {
			return { ok: false, reason: 'nothing happens' };
		}
		const done = use(this);
		return typeof done === 'string' ? { ok: true, reason: done } : done;
	}

	/** Stop whatever `id` is doing: an ability running for it gives way, interrupted. The director's `onAbortArc`. */
	public abort(id:string):void {
		this._aborts.set(id, (this._aborts.get(id) ?? 0) + 1);
		for (const stop of [...this._onAbort.get(id) ?? []]) {
			stop();
		}
	}

	/** Call `stop` when `id` is next aborted; the returned function forgets it. */
	public onAbort(id:string, stop:()=>void):()=>void {
		const stops = this._onAbort.get(id) ?? new Set();
		this._onAbort.set(id, stops.add(stop));
		return () => {
			stops.delete(stop);
		};
	}

	/**
	 * One of {@link ABILITIES}, as its verb: close in to its range, wait out its cooldown or a stun, cast, and land it.
	 * A basic attack keeps striking until the target is down; anything else lands once. A stun breaks a cast, and an
	 * {@link abort} (a reaction taking over) ends it before it lands again.
	 */
	public async useAbility<TCtx>(call:VerbCall<TCtx>):Promise<ArcResult> {
		const me = call.character.id;
		const name = call.verb;
		const ability = ABILITIES[name];
		const fail = (reason:string):ArcResult => ({ ok: false, verb: name, reason });
		const self = this._fighters.get(me);
		if (!self || !self.kind.abilities.includes(name)) {
			return fail(`you cannot ${name}`);
		}
		const target = ability.on === 'self' ? me : String(call.args.target ?? '');
		const other = this._fighters.get(target);
		if (!other || this.isDown(target)) {
			return fail(this.isDown(target) ? `${target} is already down` : `${target} is no one to ${name}`);
		}
		if (ability.on !== 'self' && (ability.on === 'ally') !== (other.team === self.team)) {
			return fail(ability.on === 'ally' ? `${target} is not on your side` : `${target} is on your side`);
		}
		const aborts = this._aborts.get(me) ?? 0;
		const aborted = () => (this._aborts.get(me) ?? 0) !== aborts;
		const interrupted:ArcResult = { ok: false, interrupted: true, verb: name };
		for (;;) {
			if (this.isDown(me)) {
				return fail('you are down');
			}
			if (this.isDown(target)) {
				return { ok: true, verb: name, reason: `${target} is down` };
			}
			// In range, it strikes again as soon as it is ready, as a fighter on its own does.
			if (this.distance(me, target) > ability.range) {
				const near = await call.goTo(target, { within: ability.range });
				if (!near.ok) {
					return near;
				}
			}
			if (!this.sees(me, target)) {
				return fail(`no line of sight to ${target}`);
			}
			if (self.wait(name, this.time) > 0 || !self.allowed(name, this.time) || this.crowded(me, name, target)) {
				const waited = await call.wait(Math.max(BEAT, self.wait(name, this.time)));
				if (!waited.ok) {
					return waited;
				}
				continue;
			}
			// A wait or walk that ended the same tick it was stopped still says ok.
			if (aborted()) {
				return interrupted;
			}
			self.used(name, this.time);
			if (ability.cast) {
				const cast = { ability: name, target, lands: this.time + ability.cast };
				self.casting = cast;
				this._verbCasts.add(cast);
				const waited = await call.wait(ability.cast);
				const broken = self.casting !== cast;
				self.casting = undefined;
				if (!waited.ok) {
					return waited;
				}
				if (aborted()) {
					return interrupted;
				}
				if (broken) {
					return fail(`your ${name} was broken`);
				}
			}
			const told = this.land(me, name, target);
			if (!ability.repeat) {
				return { ok: true, verb: name, reason: told };
			}
		}
	}

	/** `name` from `by` lands on `target`, and on everyone of its side in the splash: what happened, told. */
	private land(by:string, name:string, target:string):string {
		const ability = ABILITIES[name];
		const center = this._fighters.get(target);
		if (!center || this.isDown(target)) {
			return `${target} is already down`;
		}
		const hit = ability.splash
			? [...this._fighters].filter(([id, f]) => f.team === center.team && !this.isDown(id) && !this._sheltered.has(id) && this.distance(id, target) <= ability.splash!).map(([id]) => id)
			: [target];
		const told = hit.map((id) => {
			const f = this._fighters.get(id)!;
			const base = (ability.damage ?? 0) + (ability.bonus && f.has(ability.bonus.against, this.time) ? ability.bonus.damage : 0);
			const damage = base && this._rules.damage ? Math.max(0, this._rules.damage(this, by, id, base)) : base;
			const dealt = damage ? f.hurt(damage, this.time) : 0;
			if (ability.heal) {
				f.heal(ability.heal);
			}
			for (const effect of ability.effects ?? []) {
				f.suffer(effect, this.time, by);
			}
			if (f.hp <= 0) {
				this.fell(id);
				return `${id} is down`;
			}
			const what = [damage && `took ${dealt}`, ability.heal && 'healed', ...f.note(this.time)].filter(Boolean).join(', ');
			return `${id} ${what} (${Math.ceil(f.hp)}/${f.maxHP} hp)`;
		});
		if (ability.spends) {
			this.fell(by);
		}
		return told.join('; ');
	}

	/**
	 * One tick of every fighter no verb is running for: the ones nobody commands, by their tactic, and an idle squad
	 * fighter (its commander too) striking back at a foe in reach. A cast lands; an ability is used; a step is taken.
	 */
	private fight():void {
		for (const [id, f] of this._fighters) {
			if (this.isDown(id) || this._sheltered.has(id) || !f.canAct(this.time)) {
				continue;
			}
			// A cast it began on its own lands, even once an order has come since: a verb's lands when the verb says.
			if (f.casting && !this._verbCasts.has(f.casting)) {
				if (this.time >= f.casting.lands) {
					const { ability, target } = f.casting;
					f.casting = undefined;
					this.land(id, ability, target);
				}
				continue;
			}
			const tactic = this.tacticOf(id, f);
			if (!tactic || f.casting) {
				continue;
			}
			const plan = this.plan(id, f, tactic);
			if (!plan) {
				// No one to fight: a marcher goes on, a guard goes back to its post.
				const goal = tactic === 'march' ? this._points.get(this._toward.get(id) ?? '') : tactic === 'guard' ? this._posts.get(id)?.at : undefined;
				if (goal && distance(this._points.get(id) ?? goal, goal) > REACH) {
					this.steerToward(id, goal);
				}
				continue;
			}
			const ability = ABILITIES[plan.ability];
			if (this.distance(id, plan.target) > ability.range && tactic !== 'hold') {
				this.steerToward(id, this._points.get(plan.target) ?? null);
			}
			// One that steps into reach strikes this tick: else whoever moves away more than its reach a tick is never hit.
			if (this.distance(id, plan.target) > ability.range) {
				continue;
			}
			if (f.wait(plan.ability, this.time) > 0 || !f.allowed(plan.ability, this.time) || !this.sees(id, plan.target) || this.crowded(id, plan.ability, plan.target)) {
				continue;
			}
			f.used(plan.ability, this.time);
			if (ability.cast) {
				f.casting = { ability: plan.ability, target: plan.target, lands: this.time + ability.cast };
			}
			else {
				this.land(id, plan.ability, plan.target);
			}
		}
	}

	/**
	 * How `id` fights on its own now: by its tactic when no mind runs its verbs; holding, striking back at foes in
	 * reach, while it is of a squad (its commander too) and idle; else not at all, as its verbs fight for it.
	 */
	private tacticOf(id:string, f:Fighter):Tactic | undefined {
		if (!this._commanded.has(id)) {
			return f.tactic;
		}
		return this.scene.squad && this.idle?.(id) ? 'hold' : undefined;
	}

	/** What `id` does next under `tactic`, and to whom. */
	private plan(id:string, f:Fighter, tactic:Tactic):{ ability:string; target:string } | undefined {
		const living = [...this._fighters].filter(([other]) => !this.isDown(other) && !this._sheltered.has(other));
		const foes = living.filter(([, g]) => g.team !== f.team).map(([other]) => other);
		const byDistance = (ids:string[]) => [...ids].sort((a, b) => this.distance(id, a) - this.distance(id, b));
		if (tactic === 'healer') {
			const hurt = living.filter(([, g]) => g.team === f.team && g.hp < g.maxHP * 0.75)
				.sort(([, a], [, b]) => a.hp / a.maxHP - b.hp / b.maxHP)[0]?.[0];
			const help = f.kind.abilities.find((a) => (ABILITIES[a].heal ?? 0) > 0 && ABILITIES[a].on === 'ally' && f.wait(a, this.time) === 0);
			if (hurt && help) {
				return { ability: help, target: hurt };
			}
		}
		if (tactic === 'burster') {
			const crowd = (foe:string) => foes.filter((other) => this.distance(foe, other) <= ABILITIES.burst.splash!).length;
			const thickest = byDistance(foes).sort((a, b) => crowd(b) - crowd(a))[0];
			return thickest ? { ability: 'burst', target: thickest } : undefined;
		}
		const reach = Math.max(0, ...f.kind.abilities.map((a) => ABILITIES[a].range));
		const taunter = f.tauntedBy(this.time);
		const post = this._posts.get(id);
		// Whom it would go for: anyone (charge); only in reach (hold); what it meets on its way (march); what comes near its post (guard).
		const within = (foe:string):boolean => (tactic === 'hold' ? this.distance(id, foe) <= reach
			: tactic === 'march' ? this.distance(id, foe) <= reach + MARCH_REACH
			: tactic === 'guard' && post ? distance(this._points.get(foe) ?? post.at, post.at) <= post.within
			: true);
		const target = (taunter && !this.isDown(taunter) ? taunter : undefined)
			?? (f.focus && !this.isDown(f.focus) && !this._sheltered.has(f.focus) && (!['march', 'guard'].includes(tactic) || within(f.focus)) ? f.focus : undefined)
			?? byDistance(foes.filter(within))[0];
		if (!target) {
			return undefined;
		}
		const offensive = f.kind.abilities.filter((a) => (ABILITIES[a].on ?? 'foe') === 'foe');
		const ready = offensive.find((a) => !ABILITIES[a].repeat && f.wait(a, this.time) === 0 && this.distance(id, target) <= ABILITIES[a].range);
		const ability = ready ?? offensive.find((a) => ABILITIES[a].repeat) ?? offensive[0];
		return ability ? { ability, target } : undefined;
	}

	// For each tick and for the cases' rules

	/** Start the next tick, `dt` seconds on: statuses wear off and burn, casts land, and the fighters nobody runs fight. */
	public step(dt:number):void {
		this.time += dt;
		this._dt = dt;
		this._stride.clear();
		for (const [id, f] of this._fighters) {
			f.burn(this.time, dt);
			if (f.hp <= 0) {
				this.fell(id);
			}
		}
		this.fight();
	}

	/** Walk `who` straight toward `to` at `speed` paces a second, until in reach. */
	public walk(who:string, to:string, speed:number):void {
		const target = this._points.get(to);
		if (target && !this.near(who, to)) {
			this._stride.set(who, speed * this._dt);
			this.steerToward(who, target);
		}
	}

	/** Hand over every `item` `from` holds, or `n`. */
	public take(from:string, to:string, item:string, n = this.count(from, item)):void {
		const moved = Math.min(n, this.count(from, item));
		this.add(from, item, -moved);
		this.add(to, item, moved);
	}

	/** Back to full health. */
	public heal(who:string):void {
		const f = this._fighters.get(who);
		f?.heal(f.maxHP);
	}

	/**
	 * `damage` to `who` from a scenario's own rules (a move off a type chart, a trap), its shield first; it falls at 0.
	 * What got through.
	 */
	public hurt(who:string, damage:number):number {
		const f = this._fighters.get(who);
		if (!f || this.isDown(who)) {
			return 0;
		}
		const dealt = f.hurt(damage, this.time);
		if (f.hp <= 0) {
			this.fell(who);
		}
		return dealt;
	}

	/** `who` back on its feet with `hp` (default full), as an inn or a revive brings it back. */
	public revive(who:string, hp?:number):void {
		const f = this._fighters.get(who);
		if (!f) {
			return;
		}
		this.downed.splice(this.downed.indexOf(who) >>> 0, 1);
		f.hp = Math.min(f.maxHP, hp ?? f.maxHP);
	}

	/** `effect` on `who` from a scenario's own rules, as an ability would put it there, from `by`. */
	public suffer(who:string, effect:Effect, by = who):void {
		this._fighters.get(who)?.suffer(effect, this.time, by);
	}

	/** The shield `who` has left, 0 with none. */
	public shieldOf(who:string):number {
		return this._fighters.get(who)?.has('shield', this.time)?.amount ?? 0;
	}

	/** The statuses on `who` now: `stun`, `root`, … */
	public statusesOf(who:string):StatusKind[] {
		const f = this._fighters.get(who);
		return f ? (['stun', 'root', 'slow', 'silence', 'shield', 'taunt', 'burn'] as const).filter((kind) => f.has(kind, this.time)) : [];
	}

	public fell(who:string):void {
		if (!this.isDown(who)) {
			this.downed.push(who);
		}
	}

	// What a goal reads

	public count(who:string, item:string):number {
		return this._held.get(who)?.get(item) ?? 0;
	}

	public holds(who:string, item:string):boolean {
		return this.count(who, item) > 0;
	}

	/** How many of each item `who` holds now. */
	public holdings(who:string):Map<string, number> {
		return new Map(this._held.get(who));
	}

	public isDown(who:string):boolean {
		return this.downed.includes(who);
	}

	public hp(who:string):number | undefined {
		return this._fighters.get(who)?.hp;
	}

	/** Whose side `who` fights on, if it fights. */
	public team(who:string):string | undefined {
		return this._fighters.get(who)?.team;
	}

	/** The first of `team`'s fighters to fall. */
	public firstDown(team:string):string | undefined {
		return this.downed.find((who) => this.team(who) === team);
	}

	/** Whether every fighter of `team` is down. */
	public routed(team:string):boolean {
		return [...this._fighters].every(([id, f]) => f.team !== team || this.isDown(id));
	}

	/** How many fighters of `team` are down. */
	public lost(team:string):number {
		return [...this._fighters].filter(([id, f]) => f.team === team && this.isDown(id)).length;
	}

	public distance(a:string, b:string):number {
		const pa = this._points.get(this.find(a) ?? a);
		const pb = this._points.get(this.find(b) ?? b);
		return pa && pb ? distance(pa, pb) : Infinity;
	}

	/** Within reach of each other, or `within`. */
	public near(a:string, b:string, within = REACH + 0.5):boolean {
		return this.distance(a, b) <= within;
	}

	/** Whether `who` clearly heard a line with every one of `words` in it. */
	public heard(who:string, words:string):boolean {
		const wanted = words.toLowerCase().split(/\s+/);
		return this.said.some((line) => line.heardBy.includes(who) && wanted.every((word) => line.text.toLowerCase().includes(word)));
	}

	// What the director reads

	/** Who and what `id` can reach in the watch language. Where they are is this world's own. */
	public kernels(id:string):Pick<HostKernels, 'me' | 'others' | 'items' | 'inventory' | 'hp' | 'nearRadius'> {
		return {
			me: this.entity(id, id),
			others: this.characters.filter((other) => other !== id).map((other) => this.entity(other, id)),
			items: [...this._things].filter((thing) => this._points.has(thing)).map((thing) => this.entity(thing, id)),
			inventory: (who) => this.items(who.id).map((item) => dummyEntity(item, {})),
			hp: (who) => {
				const f = this._fighters.get(who.id);
				return f && { hp: Math.ceil(f.hp), maxHP: f.maxHP };
			},
			nearRadius: NEAR,
		};
	}

	/** The scene in the watch language, from `me`. */
	public catalog():Catalog {
		const me = this.scene.me.id;
		return buildCatalog({ ...this.kernels(me), cache: new SampleCache(), ...geometryKernels(this, me) });
	}

	/** What `id` sees, by the rules' `sees`. Things past the sight radius are in the scene but out of sight: only the map shows them. */
	public sight(id:string):Sight {
		const others = this.characters.filter((other) => other !== id);
		return {
			self: { id, point: this._points.get(id)!, facing: FACING.facing },
			objects: [
				...others.map((other) => {
					const f = this._fighters.get(other);
					// What it is seen doing, fighting on its own: casting, or what it used a moment ago.
					const used = f?.casting?.ability ?? (f?.lastUsed && this.time - f.lastUsed.at <= SEEN_DOING ? f.lastUsed.ability : undefined);
					const doing = used && doingOf(used);
					const fighter = f ? { hp: Math.ceil(f.hp), maxHP: f.maxHP, note: this.noteOf(other, id), ...doing ? { doing } : {} } : {};
					return { id: other, point: this._points.get(other)!, tags: [RESERVED_TAGS.character], ...fighter };
				}),
				...[...this._things].filter((thing) => this._points.has(thing))
					.map((thing) => ({ id: thing, point: this._points.get(thing)!, tags: [], interactable: true })),
			].filter((o) => this.sees(id, o.id)),
		};
	}

	/** `id` in the watch language, as `observer` knows it: whether it is a foe, casting or stunned. Its health is the `hp` kernel's. */
	private entity(id:string, observer:string):ExprEntity {
		const f = this._fighters.get(id);
		const tags = this.tagsOf(id);
		const own = Object.entries(this._rules.fields?.(this, id) ?? {})
			.map(([key, value]):[string, ExprVal] => [key, typeof value === 'number' ? { kind: 'number', value } : { kind: 'bool', value }]);
		if (!f) {
			return dummyEntity(id, { tags, fields: Object.fromEntries(own) });
		}
		const mine = this._fighters.get(observer);
		return dummyEntity(id, { tags, fields: {
			foe: { kind: 'bool', value: !!mine && mine.team !== f.team },
			casting: { kind: 'bool', value: !!f.casting },
			stunned: { kind: 'bool', value: !f.canAct(this.time) },
			...Object.fromEntries(own),
		} });
	}

	/** What `observer` sees of fighter `id` past its name: `foe Shaman, casting firestorm`. */
	private noteOf(id:string, observer:string):string | undefined {
		const f = this._fighters.get(id)!;
		const mine = this._fighters.get(observer);
		const side = mine && f.kindName ? (mine.team === f.team ? 'ally' : 'foe') : undefined;
		return [[side, f.kindName].filter(Boolean).join(' '), ...f.note(this.time), this._rules.notes?.(this, id)].filter(Boolean).join(', ') || undefined;
	}

	public inventory(id:string):Inventory {
		const gold = this.count(id, 'gold');
		return { ...(gold > 0 ? { purse: gold } : {}), pockets: this.items(id).filter((item) => item !== 'gold') };
	}

	/** The whole scene from above, whatever the zoom: everyone and everything on it, `me` at the middle with the default mark. */
	public map():MapSense {
		return {
			snapshot: () => {
				const placed = [...this._points].filter(([id]) => id !== this.scene.me.id && !this.isDown(id));
				const half = Math.max(0, ...placed.map(([, [x, y]]) => Math.max(Math.abs(x), Math.abs(y)))) + 4;
				const marks:MapMark[] = placed.map(([id, [x, y]], i) => ({ symbol: MARKS[i % MARKS.length], id, x, y }));
				const [x, y] = this._points.get(this.scene.me.id)!;
				return {
					image: BLANK_PNG,
					width: MAP_SIZE,
					height: MAP_SIZE,
					toPixel: (px, py) => ({ u: ((px + half) / (2 * half)) * MAP_SIZE, v: ((py + half) / (2 * half)) * MAP_SIZE }),
					marks: [{ symbol: DEFAULT_YOU_SYMBOL, id: this.scene.me.id, x, y }, ...marks],
				};
			},
		};
	}

	/** What `who` holds, one entry per item. */
	private items(who:string):string[] {
		return [...this._held.get(who) ?? []].flatMap(([item, n]) => Array<string>(n).fill(item));
	}

	/** `n` more of `item` for `who`, out of nowhere, or fewer when `n` is negative: what a craft makes and uses up. */
	public add(who:string, item:string, n = 1):void {
		const held = this._held.get(who) ?? new Map<string, number>();
		const count = (held.get(item) ?? 0) + n;
		if (count > 0) {
			held.set(item, count);
		}
		else {
			held.delete(item);
		}
		this._held.set(who, held);
	}
}

/** The scene in the watch language, from `me`. */
export function sceneCatalog(scene:Scene):Catalog {
	return new SceneWorld(scene).catalog();
}
