import type { SeenObject } from './types.js';

export function defaultLandmarkTier(obj:{ tags:string[]; movable?:boolean }):number {
	if (obj.movable === false || obj.tags.includes('landmark')) {
		return 80;
	}
	if (obj.tags.includes('agent') || obj.tags.includes('npc') || obj.tags.includes('person')) {
		return 10;
	}
	return 20;
}

export function groundAndFigure(
	a:SeenObject,
	b:SeenObject,
	rangeToSelf:(obj:SeenObject)=>number,
):{ ground:SeenObject; figure:SeenObject } {
	const aTier = a.landmarkTier ?? defaultLandmarkTier(a);
	const bTier = b.landmarkTier ?? defaultLandmarkTier(b);
	if (aTier !== bTier) {
		return aTier > bTier
			? { ground: a, figure: b }
			: { ground: b, figure: a };
	}
	const aUn = a.movable === false;
	const bUn = b.movable === false;
	if (aUn !== bUn) {
		return aUn ? { ground: a, figure: b } : { ground: b, figure: a };
	}
	const da = rangeToSelf(a);
	const db = rangeToSelf(b);
	if (da !== db) {
		return da > db ? { ground: a, figure: b } : { ground: b, figure: a };
	}
	return a.id < b.id ? { ground: a, figure: b } : { ground: b, figure: a };
}
