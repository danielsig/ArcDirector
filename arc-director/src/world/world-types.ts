import type { Deal } from './deal.js';

/**
 * A position or a direction in world space, as many numbers as the game has dimensions (1D, 2D, 3D); the
 * game uses the same count everywhere. Units are the game's own; ArcDirector only compares and adds them.
 * A position is always called `point`; a direction is named for where it points (`facing`, `right`, `up`)
 * and is a unit vector.
 */
export type Vec = number[];

/** Where a character or thing is and, if it faces, which way. */
export interface Pose {
	/** Where it is. */
	point:Vec;
	/** Unit direction it faces. Leave out for things that do not face. */
	facing?:Vec;
	/** Unit direction of its right hand, so left and right mean what the game means. Leave out for things that do not face. */
	right?:Vec;
}

/**
 * What `canPass` is asked about: the library asks `light` (sight) and `sound` (hearing). A game adds its own for its
 * own verbs, and its `canPass` answers them too: `declare module 'arc-director' { interface Media { smell:true } }`.
 */
export interface Media {
	light:true;
	sound:true;
}

/** One of the {@link Media}: `light`, `sound`, or one the game added. */
export type Medium = keyof Media;

/** What `canTraverse` says of a step it lets through, or of one something stops for now. */
export interface PathStep {
	/**
	 * How many times its length the step costs. Default 1, and never less, so the search stays exact; raise it to
	 * route around crowds or rough ground.
	 */
	weight?:number;
	/**
	 * What stops this step right now, for this character ("EastDoor is locked — you carry IronKey"). The search
	 * avoids it; with no open way, the move fails naming each blocker that leads there, cheapest first.
	 */
	blocked?:string;
	/** The character or thing that blocks it, when one does (a foe's wall): a failed move lists it in `blockedBy`. */
	by?:string;
}

/** What the world says to a command. */
export interface Outcome {
	/** Done, or refused. */
	ok:boolean;
	/** Why, in words the agent can act on: "Chest is locked", "no room". */
	reason?:string;
}

/**
 * One thing changing hands: picked up, put down, given, paid, traded or stolen. A thing is whatever the game lets
 * move: an item, gold, a house deed, a promise of work. What each name means is the game's call.
 */
export interface Transfer<TEntity> {
	/** The verb that moves it, which says who acts: `pick_up`, `drop`, `give`, `offer`, or the game's own, such as `steal`. */
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

/**
 * The game's world, as the stock verbs need it. `TEntity` is whatever the game uses for things in its world
 * (a GameObject, an entity id, a record); ArcDirector never looks inside one. `find` is the only place an id
 * becomes an entity, and every other part receives entities.
 *
 * Each part unlocks verbs; a kit that grants a verb whose part is missing fails as the cast is wired. Queries
 * (`find`, `get…`, `up`) only read the world and may be called any time, often. Commands (the rest) change
 * the world; they announce what happened with `pushEvent`, as the game does when the player acts.
 *
 * | Part | Unlocks |
 * |--|--|
 * | `find`, `getPose` | watch geometry: `distance`, `nearby`, `isFacing`, `isLeft` / `isRight`, `manhattan`, … |
 * | `getNeighbors`, `steerToward` (and `canTraverse`, `getNearby`) | `go_to`, `follow`, `wander`, crowd formations, `pathDistance` / `isReachable`, `call.goTo` |
 * | `canPass` | what sight sees and what sounds are muffled; the watch function `hasSightline` |
 * | `transfer` (and `validateTransfer`, for the game's rules) | `pick_up`, `drop`, `give`, `offer` |
 * | `useItem` | `use` |
 * | `getDescription` | `examine` |
 *
 * `TPoint` is the game's own point, a `Vec` with its own fields (a cell that knows its tile, a waypoint its links).
 * The route hooks get back exactly the points they returned, never copies, so only `getNearby` looks one up.
 */
export interface HostWorld<TEntity, TPoint extends Vec = Vec> {
	// Queries

	/**
	 * The entity an id names: a character, a thing, a place, or an item (an item in a chest or a pack is found as
	 * its holder, since that is where it is).
	 * @returns `undefined` when there is no such thing, or it is gone. The library then fails the verb with
	 * "no such …" or "… is gone", so no other part needs to check.
	 */
	find(id:string):TEntity | undefined;
	/**
	 * Whether `name` is an item in this world. Given, a reply whose trade names anything else is sent back to the model
	 * to write again, before it runs. Default: any name will do, and the deal's own rules are all that check it.
	 */
	isItem?(name:string):boolean;
	/**
	 * Where `entity` is now. `from`: who is going there, so a thing spread over many cells (a forest, a wall) can answer
	 * with its part nearest them; ignore it for a thing in one place.
	 * @returns `undefined` when it has no place right now.
	 */
	getPose(entity:TEntity, from?:TEntity):Pose | undefined;
	/**
	 * Whether the character `id` names is down: dead, knocked out or destroyed. A collective's `units` and roster leave
	 * it out (its prompt lists it under "Down:"), and a verb aimed at it fails with "… is down", not "… is gone".
	 * Default: no one is ever down, and only `find` says who is gone.
	 */
	isDown?(id:string):boolean;
	/**
	 * `point` as a `TPoint` at exactly its coordinates (never moved to a node), and every node it links to, any
	 * direction, any count (the waypoints in sight of it): where a route starts, and where it ends on a goal's own point.
	 * Default: `point` and its `getNeighbors`, for a game whose points are plain `Vec`s.
	 */
	getNearby?(point:Vec):{ at:TPoint; nearby:TPoint[] };
	/**
	 * The nodes one step from `node`: a grid's cells around it, a navmesh's adjacent polygons, a waypoint's links.
	 * The shape of the world alone, the same for everyone, and only nodes someone can step to; `canTraverse` says
	 * which steps are open, and to whom.
	 */
	getNeighbors?(node:TPoint):TPoint[];
	/**
	 * The step `who` (its size, what it carries) takes from `from` to its neighbor `to` now, asked the way it is
	 * walked: a ledge one may drop off but not climb answers each way differently. Nothing standing at `from` stops it.
	 * @returns `{ weight? }` when open, `{ blocked, by? }` when something stops it for now, `undefined` when it never
	 * gets through. Without it, every step is open, at weight 1.
	 */
	canTraverse?(who:TEntity, from:TPoint, to:TPoint):PathStep | undefined;
	/**
	 * How clearly `what` (a {@link Medium}) goes straight from `a` to `b` now: 1 clear, 0 blocked, between for fog or
	 * a half-shut door; for now anything above 0 passes. Nothing standing at `a` or `b` stops it: no one hides
	 * themselves, or the one looking. Without it, nothing stops sight or sound.
	 */
	canPass?(what:Medium, a:Vec, b:Vec):number;
	/**
	 * How close `character` must be to `target` to act on it, and to count as there.
	 * @returns A distance. Default 1.
	 */
	getReach?(character:TEntity, target:TEntity):number;
	/**
	 * What `character` learns by examining `target`.
	 * @param target An id, not an entity: it may name an item, and which one is meant depends on whose pack it is in.
	 * @returns `undefined` when it cannot be examined from here.
	 */
	getDescription?(character:TEntity, target:string):string | undefined;
	/**
	 * Why `move` cannot happen, or nothing when it can: the game's rules for what may change hands, such as who owns
	 * a house, a locked chest, or a full pack. Every move is checked just before it is made, so the world already
	 * holds the moves before it in its `deal`. An offer is checked when it is posted too, as a dry run.
	 * @returns The reason, in words the agent can act on: "Mira's pack is full", "Realtor does not own Bridge".
	 * Default: every move may happen.
	 */
	validateTransfer?(move:Transfer<TEntity>, deal:Deal<TEntity>):string | undefined;
	/**
	 * Whether `character` may make an offer to `other`, and that offer still stands. Default: `other` is in its sight
	 * (`withSight`), else light passes between them (`canPass`).
	 */
	canOffer?(character:TEntity, other:TEntity):boolean;
	/**
	 * Whether `character` may go and pick up `item` from `from`: the item where it lies, or what holds it. Default:
	 * `item` is in its sight there (`withSight`), else light passes between it and `from` (`canPass`).
	 * Return true to let characters fetch what they cannot see (what is in a shut chest), and undefined to leave it to
	 * the default.
	 */
	canPickUp?(character:TEntity, item:string, from:TEntity):boolean | undefined;
	/** World up, a unit direction, for formations in 3D. Default `[0, 1, 0]`. Unused in 1D and 2D. */
	up?:Vec;

	// Commands

	/**
	 * Move `character` toward `point`, or stand still. Called every tick while a character moves, with the next
	 * waypoint. The game owns speed, collisions, animation, and how close counts as there.
	 * @param point A position, not a direction. `null` = stand still.
	 * @returns Whether the character is at `point` by the motor's own measure; that sends it on to the next waypoint.
	 */
	steerToward?(character:TEntity, point:Vec | null):boolean;
	/**
	 * Make `move`, which `validateTransfer` allowed. Throw only on a real error: the rules are already checked.
	 * @returns How to take it back. The library calls it only when a later move in the same deal fails, so the
	 * deal moves whole or not at all.
	 */
	transfer?(move:Transfer<TEntity>):()=>void;
	/**
	 * Use a carried `item`, on `target` if given. Both are ids as the model wrote them, so a target in someone's hands
	 * is still that thing, not its holder (`find` gives the holder): the world tells what is meant, as for `item`.
	 * @param target Already in reach of `character`.
	 */
	useItem?(character:TEntity, item:string, target?:string):Outcome;
}
