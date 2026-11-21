import type { Axes } from '../world/axes.js';
import type { Vec } from '../world/world-types.js';

// An enum, where `Medium`, `SayTone` and `Feeling` are named-values objects: a game adds to those; this set is closed, the library's own.
/**
 * Which way a seen or heard thing is: the compass clockwise from north, then round the looker clockwise from ahead,
 * then above or below (3D, steeper than 45°), then `Away` where no way can be told. Saves and logs keep the values.
 */
export enum Bearing {
	North = 'north', Northeast = 'northeast', East = 'east', Southeast = 'southeast',
	South = 'south', Southwest = 'southwest', West = 'west', Northwest = 'northwest',
	Ahead = 'ahead', AheadRight = 'ahead_right', Right = 'right', BehindRight = 'behind_right',
	Behind = 'behind', BehindLeft = 'behind_left', Left = 'left', AheadLeft = 'ahead_left',
	Above = 'above', Below = 'below',
	Away = 'away',
}

/**
 * How sight and hearing tell where a thing is: from the one looking (`Relative`, "Mira 12m to your right"), by the
 * compass of the world's axes (`Absolute`, "Mira 12m south"), or both (`Both`, "Mira 12m to your right (south)"). In 3D,
 * a thing more up or down than away is `above you` / `below you` in every mode; `Both` adds its compass ("above you (north)").
 */
export enum BearingMode {
	Relative = 'relative', Absolute = 'absolute', Both = 'both',
}

/**
 * Where a seen thing is from the one looking: how far, how clearly (`SeenObject.clarity`), which way it faces in the
 * looker's own frame (`toLocal`; left out for a thing that does not face, or a looker that does not), and its bearing:
 * from the looker, or by the compass where sight tells bearings so (`withSight({ bearing })`).
 */
export type Sighting = {
	distance:number;
	clarity:number;
	facing?:Vec;
	bearing:Bearing;
};

export type DescribeCtx = {
	npcID:string;
	distance:number;
	bearing:Bearing;
};

export interface SeenObject {
	id:string;
	point:Vec;
	/**
	 * What is so of it until something changes it, each in plain words, no ids, that read after "is": a bridge's
	 * `{ position: 'lowered' }`, a torch's `{ flame: 'out' }`. A mind that finds it changed since it last saw it is told
	 * so, once. What changes all the time (where it stands, what it does) is no state.
	 */
	state?:Readonly<Record<string, string>>;
	facing?:Vec;
	tags:string[];
	count?:number;
	interesting?:number;
	interactable?:boolean;
	movable?:boolean;
	landmarkTier?:number;
	attachedTo?:string;
	attachMode?:'on' | 'in' | 'worn' | 'held';
	/** Compound phrase from a reduce hit. Host snapshots omit this. */
	label?:string;
	/**
	 * What sort of thing it is, in one word that tells nothing of which one (`Book`, `Wolf`): seen but not made out, it
	 * goes by this and letters (`BookA`). Left out, a character is a `Figure` and anything else `Something`.
	 */
	kind?:string;
	/** Object ids folded into a reduce compound. Host snapshots omit this. */
	claimedIDs?:string[];
	hp?:number;
	maxHP?:number;
	/** Extra clause after the name, e.g. `Blade 3m away`. */
	note?:string;
	/**
	 * What it is doing now, in a few words: `firing`, `reviving Bo`. Left out, a character in the cast shows the verb it
	 * runs, in that verb's own words (`going to Cottage`). So a sound it makes, being seen, is not told again.
	 */
	doing?:string;
	/** How it looks, in a few words: `looking angry`. Left out, a character shows the feeling it expresses (`withFeelings`). */
	looks?:string;
	/**
	 * What it carries, as the one looking knows it (`transfers.canSeeInventoryOf`; by default, one whose kit has `steal`,
	 * within its `getReach(me, 'steal')`): shown (`carrying: Purse, Bread`), and what it may steal from it. Sight fills it
	 * from the watch kernels' `inventory`.
	 */
	carrying?:string[];
	/** Seen from anywhere: past sight's range, and whatever stands between (`getClarity`). A bridge everyone can see. */
	always?:boolean;
	/**
	 * How clearly the one looking makes it out, 0 to 1 (default 1), set by the host's `look`, which has the scene. Lower
	 * it for: distance, darkness, fog / smoke / rain / dust, partial cover (foliage, a crowd, a half wall, a door frame),
	 * glare (facing the sun or a bright lamp), light out of balance across a window (the bright side cannot see into the
	 * dark, the dark side sees out), light from behind it (a silhouette), the edge of the field of view or behind, small
	 * size, camouflage, fast movement, and the looker's state (blinded, waking, drunk, wounded).
	 */
	clarity?:number;
}

/** One irreducible phrase `formatSight` cannot union further. */
export type SightClause = {
	text:string;
	claimedIDs:string[];
	ambient?:boolean;
	/** Keep ahead of scenery when `sightLimit` slices. People, not trees. */
	prefer?:boolean;
	/** The characters whose look showed it, where a collective pools what several see. Unset: its mind's voice. */
	knownBy?:string[];
};

export type Sight = {
	/** The one looking; `up` only when different from the world's up (flight, space, planets). */
	self:{ id:string; point:Vec; facing?:Vec; up?:Vec };
	ambient?:string;
	objects:SeenObject[];
};

export type SightOpts = {
	unitName?:string;
	closeness?:number;
	farDistance?:number;
	clusterFactor?:number;
	lodLayers?:LodLayer[];
	relationships?:RelationshipStringifier[];
	pluralize?:(word:string)=>string;
	/** Leftover distances read as `Door 10 paces from Mira` / `Door 10m from Mira`. */
	fromName?:string;
	/** Skip the ambient sentence (hive merge already kept one). */
	skipAmbient?:boolean;
	/** The world's axes (`checkAxes`), which left, right and the compass are told by. Without them, no bearing is told. */
	axes?:Axes;
	/** How bearings are told. Default `relative`. */
	bearing?:BearingMode;
};

export type LodCtx = DescribeCtx & {
	farDistance:number;
};

export type LodLayer = {
	id:string;
	enabled?:boolean;
	when:(obj:SeenObject, ctx:LodCtx)=>boolean;
	wrap?:(text:string, obj:SeenObject, ctx:LodCtx)=>string;
};

export type RelationshipHit = {
	text:string;
	unused:SeenObject[];
	mode:'reduce' | 'utter';
	reduceTo?:SeenObject;
};

export type StringifyCtx = {
	self:{ id:string };
	closeness:number;
	clusterFactor:number;
	groundAndFigure:(a:SeenObject, b:SeenObject)=>{
		ground:SeenObject;
		figure:SeenObject;
	};
	noun:(obj:SeenObject)=>string;
	/** What follows a character's name wherever it is named: ` (4/12 hp, foe Blade)`, or nothing. */
	details:(obj:SeenObject)=>string;
	distance:(a:SeenObject, b:SeenObject)=>number;
	pluralize:(word:string)=>string;
};

export type RelationshipStringifier = {
	id:string;
	tier:number;
	enabled?:boolean;
	tags?:string[];
	excludeTags?:string[];
	maxDistance?:number;
	stringify:(
		objects:SeenObject[],
		ctx:StringifyCtx,
	)=>RelationshipHit | null;
};
