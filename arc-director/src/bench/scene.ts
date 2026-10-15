import type { VerbDef } from '../arc/stock-verbs.js';
import type { ArcResult, CountMap } from '../arc/types.js';
import type { VerbCall } from '../director/types.js';
import { buildCatalog, dummyEntity, type HostKernels } from '../expr/natives.js';
import { SampleCache, type Catalog, type ExprEntity } from '../expr/types.js';
import { DEFAULT_YOU_SYMBOL, type MapMark, type MapSense } from '../mind/map.js';
import type { SpeechUtterance } from '../mind/talk.js';
import type { Inventory } from '../perception/inventory.js';
import type { Sight } from '../perception/types.js';
import { geometryKernels } from '../world/kernels.js';
import type { Exchange, HostWorld, ItemMove, Outcome, PathGraph, Pose, Vec } from '../world/types.js';
import { distance } from '../world/vec.js';

/** Where someone or something is, seen from the one the scene is about, and what a character there has. */
export type SceneSpot = {
	away:number;
	side:'ahead' | 'behind' | 'left' | 'right';
	hp?:[number, number];
	/** What a character here carries, one entry per item. */
	carrying?:string[];
	gold?:number;
	/** A character's standing offers, to anyone. */
	offers?:{ give:CountMap; get:CountMap }[];
	/** What a foe here hits back with when attacked. */
	hits?:number;
};

/** One character's moment, as a bench asks it: who and what is where, how hurt, what it carries, and what it wants. */
export type BenchScene = {
	me:{ id:string; hp?:[number, number] };
	/** Characters around, by name. */
	others?:Record<string, SceneSpot>;
	/** Things and places around, by name. Any of them can be picked up. */
	things?:Record<string, SceneSpot>;
	/** What `me` carries, one entry per item. */
	carrying?:string[];
	/** Gold in `me`'s purse. */
	gold?:number;
	goal:string;
};

/** How a scene's world answers beyond walking, carrying and trading. */
export type SceneRules = {
	/** What using an item does, by `'Item>Target'`, or `'Item'` used on nothing. Returns what happened. Any other use does nothing. */
	uses?:Record<string, (world:SceneWorld)=>string>;
	/** Whether `from` can see `to`. Default: everyone sees everything. */
	sees?:(world:SceneWorld, from:string, to:string)=>boolean;
	/** What stops a walk onto `point` now (`Bridge is raised`), if anything. Default: nothing. */
	blocks?:(world:SceneWorld, point:Vec)=>string | undefined;
};

/** The 5v5 fight's attacks, which the scenes use beside the stock verbs. */
export const FIGHT_VERBS:Record<string, VerbDef> = Object.fromEntries(
	['shoot', 'cleave', 'hex', 'protect'].map((verb) => [verb, { args: { target: 'id' } }]),
);

/** How far each attack reaches. */
const RANGES:Record<string, number> = { shoot: 12, hex: 12 };
/** Paces a second a character walks. */
const WALK = 3;
/** How close counts as in reach. */
const REACH = 1.5;
/** What counts as nearby, so `flee` knows how far to run. */
const NEAR = 8;

/** `me` stands at the origin facing north (−Z), its right hand east (+X). */
const FACING:Pick<Pose, 'facing' | 'right'> = { facing: [0, -1], right: [1, 0] };

/** The grid steps from a whole pace: itself and its four neighbors. */
const GRID = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]];

/** Each {@link SceneSpot} side as a direction from the origin. */
const SIDES = { ahead: [0, -1], behind: [0, 1], left: [-1, 0], right: [1, 0] } as const;

function pointOf(spot:SceneSpot):Vec {
	return SIDES[spot.side].map((d) => d * spot.away);
}

function entity(id:string, hp?:[number, number]):ExprEntity {
	return dummyEntity(id, hp ? { fields: { hp: { kind: 'number', value: hp[0] }, maxHP: { kind: 'number', value: hp[1] } } } : {});
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
	public readonly scene:BenchScene;
	/** Lines spoken, with who heard them. */
	public readonly said:SpeechUtterance[] = [];
	/** What uses made true (`VaultDoor open`). */
	public readonly flags = new Set<string>();
	/** Characters who fell, in order. */
	public readonly downed:string[] = [];
	/** Seconds since the arc started. */
	public time = 0;
	private readonly _rules:SceneRules;
	private readonly _characters:string[];
	/** Where characters stand and things lie. A carried item has no point. */
	private readonly _points = new Map<string, Vec>();
	/** What each character holds, by item. */
	private readonly _held = new Map<string, Map<string, number>>();
	private readonly _hp = new Map<string, [number, number]>();
	/** How far each character may still walk this tick. */
	private readonly _stride = new Map<string, number>();
	private _dt = 0;

	constructor(scene:BenchScene, rules:SceneRules = {}) {
		this.scene = scene;
		this._rules = rules;
		this._characters = [scene.me.id, ...Object.keys(scene.others ?? {})];
		const hold = (who:string, items:string[] = [], gold = 0):void => {
			for (const item of gold > 0 ? [...items, ...Array<string>(gold).fill('gold')] : items) {
				this.add(who, item, 1);
			}
		};
		this._points.set(scene.me.id, [0, 0]);
		hold(scene.me.id, scene.carrying, scene.gold);
		if (scene.me.hp) {
			this._hp.set(scene.me.id, [...scene.me.hp]);
		}
		for (const [id, spot] of Object.entries({ ...scene.others, ...scene.things })) {
			this._points.set(id, pointOf(spot));
			hold(id, spot.carrying, spot.gold);
			if (spot.hp) {
				this._hp.set(id, [...spot.hp]);
			}
		}
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

	/** A grid of whole paces, reached from anywhere by its nearest points, so every walk meets every goal. The rules' `blocks` say where it is closed. */
	public getPathGraph():PathGraph {
		return ([x, z]) => GRID.map(([dx, dz]) => [Math.round(x) + dx, Math.round(z) + dz])
			.filter((point) => point[0] !== x || point[1] !== z)
			.map((point) => {
				const blocked = this._rules.blocks?.(this, point);
				return blocked ? { point, blocked } : { point };
			});
	}

	public getReach():number {
		return REACH;
	}

	public getDescription(_character:string, target:string):string | undefined {
		return this._points.has(target) ? `${target}, nothing out of the ordinary.` : undefined;
	}

	public hasLineOfSight(from:string, to:string):boolean {
		return this._rules.sees?.(this, from, to) ?? true;
	}

	// Commands

	/** Walk toward `point` as far as this tick's stride allows; true once there. */
	public steerToward(character:string, point:Vec | null):boolean {
		const at = this._points.get(character);
		if (!point || !at) {
			return false;
		}
		const left = this._stride.get(character) ?? WALK * this._dt;
		const gap = distance(at, point);
		const step = Math.min(gap, left);
		this._points.set(character, gap > 0 ? at.map((v, i) => v + ((point[i] - v) * step) / gap) : [...point]);
		this._stride.set(character, left - step);
		return step >= gap;
	}

	public moveItem({ character, item, to, quantity = 1 }:ItemMove<string>):Outcome {
		if (to === character) {
			if (!this._points.has(item) || this._characters.includes(item)) {
				return { ok: false, reason: this.find(item) ? `${this.find(item)} has ${item}` : `there is no ${item}` };
			}
			if (!this.hasLineOfSight(character, item)) {
				return { ok: false, reason: `too dark to see ${item}` };
			}
			this._points.delete(item);
			this.add(character, item, 1);
			return { ok: true };
		}
		if (this.count(character, item) < quantity) {
			return { ok: false, reason: `you do not have ${quantity} ${item}` };
		}
		this.add(character, item, -quantity);
		if (to) {
			this.add(to, item, quantity);
		}
		else {
			this._points.set(item, [...this._points.get(character)!]);
		}
		return { ok: true };
	}

	public useItem(character:string, item:string, target?:string):Outcome {
		if (this.count(character, item) === 0) {
			return { ok: false, reason: `you do not carry ${item}` };
		}
		const use = this._rules.uses?.[target ? `${item}>${target}` : item];
		return use ? { ok: true, reason: use(this) } : { ok: false, reason: 'nothing happens' };
	}

	public exchange({ character, other, give, get }:Exchange<string>):Outcome {
		const short = (who:string, bundle:CountMap) => Object.entries(bundle).find(([item, n]) => this.count(who, item) < n)?.[0];
		const lacking = short(character, give) ?? short(other, get);
		if (lacking) {
			return { ok: false, reason: `not enough ${lacking}` };
		}
		for (const [item, n] of Object.entries(give)) {
			this.add(character, item, -n);
			this.add(other, item, n);
		}
		for (const [item, n] of Object.entries(get)) {
			this.add(other, item, -n);
			this.add(character, item, n);
		}
		return { ok: true };
	}

	/** One of {@link FIGHT_VERBS}: close in to its range, then the target falls, if it can be seen. A foe that hits back may fell the attacker first. */
	public async attack<TCtx>(call:VerbCall<TCtx>):Promise<ArcResult> {
		const me = call.character.id;
		const target = String(call.args.target ?? '');
		const fail = (reason:string):ArcResult => ({ ok: false, verb: call.verb, reason });
		if (!this.find(target)) {
			return fail(`no one called ${target}`);
		}
		const near = await call.goTo(target, RANGES[call.verb] ?? REACH);
		if (!near.ok) {
			return near;
		}
		if (!this.hasLineOfSight(me, target)) {
			return fail(`no line of sight to ${target}`);
		}
		if (call.verb === 'protect') {
			return { ok: true, verb: call.verb };
		}
		const hits = this.scene.others?.[target]?.hits ?? 0;
		const hp = this._hp.get(me);
		if (hp && hits >= hp[0]) {
			this.fell(me);
			return fail(`${target} struck you down`);
		}
		if (hp) {
			hp[0] -= hits;
		}
		this.fell(target);
		return { ok: true, verb: call.verb, reason: `${target} is down` };
	}

	// For each tick and for the cases' rules

	/** Start the next tick, `dt` seconds on. */
	public step(dt:number):void {
		this.time += dt;
		this._dt = dt;
		this._stride.clear();
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

	public heal(who:string):void {
		const hp = this._hp.get(who);
		if (hp) {
			hp[0] = hp[1];
		}
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

	public isDown(who:string):boolean {
		return this.downed.includes(who);
	}

	public hp(who:string):number | undefined {
		return this._hp.get(who)?.[0];
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
	public kernels(id:string):Pick<HostKernels, 'me' | 'others' | 'items' | 'inventory' | 'nearRadius'> {
		return {
			me: entity(id, this._hp.get(id)),
			others: this.characters.filter((other) => other !== id).map((other) => entity(other, this._hp.get(other))),
			items: Object.keys(this.scene.things ?? {}).filter((thing) => this._points.has(thing)).map((thing) => entity(thing)),
			inventory: (who) => this.items(who.id).map((item) => entity(item)),
			nearRadius: NEAR,
		};
	}

	/** The scene in the watch language, from `me`. */
	public catalog():Catalog {
		const me = this.scene.me.id;
		return buildCatalog({ ...this.kernels(me), cache: new SampleCache(), ...geometryKernels(this, me) });
	}

	/** What `id` sees. Things past the sight radius are in the scene but out of sight: only the map shows them. */
	public sight(id:string):Sight {
		const others = this.characters.filter((other) => other !== id);
		return {
			self: { id, point: this._points.get(id)!, facing: FACING.facing },
			objects: [
				...others.map((other) => {
					const hp = this._hp.get(other);
					return { id: other, point: this._points.get(other)!, tags: ['person'], ...(hp ? { hp: hp[0], maxHP: hp[1] } : {}) };
				}),
				...Object.keys(this.scene.things ?? {}).filter((thing) => this._points.has(thing))
					.map((thing) => ({ id: thing, point: this._points.get(thing)!, tags: [], interactable: true })),
			],
		};
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

	private add(who:string, item:string, n:number):void {
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
export function sceneCatalog(scene:BenchScene):Catalog {
	return new SceneWorld(scene).catalog();
}
