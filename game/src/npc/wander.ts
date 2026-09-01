import {
	DEFAULT_EPSILON,
	SampleCache,
	buildCatalog,
	evaluate,
	pascalCase,
	watchScore,
} from 'arc-director';
import { Interior, Named } from '../engine/components';
import type { GameObject } from '../engine/GameObject';
import { MeshRenderer } from '../engine/MeshRenderer';
import { distXZ } from '../items/inventory';
import { Item, Pickupable } from '../items/components';
import { CELL_SIZE } from '../world/constants';
import { cellWalkable } from '../world/path';
import { kernelsOf, type PosedFact } from './kernels';
import { bodyName } from './names';
import { tagsOf } from './perception';
import type { HostCtx } from './types';

const SKIP_NEEDLES = new Set([
	'me', 'others', 'items', 'events', 'landmarks',
	'hasHeard', 'prevThought', 'prevActions',
	'true', 'false',
]);
const STEP = 8;
const SAMPLE = 16;
const SEEN_CAP = 12;
const SIGHT = 24;

export function wanderNeedles(expr:string):string[] {
	const out:string[] = [];
	const seen = new Set<string>();
	const add = (raw:string) => {
		const text = raw.trim();
		if (!text || SKIP_NEEDLES.has(text) || seen.has(text.toLowerCase())) {
			return;
		}
		seen.add(text.toLowerCase());
		out.push(text);
	};
	for (const hit of expr.matchAll(/"([^"]+)"|'([^']+)'/g)) {
		add(hit[1] ?? hit[2] ?? '');
	}
	for (const hit of expr.matchAll(/\b([A-Z][A-Za-z0-9]+)\b/g)) {
		add(hit[1] ?? '');
	}
	return out;
}

export function wanderSeeksWater(needles:readonly string[]):boolean {
	return needles.some((n) => /^(river|water|waterfall|stream|bank)$/i.test(n));
}

function needleHits(go:GameObject, needle:string):boolean {
	const want = needle.toLowerCase();
	const named = go.getComponent(Named)?.id ?? '';
	const mesh = go.getComponent(MeshRenderer)?.meshID ?? '';
	const tags = tagsOf(go);
	const labels = [go.id, named, mesh, ...tags];
	if (tags.includes('tree')) {
		labels.push('Tree', 'trees', 'forest');
	}
	if (go.getComponent(Interior)) {
		labels.push('house', 'home', 'cottage');
	}
	return labels.some((s) => s.toLowerCase() === want);
}

function nearestMatch(actor:GameObject, needles:readonly string[]):GameObject | null {
	const world = actor.world;
	if (!world || needles.length === 0) {
		return null;
	}
	let best:GameObject | null = null;
	let bestDist = Infinity;
	for (const go of world.objects) {
		if (go === actor || go.id === 'MainCamera') {
			continue;
		}
		if (!needles.some((n) => needleHits(go, n))) {
			continue;
		}
		const d = distXZ(actor, go);
		if (d < bestDist) {
			best = go;
			bestDist = d;
		}
	}
	return best;
}

function waterAdjacent(world:NonNullable<GameObject['world']>, x:number, z:number):boolean {
	const step = CELL_SIZE;
	for (const [dx, dz] of [[step, 0], [-step, 0], [0, step], [0, -step]]) {
		if (world.tileAtWorld(x + dx, z + dz)?.def === 'water') {
			return true;
		}
	}
	return false;
}

function sampleWalkable(actor:GameObject):{ x:number; z:number }[] {
	const world = actor.world;
	if (!world) {
		return [];
	}
	const p = actor.transform.position;
	const out:{ x:number; z:number }[] = [];
	for (let i = 0; i < SAMPLE; i++) {
		const a = Math.random() * Math.PI * 2;
		const r = 3 + Math.random() * STEP;
		const x = p.x + Math.cos(a) * r;
		const z = p.z + Math.sin(a) * r;
		if (cellWalkable(world, x, z)) {
			out.push({ x, z });
		}
	}
	return out;
}

export function pickWanderPoint(actor:GameObject, expr:string):{ x:number; z:number } | null {
	const world = actor.world;
	if (!world) {
		return null;
	}
	const p = actor.transform.position;
	const needles = wanderNeedles(expr);
	const samples = sampleWalkable(actor);
	if (samples.length === 0) {
		return { x: p.x, z: p.z };
	}
	const target = nearestMatch(actor, needles);
	const wantWater = wanderSeeksWater(needles);
	let best = samples[0];
	let bestScore = Infinity;
	for (const pt of samples) {
		let score = Math.random();
		if (target) {
			const t = target.transform.position;
			score += Math.hypot(pt.x - t.x, pt.z - t.z);
		}
		if (wantWater) {
			score += waterAdjacent(world, pt.x, pt.z) ? 0 : 12;
		}
		if (score < bestScore) {
			bestScore = score;
			best = pt;
		}
	}
	return best;
}

export function wanderUntilMet(ctx:HostCtx, posed:PosedFact[], expr:string):boolean {
	const text = expr.replace(/\s+/g, ' ').trim();
	if (!text) {
		return false;
	}
	try {
		const catalog = buildCatalog({
			...kernelsOf(ctx.world, ctx.actor, posed),
			cache: new SampleCache(),
		});
		const r = evaluate(text, catalog);
		if (r.error) {
			return false;
		}
		const v = r.value;
		if (v.kind === 'list') {
			return v.value.length > 0;
		}
		if (v.kind === 'entity') {
			return true;
		}
		return watchScore(v).score > DEFAULT_EPSILON;
	}
	catch {
		return false;
	}
}

export function namesAlongPath(actor:GameObject):string[] {
	const world = actor.world;
	if (!world) {
		return [];
	}
	const names:string[] = [];
	const seen = new Set<string>();
	const add = (label:string) => {
		const text = label.trim();
		if (!text || seen.has(text) || names.length >= SEEN_CAP) {
			return;
		}
		seen.add(text);
		names.push(text);
	};
	const p = actor.transform.position;
	for (const go of world.objects) {
		if (go === actor || go.id === 'MainCamera') {
			continue;
		}
		const gp = go.transform.position;
		if (Math.hypot(gp.x - p.x, gp.z - p.z) > SIGHT) {
			continue;
		}
		const named = go.getComponent(Named)?.id;
		if (named) {
			add(named);
		}
		else if (go.getComponent(Pickupable)) {
			const item = go.getComponent(Item);
			add(item ? pascalCase(item.defID) || item.defID : bodyName(go));
		}
		else {
			const tags = tagsOf(go);
			if (tags.includes('tree')) {
				add('Tree');
			}
			else if (tags.includes('waterfall')) {
				add('Waterfall');
			}
			else if (tags.includes('boulder')) {
				add('Boulder');
			}
		}
	}
	if (waterAdjacent(world, p.x, p.z) || world.tileAtWorld(p.x, p.z)?.def === 'water') {
		add('River');
	}
	return names;
}

export function formatWanderSeen(seen:Iterable<string>):string {
	const names = [...seen].slice(0, SEEN_CAP);
	if (names.length === 0) {
		return '';
	}
	return `saw ${names.join(', ')}`;
}
