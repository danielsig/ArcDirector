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

export type PerceptionObject = {
	id:string;
	tags:string[];
	count?:number;
	interesting?:boolean;
	interactable?:boolean;
	movable?:boolean;
	landmarkTier:number;
	attachedTo?:string;
	attachMode?:'on' | 'in' | 'worn' | 'held';
	describe:(ctx:DescribeCtx)=>string;
};

export type LodCtx = DescribeCtx & {
	farDistance:number;
};

export type LodLayer = {
	id:string;
	enabled?:boolean;
	when:(obj:PerceptionObject, ctx:LodCtx)=>boolean;
	wrap?:(text:string, obj:PerceptionObject, ctx:LodCtx)=>string;
};

export type RelationshipHit = {
	text:string;
	unused:PerceptionObject[];
	mode:'reduce' | 'utter';
	reduceTo?:PerceptionObject;
};

export type StringifyCtx = {
	self:{ id:string };
	closeness:number;
	clusterFactor:number;
	groundAndFigure:(a:PerceptionObject, b:PerceptionObject)=>{
		ground:PerceptionObject;
		figure:PerceptionObject;
	};
	noun:(obj:PerceptionObject)=>string;
	distance:(a:PerceptionObject, b:PerceptionObject)=>number;
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
		objects:PerceptionObject[],
		ctx:StringifyCtx,
	)=>RelationshipHit | null;
};

export type PerceptionInput = {
	self:{ id:string };
	radius:number;
	unitName?:string;
	ambient?:string;
	objects:PerceptionObject[];
	closeness:number;
	farDistance:number;
	clusterFactor:number;
	lodLayers:LodLayer[];
	relationships:RelationshipStringifier[];
	distance:(a:PerceptionObject, b:PerceptionObject)=>number;
	bearing?:(obj:PerceptionObject)=>Bearing;
	pluralize?:(word:string)=>string;
};
