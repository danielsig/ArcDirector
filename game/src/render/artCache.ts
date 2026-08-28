/** Layout written by the Vite art-cache plugin (`game/cache`). */

export type AtlasRect = [x:number, y:number, w:number, h:number];

export type KindAtlas = {
	hash:string;
	alb:string;
	nrm:string;
	w:number;
	h:number;
	frames:Record<string, AtlasRect>;
};

export type ArtCacheManifest = {
	v:number;
	kinds:Record<string, KindAtlas>;
	sword:KindAtlas;
};
