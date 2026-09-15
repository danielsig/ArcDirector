import { defaultLandmarkTier, groundAndFigure } from './ground.js';
import { claimedOf, basicPluralize, builtinStringifiers } from './stringifiers.js';
import { builtinLodLayers } from './lod.js';
import type {
	Bearing,
	SightOpts,
	LodCtx,
	RelationshipHit,
	SeenObject,
	Sight,
	SightClause,
	StringifyCtx,
} from './types.js';

const EPS = 0.5;
const ATTACH_BONUS = 8;

export const DEFAULT_SIGHT:Required<Pick<SightOpts,
	'radius' | 'unitName' | 'closeness' | 'farDistance' | 'clusterFactor'
>> = {
	radius: 24,
	unitName: 'pace',
	closeness: 2,
	farDistance: 12,
	clusterFactor: 1.2,
};

type DistFn = (a:SeenObject, b:SeenObject)=>number;

export function quantizeDistance(d:number, closeness:number):number {
	if (d > closeness * 2) {
		return Math.round(d / 5) * 5;
	}
	return Math.round(d);
}

function finite(d:number):number {
	return Number.isFinite(d) ? d : Infinity;
}

function clamp01(n:number):number {
	if (!Number.isFinite(n)) {
		return 0;
	}
	return Math.min(1, Math.max(0, n));
}

export function hypotAt(a:number[], b:number[]):number {
	const n = Math.min(a.length, b.length);
	let s = 0;
	for (let i = 0; i < n; i++) {
		const d = (a[i] ?? 0) - (b[i] ?? 0);
		s += d * d;
	}
	return Math.sqrt(s);
}

export function bearingOf(
	self:{ at:number[]; facing?:number[] },
	obj:{ at:number[] },
):Bearing {
	const f = self.facing;
	if (!f || f.length === 0) {
		return 'away';
	}
	const n = Math.min(self.at.length, obj.at.length, f.length);
	if (n === 0) {
		return 'away';
	}
	const delta:number[] = [];
	for (let i = 0; i < n; i++) {
		delta.push((obj.at[i] ?? 0) - (self.at[i] ?? 0));
	}
	let dot = 0;
	for (let i = 0; i < n; i++) {
		dot += (f[i] ?? 0) * delta[i];
	}
	if (n === 1) {
		return dot >= 0 ? 'ahead' : 'behind';
	}
	const cross = (f[0] ?? 0) * delta[1] - (f[1] ?? 0) * delta[0];
	if (Math.abs(dot) >= Math.abs(cross)) {
		return dot >= 0 ? 'ahead' : 'behind';
	}
	return cross > 0 ? 'right' : 'left';
}

function fillSeen(obj:SeenObject):SeenObject {
	return {
		...obj,
		interesting: clamp01(obj.interesting ?? 0),
		landmarkTier: obj.landmarkTier ?? defaultLandmarkTier(obj),
	};
}

function selfObject(sight:Sight, objects:SeenObject[]):SeenObject {
	return objects.find((o) => o.id === sight.self.id) ?? {
		id: sight.self.id,
		at: sight.self.at,
		facing: sight.self.facing,
		tags: [],
		landmarkTier: 0,
		interesting: 0,
	};
}

function meanPairwise(objs:SeenObject[], distance:DistFn):number {
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

function isAttachedCluster(claimed:SeenObject[]):boolean {
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
	claimed:SeenObject[],
	me:SeenObject,
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

function isPerson(obj:SeenObject):boolean {
	return obj.tags.includes('agent') || obj.tags.includes('person');
}

function leftoverRank(obj:SeenObject):number {
	if (isPerson(obj)) {
		return 300 + (obj.interesting ?? 0);
	}
	if (obj.movable === false || obj.tags.includes('landmark')) {
		return 200 + (obj.landmarkTier ?? 0);
	}
	return 100 + (obj.interesting ?? 0);
}

function lodNoun(
	obj:SeenObject,
	opts:Required<Pick<SightOpts, 'farDistance'>> & Pick<SightOpts, 'lodLayers'>,
	me:SeenObject,
	distance:DistFn,
	npcID:string,
	bearingFn:(obj:SeenObject)=>Bearing,
):string {
	const ctx:LodCtx = {
		npcID,
		distance: finite(distance(obj, me)),
		bearing: bearingFn(obj),
		farDistance: opts.farDistance,
	};
	let text = obj.label ?? obj.id;
	for (const layer of opts.lodLayers ?? []) {
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
	objects:SeenObject[],
	me:SeenObject,
	distance:DistFn,
):SeenObject[] {
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
	obj:SeenObject,
	me:SeenObject,
	distance:DistFn,
	opts:{
		closeness:number;
		unitName:string;
		farDistance:number;
		lodLayers:NonNullable<SightOpts['lodLayers']>;
		fromName?:string;
	},
	npcID:string,
	bearingFn:(obj:SeenObject)=>Bearing,
	hasFacing:boolean,
):string {
	const text = lodNoun(obj, opts, me, distance, npcID, bearingFn);
	const d = quantizeDistance(finite(distance(obj, me)), opts.closeness);
	const unit = `${opts.unitName}${d === 1 ? '' : 's'}`;
	if (opts.fromName) {
		return `${text} ${d} ${unit} from ${opts.fromName}`;
	}
	if (!hasFacing) {
		return `${text} ${d} ${unit}`;
	}
	return `${text} ${d} ${unit} ${bearingFn(obj)}`;
}

function idsOf(obj:SeenObject):string[] {
	return obj.claimedIDs && obj.claimedIDs.length > 0 ? obj.claimedIDs : [obj.id];
}

function uniqueIDs(ids:string[]):string[] {
	const seen = new Set<string>();
	const out:string[] = [];
	for (const id of ids) {
		if (!id || seen.has(id)) {
			continue;
		}
		seen.add(id);
		out.push(id);
	}
	return out;
}

function stampClaimed(obj:SeenObject, extra:SeenObject[]):SeenObject {
	return {
		...obj,
		claimedIDs: uniqueIDs([
			...idsOf(obj),
			...extra.flatMap(idsOf),
		]),
	};
}

export function joinSightClauses(clauses:SightClause[]):string {
	const texts = clauses.map((c) => trimPeriod(c.text)).filter((t) => t.length > 0);
	if (texts.length === 0) {
		return '';
	}
	return `${texts.join('. ')}.`;
}

export function clauseScore(clause:SightClause, objectScores?:Map<string, number>):number {
	if (!objectScores || clause.claimedIDs.length === 0) {
		return 0;
	}
	let max = 0;
	for (const id of clause.claimedIDs) {
		const s = objectScores.get(id) ?? 0;
		if (s > max) {
			max = s;
		}
	}
	return max;
}

/** Intersecting claimed sets collapse to one clause. Disjoint sets stay separate. */
export function dedupIntersectingClauses(
	clauses:SightClause[],
	objectScores?:Map<string, number>,
):SightClause[] {
	const out:SightClause[] = [];
	for (const clause of clauses) {
		if (clause.ambient || clause.claimedIDs.length === 0) {
			out.push(clause);
			continue;
		}
		const set = new Set(clause.claimedIDs);
		const idx = out.findIndex((row) => (
			!row.ambient && row.claimedIDs.some((id) => set.has(id))
		));
		if (idx < 0) {
			out.push(clause);
			continue;
		}
		const prev = out[idx];
		if (clauseScore(clause, objectScores) > clauseScore(prev, objectScores)) {
			out[idx] = clause;
		}
	}
	return out;
}

export function orderSightClauses(
	clauses:SightClause[],
	objectScores?:Map<string, number>,
	sightLimit?:number,
	rank = false,
):SightClause[] {
	const doRank = rank || !!(objectScores && objectScores.size > 0);
	let ordered:SightClause[];
	if (doRank) {
		const ambient = clauses.filter((c) => c.ambient);
		const rest = clauses.filter((c) => !c.ambient);
		const keyed = rest.map((c, i) => ({ c, i, score: clauseScore(c, objectScores) }));
		keyed.sort((a, b) => b.score - a.score || a.i - b.i);
		ordered = [...ambient, ...keyed.map((k) => k.c)];
	}
	else {
		ordered = clauses;
	}
	if (sightLimit !== undefined && Number.isFinite(sightLimit) && sightLimit >= 0) {
		ordered = ordered.slice(0, Math.max(0, Math.floor(sightLimit)));
	}
	return ordered;
}

export function mergeHiveClauses(
	groups:{ unitID:string; clauses:SightClause[] }[],
	objectScores?:Map<string, number>,
):SightClause[] {
	const merged:SightClause[] = [];
	let ambient:SightClause | undefined;
	for (const group of groups) {
		for (const clause of group.clauses) {
			if (clause.ambient) {
				if (!ambient && clause.text.trim()) {
					ambient = clause;
				}
				continue;
			}
			merged.push(clause);
		}
	}
	const rows = ambient ? [ambient, ...merged] : merged;
	return dedupIntersectingClauses(rows, objectScores);
}

export function formatSightClauses(sight:Sight, opts:SightOpts = {}):SightClause[] {
	const radius = opts.radius ?? DEFAULT_SIGHT.radius;
	const unitName = opts.unitName ?? DEFAULT_SIGHT.unitName;
	const closeness = opts.closeness ?? DEFAULT_SIGHT.closeness;
	const farDistance = opts.farDistance ?? DEFAULT_SIGHT.farDistance;
	const clusterFactor = opts.clusterFactor ?? DEFAULT_SIGHT.clusterFactor;
	const lodLayers = opts.lodLayers ?? builtinLodLayers();
	const relationships = opts.relationships ?? builtinStringifiers();
	const pluralize = opts.pluralize ?? basicPluralize;

	const npcID = sight.self.id;
	const objects = sight.objects.map(fillSeen);
	const me = selfObject(sight, objects);
	const distance:DistFn = (a, b) => hypotAt(a.at, b.at);
	const hasFacing = !!(sight.self.facing && sight.self.facing.length > 0);
	const bearingFn = (obj:SeenObject):Bearing => bearingOf(sight.self, obj);

	const remaining = objects.filter((o) => (
		o.id !== npcID && finite(distance(o, me)) <= radius
	));
	const stringifyCtx:StringifyCtx = {
		self: { id: npcID },
		closeness,
		clusterFactor,
		groundAndFigure: (a, b) => groundAndFigure(a, b, (o) => finite(distance(o, me))),
		noun: (obj) => lodNoun(obj, { farDistance, lodLayers }, me, distance, npcID, bearingFn),
		distance,
		pluralize,
	};

	const hits:{ text:string; claimedIDs:string[] }[] = [];
	let pool = remaining;
	while (pool.length > 0) {
		let best:{ hit:RelationshipHit; claimed:SeenObject[] } | null = null;
		let bestScore = -Infinity;
		for (const s of relationships) {
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
			hits.push({
				text: best.hit.text,
				claimedIDs: uniqueIDs(best.claimed.flatMap(idsOf)),
			});
			pool = unusedFromPool;
		}
		else {
			if (!best.hit.reduceTo) {
				throw new Error(`relationship hit '${best.hit.text}' used reduce without reduceTo`);
			}
			pool = [...unusedFromPool, fillSeen(stampClaimed(best.hit.reduceTo, best.claimed))];
		}
	}

	const leftoverOpts = { closeness, unitName, farDistance, lodLayers, fromName: opts.fromName };
	const leftovers = [...pool]
		.sort((a, b) => leftoverRank(b) - leftoverRank(a)
			|| (b.landmarkTier ?? 0) - (a.landmarkTier ?? 0)
			|| (b.interesting ?? 0) - (a.interesting ?? 0)
			|| a.id.localeCompare(b.id))
		.map((o) => ({
			text: leftoverClause(o, me, distance, leftoverOpts, npcID, bearingFn, hasFacing),
			claimedIDs: idsOf(o),
		}));

	const clauses:SightClause[] = [];
	if (!opts.skipAmbient && sight.ambient && sight.ambient.trim()) {
		clauses.push({ text: trimPeriod(sight.ambient.trim()), claimedIDs: [], ambient: true });
	}
	for (const h of hits) {
		clauses.push({ text: trimPeriod(h.text), claimedIDs: h.claimedIDs });
	}
	for (const leftover of leftovers) {
		clauses.push({ text: trimPeriod(leftover.text), claimedIDs: leftover.claimedIDs });
	}
	return clauses;
}

export function formatSight(sight:Sight, opts:SightOpts = {}):string {
	return joinSightClauses(formatSightClauses(sight, opts));
}
