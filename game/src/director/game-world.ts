import { yawToForward, type GameObject } from '@arc-director/kindling';
import { Axes, type HostWorld, type Pose } from 'arc-director';
import { CharacterMotor } from '../characters/CharacterMotor';
import { Reading } from '../characters/Reading';
import { Seated } from '../characters/Seated';
import { NPCInput } from '../characters/NPCInput';
import { BoxCollider, Chest, HumanBody, Interior, Lock, MarketNPC } from '../engine/components';
import { ITEM_DEFS } from '../items/defs';
import { listCarried, itemMatchesName } from '../items/inventory';
import type { ItemInstance } from '../items/instance';
import { chestHolding, findChestHolding, openDoorAhead, USE_RANGE } from '../items/pickup';
import { cellWays, type Cell } from '../world/path';
import type { GameHost } from './adapter';
import { thiefOf } from './kernels';
import { findObject, idOf, isLiving } from './names';
import { markThief } from './game-verbs';
import { doExamine } from './perception';
import { doTransfer, transferRefusal, useOn } from './items';
import { attackFor, attackVerbFor, fightRole } from './fight';

/** How close a character comes to act on something, and to count as there. */
const REACH = USE_RANGE * 0.55;

/**
 * Ground position and facing of `go`, on the XZ plane, and how far its edge is from there ({@link sizeOf}). A vendor
 * faces out across their counter, to its customer side, wherever they turn to talk: where their buyers line up.
 */
function poseOf(host:GameHost, go:GameObject):Pose {
	const p = go.transform.position;
	const stall = stallOf(host, go);
	const f = yawToForward(stall ? stall.transform.yaw + Math.PI : go.transform.yaw);
	const size = sizeOf(go, stall);
	return { point: [p.x, p.z], facing: [f.x, f.z], ...size ? { size } : {} };
}

/** The stall or counter a vendor serves from. */
function stallOf(host:GameHost, go:GameObject):GameObject | undefined {
	const npc = go.getComponent(MarketNPC);
	return npc?.kind === 'vendor' && npc.post ? findObject(host.world, npc.post) : undefined;
}

/**
 * How far `go`'s edge is from its middle, where it is big: a house, at its nearest wall (so its middle is in reach of
 * anyone indoors); a vendor at their `stall`, out to its counter's front (served across it).
 */
function sizeOf(go:GameObject, stall:GameObject | undefined):number | undefined {
	const room = go.getComponent(Interior);
	if (room) {
		return Math.min(room.bounds.maxX - room.bounds.minX, room.bounds.maxZ - room.bounds.minZ) / 2;
	}
	const counter = stall?.children.find((child) => child.getComponent(BoxCollider));
	const [s, p] = [stall?.transform.position, go.transform.position];
	return s && counter && Math.hypot(s.x - p.x, s.z - p.z) + counter.transform.localPosition.z + counter.getComponent(BoxCollider)!.size.z / 2;
}

/** Whoever carries an item named `name`. */
function holderOf(host:GameHost, name:string):GameObject | undefined {
	return host.world.objects.find((go) => !!go.getComponent(HumanBody) && listCarried(go).some((it) => itemMatchesName(it, name)));
}

/** The game world as ArcDirector's stock verbs and watch geometry see it. */
export function gameWorld(host:GameHost):HostWorld<GameObject, Cell> {
	const { getClarity, ...ways } = cellWays(host.world);
	return {
		find: (id) => findObject(host.world, id)
			?? findChestHolding(host.world, id)?.chest
			?? holderOf(host, id)
			?? thiefOf(host.world, id),
		getDescription: (character, target) => {
			const seen = doExamine(host.world, character, target);
			return seen.status === 'ok' ? seen.reason : undefined;
		},
		hasFallen: (id) => {
			const go = findObject(host.world, id);
			return !!go && !isLiving(go);
		},
		isItem: (name) => Object.values(ITEM_DEFS).some((def) => itemMatchesName({ id: def.id, name: def.name, defID: def.id } as ItemInstance, name)) || !!holderOf(host, name),
		useItem: (character, item, target) => useOn(host, character, item, target),
		geometry: {
			// Kindling's ground, as [x, z]: north −Z, east +X.
			axes: Axes.Plane,
			getPose: (go) => poseOf(host, go),
			getClarity,
			getReach: (character, using) => {
				// A fighter, empty-handed, reaches as far as its role's attack: who its roster marks in reach.
				const role = using === undefined ? fightRole(host, character) : undefined;
				if (role) {
					return attackFor(attackVerbFor(role), role).range;
				}
				// Shoppers walk right into where they go, a gate's opening too: stopping short leaves them standing in the frame.
				return using === 'go_to' && character.getComponent(MarketNPC)?.kind === 'customer' ? 0.45 : REACH;
			},
		},
		routes: {
			...ways,
			steerToward: (character, point) => {
				const npc = character.getComponent(NPCInput);
				if (npc) {
					npc.destinationPoint = point ? { x: point[0], z: point[1] } : null;
				}
				if (point) {
					// Whoever sets off gets up first, and opens what it walks up to.
					character.getComponent(Seated)?.stand();
					character.getComponent(Reading)?.stop();
					openDoorAhead(character, { x: point[0], z: point[1] });
				}
				const p = character.transform.position;
				const motor = character.getComponent(CharacterMotor);
				return !!point && !!motor && Math.hypot(point[0] - p.x, point[1] - p.z) <= motor.arriveEpsilon;
			},
		},
		transfers: {
			// What is in a shut chest is out of sight, but whoever comes to an unlocked one lifts the lid and takes it.
			canPickUp: (character, item, from) => (from.getComponent(Chest) ? !!chestHolding(from, item) && !from.getComponent(Lock)?.locked : undefined),
			canSeeInventoryOf: (viewer, holder) => host.hooks.canSeeInventoryOf?.(host, viewer, holder),
			validateTransfer: (move, deal) => transferRefusal(move, deal),
			transfer: (move) => {
				const undo = doTransfer(host, move);
				if (move.verb === 'steal') {
					// A thief is wanted from then on; ArcDirector tells every mind of the theft.
					markThief(host, move.to!, move.thing, idOf(move.from), 'stole without paying');
				}
				return undo;
			},
		},
	};
}
