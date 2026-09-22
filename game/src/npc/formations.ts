import { type ArcResult, type VerbCall } from 'arc-director';
import { NPCInput } from '../actors/NPCInput';
import type { GameObject } from '../engine/GameObject';
import type { GameHost } from './adapter';
import { findBody } from './names';
import type { HostCtx } from './types';

function namedAt(host:GameHost, name:string):{ x:number; z:number } | undefined {
	if (!name) {
		return undefined;
	}
	const go = findBody(host.world, name);
	if (!go) {
		return undefined;
	}
	const p = go.transform.position;
	return { x: p.x, z: p.z };
}

function bodiesOf(host:GameHost, ids:string[]):GameObject[] {
	const out:GameObject[] = [];
	for (const id of ids) {
		const go = findBody(host.world, id);
		if (go) {
			out.push(go);
		}
	}
	return out;
}

function centroid(bodies:GameObject[]):{ x:number; z:number } | undefined {
	if (bodies.length === 0) {
		return undefined;
	}
	let x = 0;
	let z = 0;
	for (const go of bodies) {
		x += go.transform.position.x;
		z += go.transform.position.z;
	}
	return { x: x / bodies.length, z: z / bodies.length };
}

function walkTo(go:GameObject, x:number, z:number):void {
	go.getComponent(NPCInput)?.goToPoint(x, z);
}

export function runFormation(host:GameHost, call:VerbCall<HostCtx>):ArcResult {
	const bodies = bodiesOf(host, call.units ?? []);
	if (bodies.length === 0) {
		return { ok: false, verb: call.verb, reason: 'no units' };
	}
	const paces = typeof call.args.paces === 'number' && Number.isFinite(call.args.paces)
		? Math.max(0.5, call.args.paces)
		: 2;
	const around = typeof call.args.around === 'string' ? namedAt(host, call.args.around) : undefined;
	const at = typeof call.args.at === 'string' ? namedAt(host, call.args.at) : undefined;
	const facing = typeof call.args.facing === 'string' ? namedAt(host, call.args.facing) : undefined;
	const center = around ?? at ?? centroid(bodies);
	if (!center) {
		return { ok: false, verb: call.verb, reason: 'no place' };
	}
	if (call.verb === 'hold_line') {
		let px = 1;
		let pz = 0;
		if (facing) {
			const dx = facing.x - center.x;
			const dz = facing.z - center.z;
			const len = Math.hypot(dx, dz);
			if (len > 1e-4) {
				px = -dz / len;
				pz = dx / len;
			}
		}
		const mid = (bodies.length - 1) / 2;
		for (let i = 0; i < bodies.length; i++) {
			walkTo(bodies[i], center.x + px * (i - mid) * paces, center.z + pz * (i - mid) * paces);
		}
		return { ok: true, verb: call.verb };
	}
	const radius = call.verb === 'spread'
		? Math.max(paces, paces * Math.max(1, bodies.length) / (2 * Math.PI))
		: paces;
	for (let i = 0; i < bodies.length; i++) {
		const a = (i / bodies.length) * Math.PI * 2;
		walkTo(bodies[i], center.x + Math.cos(a) * radius, center.z + Math.sin(a) * radius);
	}
	return { ok: true, verb: call.verb };
}
