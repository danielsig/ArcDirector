import type { Character } from '../character/Character.js';
import type { Persona } from '../character/Persona.js';
import type { Vec } from '../world/world-types.js';
import { distance } from '../world/vec.js';
import { poseOf } from '../world/lookup.js';
import type { ArcDirector } from './ArcDirector.js';
import { Feature, type FeatureTick } from './Feature.js';

/**
 * Where a region is, in the game's own `Vec`s: a box between two opposite corners (a segment in 1D, a rectangle in
 * 2D, a box in 3D), or a ball around `center` (an interval, a circle, a sphere). An infinite corner leaves its axis
 * open: `from: [0, -Infinity, 40], to: [16, Infinity, 56]` is a room at any height. A ball's `center` can be an
 * entity's ID instead (an item, a character, anything `find` knows): the ball goes where it goes, and holds no one while
 * it has no pose.
 */
export type RegionShape = { from:Vec; to:Vec } | { center:Vec | string; radius:number };

/** A shape where it is this tick: a ball on an entity centered where that entity stands. */
type Extent = { from:Vec; to:Vec } | { center:Vec; radius:number };

/** Argument to `RegionsFeature.add`: where it is, and what it does to each character in it. */
export type RegionSpec<TCtx = unknown> = RegionShape & {
	/**
	 * What it is like to be here, or what is going on ("This room smells of flowers."): pinned as a memory in the mind of
	 * each character while inside the region, and forgotten leaving. A collective reads it with who is there
	 * ("Tom: This room smells of flowers."). Read again every tick, so a function (given the character's context, as
	 * the callbacks are) or a getter can change it while they stay, or empty it to unpin it.
	 */
	memory?:string | ((ctx:TCtx)=>string | undefined);
	/**
	 * Who the region is for. A watch, as each character sees the world (`'me is "Undead"'`, `'isHurt(me)'`), or a
	 * test of its context. Anyone else is never in it: no memory, no callbacks, and a character the filter stops
	 * holding for leaves. Default: everyone.
	 */
	who?:string | ((ctx:TCtx)=>boolean);
	/** Checked every tick. When it returns true, the region is removed and everyone in it leaves. */
	until?:()=>boolean;
	/**
	 * The callbacks get the character's context (`withContext`), as verb handlers do; a character without one is in no
	 * region. `onExit` gets the last context it was seen with, since it may have none by then.
	 */
	onEnter?(ctx:TCtx):void;
	/** Every tick it is still inside after the one it entered on, with how long it has stayed (game seconds) and that tick's `dt`. */
	onStay?(ctx:TCtx, stayed:number, dt:number):void;
	/** With how long it stayed, in game seconds. */
	onExit?(ctx:TCtx, stayed:number):void;
};

function inRegion(shape:Extent, point:Vec):boolean {
	if ('radius' in shape) {
		return distance(point, shape.center) <= shape.radius;
	}
	return shape.from.every((a, i) => point[i] >= Math.min(a, shape.to[i]) && point[i] <= Math.max(a, shape.to[i]));
}

/** Where `shape` is now, with `pointOf` placing the entity a ball is on; none while that entity has no point. */
function extentOf(shape:RegionShape, pointOf:(id:string)=>Vec | undefined):Extent | undefined {
	if ('from' in shape) {
		return shape;
	}
	const center = typeof shape.center === 'string' ? pointOf(shape.center) : shape.center;
	return center && { center, radius: shape.radius };
}

/** From this many region × character checks a tick up, a sweep along the first axis picks who each region tests. */
const SWEEP_FROM = 2000;

type Placed<TCtx> = readonly [Character<TCtx>, Vec];

/** One character inside a region: when it entered, its context as last seen, the persona holding its memory, and its text as last pinned. */
type Pinned<TCtx> = { since:number; ctx:TCtx; persona:Persona; text?:string };

type Region<TCtx> = {
	name:string;
	spec:RegionSpec<TCtx>;
	/** The entity it is on, placed again every tick. */
	on:string | undefined;
	/** Where it is; none while the entity it is on has no pose. */
	extent:Extent | undefined;
	/** Its extent on the first axis, for the sweep. */
	lo:number;
	hi:number;
	/** Who is inside, and the memory pinned for each. */
	inside:Map<Character<TCtx>, Pinned<TCtx>>;
};

/**
 * Regions, and who is in each: places that inject memories or run callbacks while characters are in them
 * (`addRegions({ Crypt: { from, to, memory } })`). Needs `withWorld` with `find` and `getPose`. A memory's id
 * is the region's and the character's. The first time a character is ticked, any region memory a save brought back for
 * it is dropped, and the regions it stands in pin theirs again on that tick.
 *
 * Regions are often the simplest way to give a mind what it needs, just when it needs it. Goals and pinned memories stay
 * in a mind for good; a region's memory reaches the right characters at the right time and goes away once it is beside
 * the point: a room's atmosphere, the dread at a monster's lair, a character's presence and aura, an item's instruction
 * manual, one character's own take on a place, a pep talk as a journey begins. The prompt stays short, and minds stay on
 * what matters. Cheap to have many of: with many regions and characters the check sweeps and prunes, so it grows as
 * `n log n` rather than `n²`.
 */
export class RegionsFeature<TCtx = unknown> extends Feature<TCtx> {
	private readonly _regions = new Map<string, Region<TCtx>>();
	/** `_regions` by `lo`, for the sweep; rebuilt after a region is added or removed. */
	private _byLo:Region<TCtx>[] | undefined;
	/** Characters `forgetRegions` already ran for. */
	private readonly _seen = new WeakSet<Character<TCtx>>();

	public override readonly order = 10;

	/** Add each of `regions` by its name ({@link add}). */
	public configure(regions:Readonly<Record<string, RegionSpec<TCtx>>>):this {
		Object.entries(regions).forEach(([name, spec]) => this.add(name, spec));
		return this;
	}

	/** Region `name` ({@link RegionSpec}). The same name again replaces it: everyone in the old one leaves first. */
	public add(name:string, spec:RegionSpec<TCtx>):this {
		this.remove(name);
		const on = 'radius' in spec && typeof spec.center === 'string' ? spec.center : undefined;
		const region:Region<TCtx> = { name, spec, on, extent: undefined, lo: Infinity, hi: -Infinity, inside: new Map() };
		place(region, extentOf(spec, () => undefined));
		this._regions.set(name, region);
		this._byLo = undefined;
		return this;
	}

	/** Remove regions by name: everyone `who` counted as inside leaves, its memory unpinned and `onExit` called. Unknown names are ignored. */
	public remove(...names:string[]):this {
		for (const name of names) {
			const region = this._regions.get(name);
			this._regions.delete(name);
			this._byLo = undefined;
			for (const [character, pinned] of region?.inside ?? []) {
				this.leave(region!, character, pinned, this.director.time);
			}
		}
		return this;
	}

	/** Enter, stay or leave, for each character where the world puts it now, and each region on an entity where it puts that. One with no point is nowhere. */
	public override beforeWatches({ dt, now }:FeatureTick):void {
		const world = this.director.world;
		if (!world) {
			return;
		}
		const pointOf = (id:string):Vec | undefined => poseOf(world, id)?.point;
		for (const region of [...this._regions.values()].filter((r) => r.spec.until?.())) {
			this.remove(region.name);
		}
		if (this._regions.size === 0) {
			return;
		}
		for (const region of this._regions.values()) {
			if (region.on !== undefined) {
				place(region, extentOf(region.spec, pointOf));
				this._byLo = undefined;
			}
		}
		const characters = this.director.characters();
		const placed:Placed<TCtx>[] = [];
		for (const character of characters) {
			if (!this._seen.has(character)) {
				this._seen.add(character);
				forgetRegions(character);
			}
			const point = pointOf(character.id);
			if (point) {
				placed.push([character, point]);
			}
		}
		const present = new Set(characters);
		const near = this._regions.size * placed.length >= SWEEP_FROM ? sweep(this._byLo ??= [...this._regions.values()].sort((a, b) => a.lo - b.lo), placed) : undefined;
		for (const region of this._regions.values()) {
			const { spec, extent, inside } = region;
			const admitted = new Map<Character<TCtx>, TCtx>();
			for (const [character, point] of near ? near.get(region) ?? [] : placed) {
				const ctx = extent && inRegion(extent, point) ? character.context() : undefined;
				if (ctx !== undefined && this.admits(spec, character, ctx)) {
					admitted.set(character, ctx);
				}
			}
			for (const [character, pinned] of inside) {
				if (!present.has(character)) {
					// Gone from the cast, or rebuilt by a restore: dropped quietly.
					inside.delete(character);
				}
				else if (!admitted.has(character)) {
					this.leave(region, character, pinned, now);
				}
			}
			for (const [character, ctx] of admitted) {
				const pinned = inside.get(character);
				if (pinned) {
					pinned.ctx = ctx;
					this.pin(region, character, pinned, now);
					spec.onStay?.(ctx, now - pinned.since, dt);
				}
				else {
					this.enter(region, character, ctx, now);
				}
			}
		}
	}

	private admits({ who }:RegionSpec<TCtx>, character:Character<TCtx>, ctx:TCtx):boolean {
		return who === undefined || (typeof who === 'string' ? this.director.holds(character.id, who) : who(ctx));
	}

	private enter(region:Region<TCtx>, character:Character<TCtx>, ctx:TCtx, now:number):void {
		const pinned:Pinned<TCtx> = { since: now, ctx, persona: (character.collective ?? character).persona };
		this.pin(region, character, pinned, now);
		region.inside.set(character, pinned);
		region.spec.onEnter?.(ctx);
	}

	/** Pin the memory as `spec.memory` reads now (once): added, replaced when it changed, dropped when it is empty. */
	private pin({ name, spec }:Region<TCtx>, character:Character<TCtx>, pinned:Pinned<TCtx>, now:number):void {
		const read = spec.memory;
		const memory = typeof read === 'function' ? read(pinned.ctx) : read;
		const text = memory && (pinned.persona === character.persona ? memory : `${character.id}: ${memory}`);
		if (text === pinned.text) {
			return;
		}
		const id = memoryID(name, character);
		if (pinned.text) {
			pinned.persona.memory.remove(id);
		}
		if (text) {
			pinned.persona.memory.add({ id, category: 'semantic', text, tags: ['region', name], pinned: true }, now);
		}
		pinned.text = text;
	}

	private leave({ name, spec, inside }:Region<TCtx>, character:Character<TCtx>, { since, ctx, persona }:Pinned<TCtx>, now:number):void {
		persona.memory.remove(memoryID(name, character));
		inside.delete(character);
		spec.onExit?.(ctx, now - since);
	}
}

/** Put `region` at `extent`, and its span on the first axis with it; one with no extent spans nothing. */
function place<TCtx>(region:Region<TCtx>, extent:Extent | undefined):void {
	region.extent = extent;
	[region.lo, region.hi] = !extent ? [Infinity, -Infinity]
		: 'radius' in extent ? [extent.center[0] - extent.radius, extent.center[0] + extent.radius]
		: [Math.min(extent.from[0], extent.to[0]), Math.max(extent.from[0], extent.to[0])];
}

/**
 * For each region, the characters within its extent on the first axis: regions sorted by where they start, characters
 * by where they stand, and one sweep across both keeping the regions open at each character.
 */
function sweep<TCtx>(byLo:readonly Region<TCtx>[], placed:readonly Placed<TCtx>[]):Map<Region<TCtx>, Placed<TCtx>[]> {
	const near = new Map<Region<TCtx>, Placed<TCtx>[]>();
	let open:Region<TCtx>[] = [];
	let next = 0;
	for (const body of [...placed].sort((a, b) => a[1][0] - b[1][0])) {
		const x = body[1][0];
		while (next < byLo.length && byLo[next].lo <= x) {
			open.push(byLo[next++]);
		}
		open = open.filter((region) => region.hi >= x);
		for (const region of open) {
			const bodies = near.get(region);
			if (bodies) {
				bodies.push(body);
			}
			else {
				near.set(region, [body]);
			}
		}
	}
	return near;
}

/**
 * Called when a `character` gets added and before it gets memories pinned from regions it stands in.
 * This makes sure a character restored from a save drops the region lines its save kept and re-pins the right ones.
 */
function forgetRegions<TCtx>(character:Character<TCtx>):void {
	const { memory } = (character.collective ?? character).persona;
	const suffix = `:${character.id}`;
	for (const record of memory.all().filter((r) => r.id.startsWith('region:') && r.id.endsWith(suffix))) {
		memory.remove(record.id);
	}
}

function memoryID(name:string, character:{ id:string }):string {
	return `region:${name}:${character.id}`;
}

declare module './ArcDirector.js' {
	interface ArcDirector<TCtx, TEntity> {
		/** {@link RegionsFeature}: `addRegions({ Crypt: { from, to, memory } })`. A name added before is replaced. */
		addRegions(regions:Readonly<Record<string, RegionSpec<TCtx>>>):this;
		getRegions():RegionsFeature<TCtx> | undefined;
	}
}
export function addRegions<TCtx>(this:ArcDirector<TCtx>, regions:Readonly<Record<string, RegionSpec<TCtx>>>):ArcDirector<TCtx> {
	return this.configureFeature(RegionsFeature<TCtx>, () => new RegionsFeature<TCtx>(), (feature) => feature.configure(regions));
}
