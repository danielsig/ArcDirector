import { pascalCase, type PathStep } from 'arc-director';
import { Bridge, Door, HumanBody, Lock, Named } from '../engine/components';
import type { GameObject } from '../engine/GameObject';
import type { World } from '../engine/World';
import { CELL_PROPS } from './Chunk';
import { CELL_SIZE } from './constants';
import { findCarried } from '../items/inventory';

/** Step cost onto a cell another body occupies. Empty floor is 1. */
const OCCUPANT_COST = 8;

/** The eight steps to the cells around one, clockwise from east. */
const NEIGHBOURS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

function closedDoorIn(world:World, tx:number, tz:number):GameObject | undefined {
	return world.objectsInTile(tx, tz).find((go) => go.getComponent(Door)?.open === false);
}

/** A raised bridge spanning the cell at `x`, `z`: water now, a way across once lowered. */
function raisedBridgeAt(world:World, x:number, z:number):GameObject | undefined {
	let found:GameObject | undefined;
	world.forEachComponent(Bridge, (span, go) => {
		if (!span.open && span.cells.some((c) => Math.abs(c.x - x) < 0.55 && Math.abs(c.z - z) < 0.55)) {
			found = go as GameObject;
		}
	});
	return found;
}

function characterIn(world:World, tx:number, tz:number, except?:GameObject):GameObject | undefined {
	return world.objectsInTile(tx, tz).find((go) => go !== except && go.getComponent(HumanBody)?.enabled);
}

/** Walls, deep water, cell-filling props, and closed doors stop steps. */
function blocked(world:World, tx:number, tz:number):boolean {
	const { x, z } = world.tileCenter(tx, tz);
	return world.sampleTerrain(x, z)?.blocked !== false
		|| CELL_PROPS.has(world.chunkAtWorld(x, z)!.propAtWorld(x, z) ?? '')
		|| !!closedDoorIn(world, tx, tz);
}

/** What stops sight and sound: anything that stops steps but water, which one sees and hears across. */
function opaque(world:World, tx:number, tz:number):boolean {
	const { x, z } = world.tileCenter(tx, tz);
	return blocked(world, tx, tz) && world.chunkAtWorld(x, z)?.tileAtWorld(x, z)?.def !== 'water';
}

/** Why a closed door stops `body`. A locked door says whether `body` carries its key. */
function doorReason(door:GameObject, body:GameObject):string {
	const name = door.getComponent(Named)?.id ?? door.id;
	const lock = door.getComponent(Lock);
	if (!lock?.locked) {
		return `${name} is closed — open it first`;
	}
	const key = findCarried(body, (it) => it.Key?.keyID === lock.keyID);
	if (key) {
		return `${name} is locked — you carry ${pascalCase(key.name) || pascalCase(key.defID)}, use it on ${name}`;
	}
	return lock.keyID ? `${name} is locked — needs the ${lock.keyID} key` : `${name} is locked`;
}

/**
 * The open neighbours of the cell holding a point, for one route search by `body`. Walls, water, and props
 * are not steps, and no diagonal squeezes past a blocked corner; a closed door or a raised bridge is a
 * blocked step that tells `body` why; a cell another body stands on costs more, so routes go around people when they can.
 */
export function cellSteps(world:World, body:GameObject):(point:number[])=>PathStep[] {
	return (from) => {
		const { tx, tz } = world.tileCoordAt(from[0], from[1]);
		const open = (dx:number, dz:number) => !blocked(world, tx + dx, tz + dz);
		return NEIGHBOURS.flatMap(([dx, dz]):PathStep[] => {
			const { x, z } = world.tileCenter(tx + dx, tz + dz);
			const door = closedDoorIn(world, tx + dx, tz + dz);
			if (dx && dz && !(open(dx, 0) && open(0, dz))) {
				return [];
			}
			if (door) {
				return [{ point: [x, z], blocked: doorReason(door, body) }];
			}
			const bridge = raisedBridgeAt(world, x, z);
			if (bridge) {
				const name = bridge.getComponent(Named)?.id ?? bridge.id;
				return [{ point: [x, z], blocked: `${name} is raised — it must be lowered first` }];
			}
			const crowded = characterIn(world, tx + dx, tz + dz, body) ? OCCUPANT_COST : 1;
			return open(dx, dz) ? [{ point: [x, z], cost: Math.hypot(dx, dz) * CELL_SIZE * crowded }] : [];
		});
	};
}

/** Grid DDA. Start and end cells are open so occupants do not occlude themselves. */
export function lineClear(
	world:World,
	x0:number,
	z0:number,
	x1:number,
	z1:number,
	ignoreCharacters = false,
):boolean {
	const solid = (tx:number, tz:number) => opaque(world, tx, tz) || (!ignoreCharacters && !!characterIn(world, tx, tz));
	const a = world.tileCoordAt(x0, z0);
	const b = world.tileCoordAt(x1, z1);
	if (a.tx === b.tx && a.tz === b.tz) {
		return true;
	}
	const dx = x1 - x0;
	const dz = z1 - z0;
	const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
	const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;
	const tDeltaX = stepX === 0 ? Infinity : Math.abs(CELL_SIZE / dx);
	const tDeltaZ = stepZ === 0 ? Infinity : Math.abs(CELL_SIZE / dz);
	let tMaxX = stepX === 0
		? Infinity
		: ((stepX > 0 ? a.tx + 1 : a.tx) * CELL_SIZE - x0) / dx;
	let tMaxZ = stepZ === 0
		? Infinity
		: ((stepZ > 0 ? a.tz + 1 : a.tz) * CELL_SIZE - z0) / dz;
	let tx = a.tx;
	let tz = a.tz;
	while (tx !== b.tx || tz !== b.tz) {
		if (tMaxX < tMaxZ) {
			tx += stepX;
			tMaxX += tDeltaX;
		}
		else if (tMaxZ < tMaxX) {
			tz += stepZ;
			tMaxZ += tDeltaZ;
		}
		else {
			if (
				solid(tx + stepX, tz)
				|| solid(tx, tz + stepZ)
			) {
				return false;
			}
			tx += stepX;
			tz += stepZ;
			tMaxX += tDeltaX;
			tMaxZ += tDeltaZ;
		}
		if ((tx !== b.tx || tz !== b.tz) && solid(tx, tz)) {
			return false;
		}
	}
	return true;
}
