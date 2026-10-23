import { yawToForward, type GameObject } from '@arc-director/kindling';
import type { HostWorld, Pose } from 'arc-director';
import { CharacterMotor } from '../characters/CharacterMotor';
import { NPCInput } from '../characters/NPCInput';
import { Chest, HumanBody, Interior, Lock, MarketGate, MarketNPC } from '../engine/components';
import { listCarried, itemMatchesName } from '../items/inventory';
import { chestHolding, findChestHolding, USE_RANGE } from '../items/pickup';
import { cellWays } from '../world/path';
import { STALL_COUNTER } from '../render/meshRegistry';
import type { GameHost } from './adapter';
import { thiefOf } from './kernels';
import { findObject, idOf, isLiving } from './names';
import { canHearClearly } from './talkAttend';
import { doExamine } from './perception';
import { doTransfer, transferRefusal, useOn } from './items';

/** How close a character comes to act on something, and to count as there. */
const REACH = USE_RANGE * 0.55;

/** Ground position, facing, and right hand of `go`, on the XZ plane. */
function poseOf(go:GameObject):Pose {
	const p = go.transform.position;
	const f = yawToForward(go.transform.yaw);
	return { point: [p.x, p.z], facing: [f.x, f.z], right: [-f.z, f.x] };
}

/** A vendor at their stall serves across the counter: from their post to past its front, and a reach beyond. */
function counterReach(host:GameHost, go:GameObject):number | undefined {
	const npc = go.getComponent(MarketNPC);
	const stall = npc?.kind === 'vendor' && npc.post ? findObject(host.world, npc.post) : undefined;
	if (!npc || !stall) {
		return undefined;
	}
	const s = stall.transform.position;
	return Math.hypot(s.x - npc.postX, s.z - npc.postZ) + STALL_COUNTER.z + STALL_COUNTER.d / 2 + REACH;
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
		isDown: (id) => {
			const go = findObject(host.world, id);
			return !!go && !isLiving(go);
		},
		...cellWays(host.world),
		getReach: (character, target) => {
			const room = target.getComponent(Interior);
			if (room) {
				return Math.min(room.maxX - room.minX, room.maxZ - room.minZ) / 2;
			}
			// Shoppers have to step into the opening. Stopping short leaves them standing in the frame.
			if (target.getComponent(MarketGate) && character.getComponent(MarketNPC)?.kind === 'customer') {
				return 0.45;
			}
			return counterReach(host, target) ?? counterReach(host, character) ?? REACH;
		},
		// A deal is spoken: struck in earshot, whoever stands between, not only with the other in the sight list.
		canOffer: (from, to) => canHearClearly(host.world, idOf(from), idOf(to)),
		getDescription: (character, target) => {
			const seen = doExamine(host.world, character, target);
			return seen.ok ? seen.reason : undefined;
		},
		steerToward: (character, point) => {
			const npc = character.getComponent(NPCInput);
			if (npc) {
				npc.destinationPoint = point ? { x: point[0], z: point[1] } : null;
			}
			const p = character.transform.position;
			const motor = character.getComponent(CharacterMotor);
			return !!point && !!motor && Math.hypot(point[0] - p.x, point[1] - p.z) <= motor.arriveEpsilon;
		},
		// What is in a shut chest is out of sight, but whoever comes to an unlocked one lifts the lid and takes it.
		canPickUp: (_, item, from) => (from.getComponent(Chest) ? !!chestHolding(from, item) && !from.getComponent(Lock)?.locked : undefined),
		useItem: (character, item, target) => useOn(host, character, item, target),
		validateTransfer: (move, deal) => transferRefusal(move, deal),
		transfer: (move) => doTransfer(host, move),
	};
}
