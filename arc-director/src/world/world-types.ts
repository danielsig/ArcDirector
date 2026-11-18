import type { NamingText } from '../character/text-with-ids.js';
import type { Axes } from './axes.js';
import type { Deal } from './deal.js';

/**
 * A position or a direction in world space, as many numbers as the game has dimensions (1D, 2D, 3D); the
 * game uses the same count everywhere. Units are the game's own; ArcDirector only compares and adds them.
 * A position is always called `point`; a direction is named for where it points (`facing`, `up`) and is a
 * unit vector. Which way is which: the world's {@link Axes}.
 */
export type Vec = number[];

/**
 * Where a character or thing is and, if it faces, which way. Its right hand is told from `facing` and `up` in the
 * world's {@link Axes}' handedness.
 */
export interface Pose {
	/** Where it is: its middle. */
	point:Vec;
	/** Unit direction it faces. Leave out for things that do not face. */
	facing?:Vec;
	/** Unit direction of its up, only when different from the world's up (flight, space, planets). */
	up?:Vec;
	/**
	 * Its radius: distance, nearness and reach measure edge to edge (between middles, less both sizes). A house, a
	 * pond or a vendor behind a counter is reached at its edge, not its middle. Default 0.
	 */
	size?:number;
}

/**
 * What `getClarity` is asked about: the library asks `Medium.Light` (sight) and `Medium.Sound` (hearing). A game asks
 * its own for its own verbs (`'smell'`), and its `getClarity` answers them too.
 */
export const Medium = { Light: 'light', Sound: 'sound' } as const;
export type Medium = (typeof Medium)[keyof typeof Medium] | (string & {});

/** What `getPassage` says of a step it lets through, or of one something stops for now. */
export interface Passage {
	/**
	 * How many times its length the step costs. Default 1, and never less, so the search stays exact; raise it to
	 * route around crowds or rough ground.
	 */
	weight?:number;
	/**
	 * What stops this step right now, for this character (`(name) => \`${name(door)} is locked — you carry ${name(key)}\``).
	 * The search avoids it; with no open way, the move fails naming each blocker that leads there, cheapest first. The
	 * search tells blockers apart by this value, a function by identity: give back the same one for the same blocker,
	 * and it is called only when a failure is shown, so what it looks up to name things costs nothing while searching.
	 */
	blocked?:NamingText;
	/** The character or thing that blocks it, when one does (a foe's wall): a failed move lists it in `blockedBy`. */
	by?:string;
}

/** What the world says to a command. */
export interface Outcome {
	/** Done, or refused. */
	ok:boolean;
	/** Why, in words the agent can act on, naming by id: `(name) => \`${name(chest)} is locked\``, "no room". */
	reason?:NamingText;
}

/**
 * One thing changing hands: picked up, put down, given, paid, traded or stolen. A thing is whatever the game lets
 * move: an item, gold, a house deed, a promise of work. What each name means is the game's call.
 */
export interface Transfer<TEntity> {
	/** The verb that moves it, which says who acts: `pick_up`, `drop`, `give`, `offer`, `steal` (`withStealing`), or the game's own. */
	verb:string;
	/** The thing's id, as the model wrote it. Which one is meant depends on where it is, and that is the game's call. */
	thing:string;
	/**
	 * What holds it now: a character, a chest, or the thing itself where it lies. For `pick_up`, the holder the model
	 * named, else the one the character sees it in, else `find(thing)`.
	 */
	from:TEntity;
	/** Who or what holds it after: a character, or a chest it is put in. Left out, it is put down where `from` is. */
	to?:TEntity;
	/** How many. Default 1. */
	quantity?:number;
}

/**
 * Tags that mean the same to every part of the library, in every sight row. A host adds any others it likes; these it
 * should not use for anything else.
 */
export const RESERVED_TAGS = {
	/** Carried and picked up. */
	item: 'item',
	/** Fixed in place: what other things are placed relative to. */
	landmark: 'landmark',
	/** Someone who acts: listed first in sight, and never what other things are placed relative to. */
	character: 'character',
} as const;

/** What `castRay` hits: how far along the line, and whatever else the game wants handed back to its `getClarity`. */
export interface RayHit {
	distance:number;
}

/**
 * Where things are, and what stands between them: unlocks the watch geometry (`distance`, `nearby`, `isFacing`,
 * `isLeft` / `isRight`, `manhattan`, …), sight's bearings, hearing, and with `castRay` / `getClarity` what sight
 * sees, what sounds are muffled and the watch function `hasSightline`. `routes` and `transfers` need it. A
 * talk-only game leaves it out.
 */
export interface WorldGeometry<TEntity, THit extends RayHit = RayHit> {
	/** Which way is which: a preset such as `Axes.Unity` or `Axes.Plane`, or the game's own. Checked as the world is wired. */
	axes:Axes;
	/**
	 * Where `entity` is now. `from`: who is going there, so a thing spread over many cells (a forest, a wall) can answer
	 * with its part nearest them; ignore it for a thing in one place.
	 * @returns `undefined` when it has no place right now.
	 */
	getPose(entity:TEntity, from?:TEntity):Pose | undefined;
	/**
	 * The first thing in the way of `what` (a {@link Medium}) going straight from `a` to `b` now, point to point as
	 * engines cast (`Physics.Linecast`, `LineTraceSingleByChannel`); `undefined` when nothing is. The library reads
	 * only `distance` and hands the hit to `getClarity`, so each line is cast once. A line that starts or ends inside
	 * something that stops `what` (a wall cell, a cell a thin wall's board runs through) is hit there. Inside is the
	 * game's call, with heights where it has them: a guard on a wall's walkway stands on its floor, not in it, so a 2D
	 * game whose tiles have heights tests the line in 3D. Nothing standing at `a` or `b` is in the way: no one hides
	 * themselves, or the one looking.
	 */
	castRay?(what:Medium, a:Vec, b:Vec):THit | undefined;
	/**
	 * How clearly `what` (a {@link Medium}) goes straight from `a` to `b` now: 1 clear, 0 blocked, between for fog or
	 * a half-shut door; for now anything above 0 passes. With `castRay`, asked only on a hit, with that `hit` (light
	 * through glass: cast on from the hit); without, asked for every line, inside and at the ends as `castRay` says.
	 * Without either, nothing stops sight or sound; with `castRay` alone, whatever it hits stops them.
	 */
	getClarity?(what:Medium, a:Vec, b:Vec, hit?:THit):number;
	/**
	 * How far `character` reaches, edge to edge ({@link Pose.size}), to act on something and to count as there. Only
	 * about the reacher: a big target says so by its own `size`. Sight's roster marks who is `(in reach)`, or
	 * `(in reach, no clear shot)` where light does not pass (`getClarity`), a move stops this close, and by default a thief
	 * sees what others carry within `getReach(me, 'steal')` (`transfers.canSeeInventoryOf`).
	 * @param using Reach for what: an item it uses (`'Sword'`, a verb's `with`) or a verb (`'steal'`, `'go_to'`).
	 * Left out, bare-handed: or, as the game sees it, with what it holds now.
	 * @returns A distance. Default 1.
	 */
	getReach?(character:TEntity, using?:string):number;
}

/**
 * Moving: unlocks `go_to`, `follow`, `wander`, crowd formations, `pathDistance` / `isReachable` and `call.goTo`.
 * Given whole or not at all. `TPoint` is the game's own point, a `Vec` with its own fields (a cell that knows its
 * tile, a waypoint its links); the hooks get back exactly the points `createAt` and `getNeighbors` made, never copies.
 */
export interface WorldRoutes<TEntity, TPoint extends Vec = Vec> {
	/**
	 * A new point of this graph at `pos`, at its very coordinates (never moved to a node): on a grid, a point that
	 * knows the tile it is on; on a mesh, a point at that spot. Where a route starts, and where it ends on a goal's own
	 * point. Never a lookup of the nearest point the graph already has: `getNeighbors` links it in.
	 * Default: `pos` itself, for a game whose points are plain `Vec`s.
	 */
	createAt?(pos:Vec):TPoint;
	/**
	 * The points one step from `point`, which may be one `createAt` just made: a grid's cells around the one it is on,
	 * the points of the navmesh polygon it lies in, the waypoints in sight of it. The shape of the world alone, the
	 * same for everyone, and only points someone can step to; `getPassage` says which steps are open, and to whom.
	 */
	getNeighbors(point:TPoint):TPoint[];
	/**
	 * The step `who` (its size, what it carries) takes from `from` to its neighbor `to` now, asked the way it is
	 * walked: a ledge one may drop off but not climb answers each way differently. Nothing standing at `from` stops it.
	 * @returns `{ weight? }` when open, `{ blocked, by? }` when something stops it for now, `undefined` when it never
	 * gets through. Without it, every step is open, at weight 1.
	 */
	getPassage?(who:TEntity, from:TPoint, to:TPoint):Passage | undefined;
	/**
	 * Move `character` toward `point`, or stand still. Called every tick while a character moves, with the next
	 * waypoint. The game owns speed, collisions, animation, and how close counts as there.
	 * @param point A position, not a direction. `null` = stand still.
	 * @returns Whether the character is at `point` by the motor's own measure; that sends it on to the next waypoint.
	 */
	steerToward(character:TEntity, point:Vec | null):boolean;
}

/** Things changing hands: unlocks `pick_up`, `drop`, `give`, `offer` and `steal` (`withStealing`). Given whole or not at all. */
export interface WorldTransfers<TEntity> {
	/**
	 * Why `move` cannot happen, or nothing when it can: the game's rules for what may change hands, such as who owns
	 * a house, a locked chest, or a full pack; `move.verb` is `steal` for a theft, for the game's own rules on that.
	 * Every move is checked just before it is made, so the world already holds the moves before it in its `deal`. An
	 * offer is checked when it is posted too, as a dry run.
	 * @returns The reason, in words the agent can act on, naming by id: `(name) => \`${name(mira)}'s pack is full\``,
	 * "Realtor does not own Bridge". Default: every move may happen.
	 */
	validateTransfer?(move:Transfer<TEntity>, deal:Deal<TEntity>):NamingText | undefined;
	/**
	 * Whether `character` may make an offer to `other`, and that offer still stands. Default: with `withTalk` or
	 * `withHearing`, `other` makes out its words (`withTalk`'s range, then hearing's measure); else `other` is in its
	 * sight (`withSight`), else light passes between them (`getClarity`).
	 */
	canOffer?(character:TEntity, other:TEntity):boolean;
	/**
	 * Whether `character` may go and pick up `item` from `from`, or steal it: the item where it lies, what holds it, or
	 * the one it steals from. Default: `item` is in its sight there (`withSight`; with what it knows others carry and
	 * containers hold, `canSeeInventoryOf`), else light passes between it and `from` (`getClarity`).
	 * Return true to let characters fetch what they cannot see (what is in a shut chest), and undefined to leave it to
	 * the default.
	 */
	canPickUp?(character:TEntity, item:string, from:TEntity):boolean | undefined;
	/**
	 * Whether `viewer` knows what `holder` carries: a character, or a container (a thing the watch kernels' `isOpen`
	 * answers for). Asked for each one sight makes out that holds anything (shown `Bram (carrying: Purse, Bread)`, a
	 * container's as the items in it), for what `examine` looks at, and by the game for whom its failures may name
	 * ("needs KeyB, carried by William"): the library itself never measures the range. What it knows is what it may
	 * steal and take. Default: of a character, `viewer`'s kit has `steal` and `distance` is within its
	 * `getReach(viewer, 'steal')`; of a container, it is open and in sight. Undefined leaves it to the default (as a party
	 * that always knows what its own carry does for everyone else).
	 * @param distance Edge to edge ({@link Pose.size}); undefined where either has no place.
	 */
	canSeeInventoryOf?(viewer:TEntity, holder:TEntity, distance:number | undefined):boolean | undefined;
	/**
	 * Make `move`, which `validateTransfer` allowed. Throw only on a real error: the rules are already checked.
	 * @returns How to take it back. The library calls it only when a later move in the same deal fails, so the
	 * deal moves whole or not at all.
	 */
	transfer(move:Transfer<TEntity>):()=>void;
}

/**
 * The game's world, as the stock verbs need it. `TEntity` is whatever the game uses for things in its world
 * (a GameObject, an entity id, a record); ArcDirector never looks inside one. `find` is the only place an id
 * becomes an entity, and every other part receives entities. Vectors hold as many numbers as the game has
 * dimensions; the library reads that count from them.
 *
 * Each part unlocks verbs; a kit that grants a verb whose part is missing fails as the cast is wired. Queries
 * (`find`, `get…`) only read the world and may be called any time, often. Commands (the rest) change
 * the world; they announce what happened with `pushEvent`, as the game does when the player acts.
 *
 * | Part | Unlocks |
 * |--|--|
 * | `geometry` | watch geometry: `distance`, `nearby`, `isFacing`, `isLeft` / `isRight`, `manhattan`, …; bearings; hearing |
 * | `geometry.castRay`, `geometry.getClarity` | what sight sees and what sounds are muffled; the watch function `hasSightline` |
 * | `routes` (with `geometry`) | `go_to`, `follow`, `wander`, crowd formations, `pathDistance` / `isReachable`, `call.goTo` |
 * | `transfers` (with `geometry`) | `pick_up`, `drop`, `give`, `offer`, `steal` |
 * | `useItem` | `use` |
 * | `getDescription` | `examine` |
 */
export interface HostWorld<TEntity, TPoint extends Vec = Vec, THit extends RayHit = RayHit> {
	// Queries

	/**
	 * The entity an id names: a character, a thing, a place, or an item (an item in a chest or a pack is found as
	 * its holder, since that is where it is).
	 * @returns `undefined` when there is no such thing, or it is gone. The library then fails the verb with
	 * "no such …" or "… is gone", so no other part needs to check.
	 */
	find(id:string):TEntity | undefined;
	/**
	 * What `character` learns by examining `target`. Unlocks `examine`.
	 * @param target An id, not an entity: it may name an item, and which one is meant depends on whose pack it is in.
	 * @returns Text naming whoever it names through `name` (`(name) => \`${name(target)} is asleep\``), so each mind reads
	 * its own names for them; `undefined` when it cannot be examined from here.
	 */
	getDescription?(character:TEntity, target:string):NamingText | undefined;
	/**
	 * Whether the character `id` names has fallen: dead, knocked out or destroyed, but not gone (`find` still has it).
	 * Default: never.
	 */
	hasFallen?(id:string):boolean;
	/**
	 * Whether `name` is an item in this world. Given, a reply whose trade names anything else is sent back to the model
	 * to write again, before it runs. Default: any name will do, and the deal's own rules are all that check it.
	 */
	isItem?(name:string):boolean;

	// Commands

	/**
	 * Use a carried `item`, on `target` if given. Unlocks `use`. Both are ids as the model wrote them, so a target in
	 * someone's hands is still that thing, not its holder (`find` gives the holder): the world tells what is meant, as
	 * for `item`.
	 * @param target Already in reach of `character`.
	 */
	useItem?(character:TEntity, item:string, target?:string):Outcome;

	// Parts
	geometry?:WorldGeometry<TEntity, THit>;
	routes?:WorldRoutes<TEntity, TPoint>;
	transfers?:WorldTransfers<TEntity>;
}
