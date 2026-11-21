import { Time, inBounds, type GameObject, type XZ } from '@arc-director/kindling';
import {
	dummyEntity,
	RESERVED_TAGS,
	type ExprEntity,
	type ExprVal,
	type NativeFn,
	type Stringifiers,
} from 'arc-director';
import { Celebrating, Named, SpeechBubble, Vitals, Wanted, alarmActive, idOf } from '../engine/components';
import { Interior } from '../kit/houses/interior';
import type { DemoWorld } from '../engine/demo-world';
import { NPCInput } from '../characters/NPCInput';
import { Pickupable } from '../items/item-components';
import { listCarried } from '../items/inventory';
import { itemID, type ItemInstance } from '../items/instance';
import { coinsOf } from '../items/wallet';
import { enclosureAt } from '../kit/houses/interior';
import { CLEAR_RANGE } from './talk-attend';
import { isLiving } from './names';
import { tagsOf } from './perception';
import type { GameHost } from './adapter';
import { Bridge } from '../kit/bridge/bridge';
import { Chest } from '../kit/chests/chest';
import { Door } from '../kit/door/door';

/** Id of the open theft `thief` is wanted for, as watches see it in `events`. */
export function theftID(thief:GameObject):string {
	return `Theft:${idOf(thief)}`;
}

/** The wanted thief a theft id names: the event is wherever the thief is, for as long as the mark is on. */
export function thiefOf(world:DemoWorld, id:string):GameObject | undefined {
	let thief:GameObject | undefined;
	world.forEachComponent(Wanted, (mark, go) => {
		if (mark.enabled && theftID(go) === id) {
			thief = go;
		}
	});
	return thief;
}

const NEAR_RADIUS = CLEAR_RANGE;

/** Numbers to a tenth, so a watch's answer reads `3.2`, not `3.2000000000000006`. */
export const EXPR_STRINGIFIERS:Stringifiers = {
	number: (v) => {
		if (v.kind !== 'number') {
			return '';
		}
		return Number.isInteger(v.value) ? String(v.value) : v.value.toFixed(1);
	},
	bool: (v) => (v.kind === 'bool' ? (v.value ? 'true' : 'false') : ''),
};

export function entityOf(go:GameObject, extraTags?:string[]):ExprEntity {
	const tags = tagsOf(go);
	if (extraTags) {
		for (const tag of extraTags) {
			if (tag && !tags.includes(tag)) {
				tags.push(tag);
			}
		}
	}
	return dummyEntity(idOf(go), { tags });
}

function itemEntity(item:ItemInstance):ExprEntity {
	const id = itemID(item);
	const tags = ['item'];
	if (item.Key) {
		tags.push('key');
	}
	if (/mushroom/i.test(item.name)) {
		tags.push('mushroom');
	}
	return dummyEntity(id, { tags });
}

const LANDMARK_KINDS = ['Tree', 'Waterfall', 'Boulder', 'Pillar'];

/** A landmark also carries its kind as a name-cased tag, so `landmarks.filter("Tree")` matches. */
function landmarkEntity(go:GameObject):ExprEntity {
	const e = entityOf(go);
	e.tags.push(...LANDMARK_KINDS.filter((kind) => e.tags.includes(kind.toLowerCase())));
	return e;
}

type Landmark = { go:GameObject; at:XZ };

/** Each world's landmarks, and where they stand, for the frame they were found in: every character's kernels ask. */
const frameLandmarks = new WeakMap<DemoWorld, { time:number; landmarks:Landmark[] }>();

/** What counts as a landmark in `world` this frame, and where it stands: no character, nothing to pick up. */
function landmarksOf(world:DemoWorld):Landmark[] {
	const known = frameLandmarks.get(world);
	if (known?.time === Time.time) {
		return known.landmarks;
	}
	const landmarks = world.objects
		.filter((go) => {
			const tags = tagsOf(go);
			return !tags.includes(RESERVED_TAGS.character) && !(tags.includes('item') && go.getComponent(Pickupable))
				&& ['tree', 'waterfall', 'boulder', 'pillar', 'building', 'room', 'bridge'].some((t) => tags.includes(t));
		})
		.map((go) => ({ go, at: { x: go.transform.position.x, z: go.transform.position.z } }));
	frameLandmarks.set(world, { time: Time.time, landmarks });
	return landmarks;
}

function nearbyLandmarks(world:DemoWorld, character:GameObject, here?:XZ):GameObject[] {
	// Read once: a transform works its world position out on every read.
	const at = character.transform.position;
	const p = here ?? { x: at.x, z: at.z };
	const ranked:{ go:GameObject; dist:number }[] = [];
	for (const landmark of landmarksOf(world)) {
		if (landmark.go === character) {
			continue;
		}
		const dist = Math.hypot(landmark.at.x - p.x, landmark.at.z - p.z);
		if (dist > 28) {
			continue;
		}
		ranked.push({ go: landmark.go, dist });
	}
	ranked.sort((a, b) => a.dist - b.dist);
	return ranked.slice(0, 16).map((r) => r.go);
}

/** The characters, items and places by the name a watch gives them, in world order (the last of a name wins). */
type Scan = { characters:GameObject[]; items:GameObject[]; places:Map<string, GameObject> };

/** Each world's scan for the frame it was made in: every character's kernels ask, every frame. */
const frameScans = new WeakMap<DemoWorld, { time:number; scan:Scan }>();

function scanOf(world:DemoWorld):Scan {
	const known = frameScans.get(world);
	if (known?.time === Time.time) {
		return known.scan;
	}
	const scan:Scan = { characters: [], items: [], places: new Map() };
	for (const go of world.objects) {
		const tags = tagsOf(go);
		const isCharacter = tags.includes(RESERVED_TAGS.character);
		if (isCharacter) {
			scan.characters.push(go);
		}
		const item = tags.includes(RESERVED_TAGS.item) && !isCharacter;
		if (item) {
			scan.items.push(go);
		}
		// Places a watch may name: openable things, and every named one (`BakerStall`, `WestGate`).
		if (['door', 'bridge', 'chest', 'building'].some((t) => tags.includes(t)) || (!item && !isCharacter && go.getComponent(Named))) {
			scan.places.set(idOf(go), go);
		}
	}
	frameScans.set(world, { time: Time.time, scan });
	return scan;
}

function lookupGo(world:DemoWorld, id:string):GameObject | undefined {
	return world.findNamed(id) ?? world.findByID(id);
}

/** World census for watches. ArcDirector adds geometry from `withWorld` and its own cache / hasHeard / prev. `here` poses `me` without moving the character. */
export function kernelsOf(
	world:DemoWorld,
	character:GameObject,
	here?:XZ,
	extraTags?:(go:GameObject)=>string[],
) {
	const hidePlayer = world.playerImperceptible && world.playerHits.size === 0;
	const me = entityOf(character);
	me.fields = { gold: { kind: 'number', value: coinsOf(character) } };
	const scan = scanOf(world);
	const others:ExprEntity[] = [];
	for (const go of scan.characters) {
		if (go !== character && !(hidePlayer && go.id === 'Player' && !alarmActive(go, Time.time)) && isLiving(go)) {
			others.push(entityOf(go, extraTags?.(go)));
		}
	}
	const items = scan.items.map((go) => entityOf(go));
	const bindings:Record<string, ExprVal> = {};
	// Places and landmarks only when a watch reads them: most never do, and a big world has hundreds.
	const lookup = (name:string):ExprVal | undefined => {
		if (name === 'landmarks') {
			return { kind: 'list', value: nearbyLandmarks(world, character, here).map((go) => ({ kind: 'entity' as const, value: landmarkEntity(go) })) };
		}
		const place = scan.places.get(name);
		return place && { kind: 'entity', value: entityOf(place) };
	};
	if (!hidePlayer) {
		const player = world.findByID('Player');
		if (player) {
			bindings.Player = { kind: 'entity', value: entityOf(player) };
		}
	}
	const events:ExprVal[] = [];
	world.forEachComponent(Wanted, (mark, go) => {
		if (mark.enabled) {
			events.push({ kind: 'entity', value: dummyEntity(theftID(go), { tags: ['theft', 'event'] }) });
		}
	});
	bindings.events = { kind: 'list', value: events };
	return {
		me,
		others,
		items,
		bindings,
		lookup,
		nearRadius: NEAR_RADIUS,
		inventory: (who:ExprEntity) => {
			const go = lookupGo(world, who.id);
			if (!go) {
				return [];
			}
			return listCarried(go).map(itemEntity);
		},
		hp: (who:ExprEntity) => {
			const go = lookupGo(world, who.id);
			const vitals = go?.getComponent(Vitals);
			if (!vitals) {
				return undefined;
			}
			return { hp: vitals.hp, maxHP: vitals.maxHP };
		},
		isOpen: (who:ExprEntity) => {
			const go = lookupGo(world, who.id);
			return (go?.getComponent(Door) ?? go?.getComponent(Bridge) ?? go?.getComponent(Chest))?.open;
		},
		isReady: (who:ExprEntity, verb:string) => lookupGo(world, who.id)?.getComponent(NPCInput)?.isReady(verb),
	};
}

/**
 * The game's own watch functions (`withFunctions`). `isInside(who?, building?)`: whether someone (`me` by default) is
 * inside that building, or any, measured where the catalog says they are (as if `me` stood where a verb asks).
 */
export function gameFunctions(host:GameHost):Record<string, NativeFn> {
	return {
		isInside: (args, { catalog }) => {
			const world = host.world;
			let who = catalog.me;
			let buildingID:string | undefined;
			const [a0, a1] = args;
			if (a0?.kind === 'entity') {
				if (lookupGo(world, a0.value.id)?.getComponent(Interior)) {
					buildingID = a0.value.id;
				}
				else {
					who = a0.value;
				}
			}
			if (a1?.kind === 'entity') {
				buildingID = a1.value.id;
			}
			else if (a1?.kind === 'string') {
				buildingID = a1.value;
			}
			else if (a0?.kind === 'string') {
				buildingID = a0.value;
			}
			const at = catalog.point?.(who);
			if (!at) {
				return { kind: 'bool', value: false };
			}
			const [x, z] = at;
			if (buildingID) {
				const box = lookupGo(world, buildingID)?.getComponent(Interior);
				return { kind: 'bool', value: !!box && inBounds(box.bounds, x, z) };
			}
			return { kind: 'bool', value: !!enclosureAt(world, x, z) };
		},
	};
}

export function scanWorld(host:GameHost):void {
	host.world.forEachComponent(Door, (door, go) => {
		const name = idOf(go);
		const was = host.doorOpen.get(name);
		if (was === undefined) {
			host.doorOpen.set(name, door.open);
			return;
		}
		if (door.open && !was) {
			host.arc?.pushEvent({
				kind: 'DoorOpened',
				text: `${name} opened`,
				tags: ['door', name],
				major: false,
			});
		}
		host.doorOpen.set(name, door.open);
	});
	host.world.forEachComponent(Chest, (chest, go) => {
		const name = idOf(go);
		const was = host.chestOpen.get(name);
		if (was === undefined) {
			host.chestOpen.set(name, chest.open);
			return;
		}
		if (chest.open && !was) {
			host.arc?.pushEvent({
				kind: 'ChestOpened',
				text: `${name} opened`,
				tags: ['chest', name],
				major: false,
				remember: true,
			});
		}
		host.chestOpen.set(name, chest.open);
	});
	host.world.forEachComponent(SpeechBubble, (bubble, go) => {
		if (go.getComponent(Celebrating)) {
			return;
		}
		if (bubble.text && Time.time >= bubble.until) {
			bubble.text = '';
		}
	});
}
