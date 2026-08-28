import { groundAndFigure } from './ground.js';
import { claimedOf, basicPluralize } from './stringifiers.js';
import type {
	LodCtx,
	PerceptionInput,
	PerceptionObject,
	RelationshipHit,
	StringifyCtx,
} from './types.js';

const EPS = 0.5;
const ATTACH_BONUS = 8;

type DistFn = PerceptionInput['distance'];

export function quantizeDistance(d:number, closeness:number):number {
	if (d > closeness * 2) {
		return Math.round(d / 5) * 5;
	}
	return Math.round(d);
}

function finite(d:number):number {
	return Number.isFinite(d) ? d : Infinity;
}

function selfObject(id:string, objects:PerceptionObject[]):PerceptionObject {
	return objects.find((o) => o.id === id) ?? {
		id,
		tags: [],
		landmarkTier: 0,
		describe: () => id,
	};
}

function meanPairwise(objs:PerceptionObject[], distance:DistFn):number {
	if (objs.length < 2) {
		return 0;
	}
	let s = 0;
	let n = 0;
	for (let i = 0; i < objs.length; i++) {
		for (let j = i + 1; j < objs.length; j++) {
			s += finite(distance(objs[i], objs[j]));
			n += 1;
		}
	}
	return n === 0 ? 0 : s / n;
}

function isAttachedCluster(claimed:PerceptionObject[]):boolean {
	if (claimed.length < 2) {
		return false;
	}
	const ids = new Set(claimed.map((o) => o.id));
	const grounds = claimed.filter((o) => !o.attachedTo || !ids.has(o.attachedTo));
	if (grounds.length === 1) {
		const groundID = grounds[0].id;
		return claimed.every((o) => o.id === groundID || (o.attachedTo !== undefined && ids.has(o.attachedTo)));
	}
	return claimed.every((o) => !o.attachedTo || ids.has(o.attachedTo));
}

function scoreHit(
	tier:number,
	claimed:PerceptionObject[],
	me:PerceptionObject,
	distance:DistFn,
):number {
	if (claimed.length === 0) {
		return -Infinity;
	}
	const span = meanPairwise(claimed, distance);
	let dObs = Infinity;
	for (const o of claimed) {
		dObs = Math.min(dObs, finite(distance(o, me)));
	}
	const attached = isAttachedCluster(claimed);
	return tier / (EPS + dObs) / (EPS + span) * (attached ? ATTACH_BONUS : 1);
}

function trimPeriod(s:string):string {
	return s.replace(/[.\s]+$/, '');
}

function joinAnd(parts:string[]):string {
	if (parts.length === 0) {
		return '';
	}
	if (parts.length === 1) {
		return parts[0];
	}
	if (parts.length === 2) {
		return `${parts[0]} and ${parts[1]}`;
	}
	return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
}

function lodNoun(
	obj:PerceptionObject,
	input:PerceptionInput,
	me:PerceptionObject,
	distance:DistFn,
):string {
	const ctx:LodCtx = {
		npcID: input.self.id,
		distance: finite(distance(obj, me)),
		bearing: input.bearing?.(obj) ?? 'away',
		farDistance: input.farDistance,
	};
	let text = obj.describe(ctx);
	for (const layer of input.lodLayers) {
		if (layer.enabled === false) {
			continue;
		}
		if (!layer.when(obj, ctx)) {
			continue;
		}
		if (layer.wrap) {
			text = layer.wrap(text, obj, ctx);
		}
	}
	return text;
}

function filterEligible(
	s:{ enabled?:boolean; tags?:string[]; excludeTags?:string[]; maxDistance?:number },
	objects:PerceptionObject[],
	me:PerceptionObject,
	distance:DistFn,
):PerceptionObject[] {
	if (s.enabled === false) {
		return [];
	}
	return objects.filter((o) => {
		if (s.tags && s.tags.length > 0 && !s.tags.some((t) => o.tags.includes(t))) {
			return false;
		}
		if (s.excludeTags && s.excludeTags.some((t) => o.tags.includes(t))) {
			return false;
		}
		if (s.maxDistance !== undefined && finite(distance(o, me)) > s.maxDistance) {
			return false;
		}
		return true;
	});
}

function leftoverClause(
	obj:PerceptionObject,
	input:PerceptionInput,
	me:PerceptionObject,
	distance:DistFn,
):string {
	const text = lodNoun(obj, input, me, distance);
	const d = quantizeDistance(finite(distance(obj, me)), input.closeness);
	const unit = input.unitName ?? 'm';
	return `${text} ${d}${unit} away`;
}

export function describeScene(input:PerceptionInput):string {
	const npcID = input.self.id;
	const all = input.objects.filter((o) => o.id !== npcID);
	const me = selfObject(npcID, input.objects);
	const distance = input.distance;
	const remaining = all.filter((o) => finite(distance(o, me)) <= input.radius);
	const stringifyCtx:StringifyCtx = {
		self: input.self,
		closeness: input.closeness,
		clusterFactor: input.clusterFactor,
		groundAndFigure: (a, b) => groundAndFigure(a, b, (o) => finite(distance(o, me))),
		noun: (obj) => lodNoun(obj, input, me, distance),
		distance,
		pluralize: input.pluralize ?? basicPluralize,
	};

	const hits:string[] = [];
	let pool = remaining;
	while (pool.length > 0) {
		let best:{ hit:RelationshipHit; claimed:PerceptionObject[] } | null = null;
		let bestScore = -Infinity;
		for (const s of input.relationships) {
			const eligible = filterEligible(s, pool, me, distance);
			if (eligible.length === 0) {
				continue;
			}
			const hit = s.stringify(eligible, stringifyCtx);
			if (!hit || hit.unused.length === eligible.length) {
				continue;
			}
			const claimed = claimedOf(eligible, hit);
			if (claimed.length === 0) {
				continue;
			}
			const value = scoreHit(s.tier, claimed, me, distance);
			if (value > bestScore) {
				bestScore = value;
				best = { hit, claimed };
			}
		}
		if (!best) {
			break;
		}
		const claimedSet = new Set(best.claimed);
		const unusedFromPool = pool.filter((o) => !claimedSet.has(o));
		if (best.hit.mode === 'utter') {
			hits.push(best.hit.text);
			pool = unusedFromPool;
		}
		else {
			if (!best.hit.reduceTo) {
				throw new Error(`relationship hit '${best.hit.text}' used reduce without reduceTo`);
			}
			pool = [...unusedFromPool, best.hit.reduceTo];
		}
	}

	const leftovers = [...pool]
		.sort((a, b) => b.landmarkTier - a.landmarkTier || a.id.localeCompare(b.id))
		.map((o) => leftoverClause(o, input, me, distance));

	const clauses:string[] = [];
	if (input.ambient && input.ambient.trim()) {
		clauses.push(trimPeriod(input.ambient.trim()));
	}
	for (const h of hits) {
		clauses.push(trimPeriod(h));
	}
	if (leftovers.length > 0) {
		clauses.push(trimPeriod(joinAnd(leftovers)));
	}
	if (clauses.length === 0) {
		return '';
	}
	return `${clauses.join('. ')}.`;
}
