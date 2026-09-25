export type Bearing =
	| 'ahead'
	| 'behind'
	| 'left'
	| 'right'
	| 'north'
	| 'east'
	| 'south'
	| 'west'
	| 'away';

export type DescribeCtx = {
	npcID:string;
	distance:number;
	bearing:Bearing;
};

export type SeenObject = {
	id:string;
	at:number[];
	facing?:number[];
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
	/** Object ids folded into a reduce compound. Host snapshots omit this. */
	claimedIDs?:string[];
	hp?:number;
	maxHP?:number;
	/** Extra clause after the name, e.g. `Blade 3m away`. */
	note?:string;
};

/** One irreducible phrase `formatSight` cannot union further. */
export type SightClause = {
	text:string;
	claimedIDs:string[];
	ambient?:boolean;
	/** Keep ahead of scenery when `sightLimit` slices. People, not trees. */
	prefer?:boolean;
};

export type Sight = {
	self:{ id:string; at:number[]; facing?:number[] };
	ambient?:string;
	objects:SeenObject[];
};

export type SightOpts = {
	radius?:number;
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
