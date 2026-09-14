import {
	DEFAULT_EPSILON,
	SampleCache,
	buildCatalog,
	evaluate,
	pascalCase,
	watchScore,
	type ExprVal,
} from 'arc-director';
import { Named } from '../engine/components';
import type { GameObject } from '../engine/GameObject';
import { CELL_SIZE } from '../world/constants';
import { cellWalkable } from '../world/path';
import { kernelsOf, type PosedFact } from './kernels';
import { bodyName } from './names';
import { tagsOf } from './perception';
import type { HostCtx } from './types';
import { Item, Pickupable } from '../items/components';

const STEP = 8;
const SAMPLE_NEAR = 16;
const SAMPLE_FAR = 8;
const FAR = 24;
const SEEN_CAP = 12;
const SIGHT = 24;

function waterAdjacent(world:NonNullable<GameObject['world']>, x:number, z:number):boolean {
	const step = CELL_SIZE;
	for (const [dx, dz] of [[step, 0], [-step, 0], [0, step], [0, -step]]) {
		if (world.tileAtWorld(x + dx, z + dz)?.def === 'water') {
			return true;
		}
	}
	return false;
}

function sampleWalkable(actor:GameObject, count:number, minR:number, maxR:number):{ x:number; z:number }[] {
	const world = actor.world;
	if (!world) {
		return [];
	}
	const p = actor.transform.position;
	const span = Math.max(0, maxR - minR);
	const out:{ x:number; z:number }[] = [];
	for (let i = 0; i < count; i++) {
		const a = Math.random() * Math.PI * 2;
		const r = minR + Math.random() * span;
		const x = p.x + Math.cos(a) * r;
		const z = p.z + Math.sin(a) * r;
		if (cellWalkable(world, x, z)) {
			out.push({ x, z });
		}
	}
	return out;
}

function fitness(value:ExprVal):number {
	if (value.kind === 'list') {
		return value.value.length > 0 ? 1 : 0;
	}
	if (value.kind === 'entity') {
		return 1;
	}
	return watchScore(value).score;
}

function scoreAt(ctx:HostCtx, posed:PosedFact[], expr:string, at:{ x:number; z:number }):number {
	try {
		const catalog = buildCatalog({
			...kernelsOf(ctx.world, ctx.actor, posed, at),
			cache: new SampleCache(),
		});
		const r = evaluate(expr, catalog);
		if (r.error) {
			return 0;
		}
		return fitness(r.value);
	}
	catch {
		return 0;
	}
}

export function pickWanderPoint(ctx:HostCtx, posed:PosedFact[], expr:string):{ x:number; z:number } | null {
	const actor = ctx.actor;
	const world = actor.world;
	if (!world) {
		return null;
	}
	const text = expr.replace(/\s+/g, ' ').trim();
	const p = actor.transform.position;
	const samples = [
		...sampleWalkable(actor, SAMPLE_NEAR, 3, 3 + STEP),
		...sampleWalkable(actor, SAMPLE_FAR, 3 + STEP, FAR),
	];
	if (samples.length === 0) {
		return { x: p.x, z: p.z };
	}
	if (!text) {
		return samples[Math.floor(Math.random() * samples.length)] ?? { x: p.x, z: p.z };
	}
	let best = samples[0];
	let bestScore = -Infinity;
	for (const pt of samples) {
		const score = scoreAt(ctx, posed, text, pt) + Math.random() * 0.02;
		if (score > bestScore) {
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
	const p = ctx.actor.transform.position;
	return scoreAt(ctx, posed, text, { x: p.x, z: p.z }) > DEFAULT_EPSILON;
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
