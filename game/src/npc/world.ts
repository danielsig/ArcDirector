import type { HostWorld, Pose } from 'arc-director';
import { CharacterMotor } from '../actors/CharacterMotor';
import { NPCInput } from '../actors/NPCInput';
import { HumanBody, Interior } from '../engine/components';
import type { GameObject } from '../engine/GameObject';
import { yawToForward } from '../engine/math';
import { listCarried, itemMatchesName } from '../items/inventory';
import { findChestHolding, USE_RANGE } from '../items/pickup';
import { cellSteps } from '../world/path';
import type { GameHost } from './adapter';
import { thiefOf } from './kernels';
import { findBody } from './names';
import { doExamine } from './perception';
import { dropCarried, settleBuy, settleGive, settleSell, takeItem, useOn } from './items';

/** How close a body comes to act on something, and to count as there. */
const REACH = USE_RANGE * 0.55;

/** Ground position, facing, and right hand of `go`, on the XZ plane. */
function poseOf(go:GameObject):Pose {
	const p = go.transform.position;
	const f = yawToForward(go.transform.yaw);
	return { point: [p.x, p.z], facing: [f.x, f.z], right: [-f.z, f.x] };
}

/** Whoever carries an item named `name`. */
function holderOf(host:GameHost, name:string):GameObject | undefined {
	return host.world.objects.find((go) => !!go.getComponent(HumanBody) && listCarried(go).some((it) => itemMatchesName(it, name)));
}

/** The game world as ArcDirector's stock verbs and watch geometry see it. */
export function gameWorld(host:GameHost):HostWorld<GameObject> {
	return {
		find: (id) => findBody(host.world, id)
			?? findChestHolding(host.world, id)?.chest
			?? holderOf(host, id)
			?? thiefOf(host.world, id),
		getPose: poseOf,
		getPathGraph: (actor) => cellSteps(host.world, actor),
		getReach: (actor, target) => {
			const room = target.getComponent(Interior);
			return room ? Math.min(room.maxX - room.minX, room.maxZ - room.minZ) / 2 : REACH;
		},
		getDescription: (actor, target) => {
			const seen = doExamine(host.world, actor, target);
			return seen.ok ? seen.reason : undefined;
		},
		steerToward: (actor, point) => {
			const npc = actor.getComponent(NPCInput);
			if (npc) {
				npc.destinationPoint = point ? { x: point[0], z: point[1] } : null;
			}
			const p = actor.transform.position;
			const motor = actor.getComponent(CharacterMotor);
			return !!point && !!motor && Math.hypot(point[0] - p.x, point[1] - p.z) <= motor.arriveEpsilon;
		},
		moveItem: ({ actor, item, to }) => {
			if (to === undefined) {
				return dropCarried(actor, item);
			}
			return to === actor ? takeItem(host, actor, item) : settleGive(actor, to, item, host);
		},
		useItem: (actor, item, target) => useOn(host, actor, item, target),
		trade: ({ actor, side, other, item, quantity, price }) => (side === 'buy'
			? settleBuy(actor, other, item, price ?? NaN, host, quantity)
			: settleSell(actor, other, item, price ?? NaN, host, quantity)),
	};
}
