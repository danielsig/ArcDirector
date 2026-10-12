import type { HostWorld, Pose } from 'arc-director';
import { CharacterMotor } from '../characters/CharacterMotor';
import { NPCInput } from '../characters/NPCInput';
import { HumanBody, Interior, MarketGate, MarketNPC } from '../engine/components';
import type { GameObject } from '../engine/GameObject';
import { yawToForward } from '../engine/math';
import { listCarried, itemMatchesName } from '../items/inventory';
import { findChestHolding, USE_RANGE } from '../items/pickup';
import { cellSteps } from '../world/path';
import type { GameHost } from './adapter';
import { thiefOf } from './kernels';
import { findObject, idOf } from './names';
import { doExamine, hostCanSee } from './perception';
import { dropCarried, settleExchange, settleGive, takeItem, useOn } from './items';

/** How close a character comes to act on something, and to count as there. */
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
		find: (id) => findObject(host.world, id)
			?? findChestHolding(host.world, id)?.chest
			?? holderOf(host, id)
			?? thiefOf(host.world, id),
		getPose: poseOf,
		getPathGraph: (character) => cellSteps(host.world, character),
		getReach: (character, target) => {
			const room = target.getComponent(Interior);
			if (room) {
				return Math.min(room.maxX - room.minX, room.maxZ - room.minZ) / 2;
			}
			// Shoppers have to step into the opening. Stopping short leaves them standing in the frame.
			if (target.getComponent(MarketGate) && character.getComponent(MarketNPC)?.kind === 'customer') {
				return 0.45;
			}
			return REACH;
		},
		getDescription: (character, target) => {
			const seen = doExamine(host.world, character, target);
			return seen.ok ? seen.reason : undefined;
		},
		hasLineOfSight: (from, to) => hostCanSee(host.world, idOf(from), idOf(to)),
		steerToward: (character, point) => {
			const npc = character.getComponent(NPCInput);
			if (npc) {
				npc.destinationPoint = point ? { x: point[0], z: point[1] } : null;
			}
			const p = character.transform.position;
			const motor = character.getComponent(CharacterMotor);
			return !!point && !!motor && Math.hypot(point[0] - p.x, point[1] - p.z) <= motor.arriveEpsilon;
		},
		moveItem: ({ character, item, to, quantity }) => {
			if (to === undefined) {
				return dropCarried(character, item);
			}
			return to === character ? takeItem(host, character, item) : settleGive(character, to, item, host, quantity);
		},
		useItem: (character, item, target) => useOn(host, character, item, target),
		exchange: ({ character, other, give, get }) => settleExchange(host, character, other, give, get),
	};
}
