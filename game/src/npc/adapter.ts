import {
	Agent,
	HttpProvider,
	VerbRegistry,
	builtinLodLayers,
	builtinStringifiers,
	basicPluralize,
	defaultLandmarkTier,
	describeScene,
	isRecord,
	pascalCase,
	registerCoreVerbs,
	withQueue,
	formatPlan,
	fetchModelCatalog,
	pickSingleChatModel,
	PREFERRED_MODELS,
	isEmbeddingModel,
	isLoadedModel,
	isVisionModel,
	TalkNet,
	ThinkQueue,
	buildCatalog,
	dummyEntity,
	SampleCache,
	runPlan,
	waitForOf,
	roleMentionTitles,
	stampMap,
	type ActionPlan,
	type ActionResult,
	type AgentDeps,
	type AgentEvent,
	type AgentIdentity,
	type AgentJSON,
	type Catalog,
	type ChatMessage,
	type ExprEntity,
	type ExprVal,
	type Goal,
	type InferenceProvider,
	type ModelInfo,
	type PerceptionObject,
	type PerceptionRecipe,
	type SpeechUtterance,
	type Step,
	type StringifierKind,
	type Stringifiers,
	type MapSnapshot,
	type ThinkRow,
	type Watches,
} from 'arc-director';
import { NPCInput } from '../actors/NPCInput';
import {
	BODY_SLOTS,
	BrewHearth,
	Celebrating,
	Chest,
	Door,
	HumanBody,
	HumanSprite,
	Lock,
	Named,
	Sickbed,
	SpeechBubble,
	Torch,
	Bridge,
	type BodySlot,
	Wallet,
	Merchant,
	Crowd,
	CrowdExit,
	Companion,
	Wanted,
	Vitals,
	Interior,
} from '../engine/components';
import type { GameObject } from '../engine/GameObject';
import { worldToChunk, type World } from '../engine/World';
import { Container, Harvest, Item, Pickupable } from '../items/components';
import {
	distXZ,
	findCarried,
	isOccupied,
	itemMatchesName,
	listCarried,
	removeFromBags,
	slotItem,
	tryInsert,
	compactName,
	actorIs,
} from '../items/inventory';
import { cloneItem, type ItemInstance } from '../items/instance';
import { coinsOf, findSaleItem, goodsAsk, noteWant, priceFor, transferCoins } from '../items/wallet';
import { customerCount, MARKET_SEEDS, spawnRandomCustomer } from './market';
import type { HudAiLogEntry, HudChatLine, HudModel, HudModelOption } from '../ui/hudModel';
import { parseSlash, SLASH_HELP, type ParsedSlash, type SayCatalog } from '../ui/sayCommands';
import { loadModelPref, saveModelPref } from '../engine/modelPref';
import { clampParallelThinkers, loadThinkPref, saveThinkPref } from '../engine/thinkPref';
import { publishAiLog, resetAiLogSink, sinkAiLog } from './aiLogSink';
import { dropItem, findChestHolding, pickup, takeFromChest, USE_RANGE } from '../items/pickup';
import { captureItem } from '../world/spawnItem';
import { rewriteRetiredFeeNames } from '../engine/gameSave';
import { equipItem, unequipSlot } from '../items/equip';
import { useItem } from '../items/use';
import { talkCanSee, talkFace, canHearClearly, SPEECH_LIFE, CLEAR_RANGE } from './talkAttend';
import { yawToForward } from '../engine/math';
import { whereabouts, enclosureAt, interiorContains } from '../world/interior';
import { YOU_SYMBOL } from './mapMarks';
import { snapshotMap } from './mapView';

const SIGHT = 24;
/** Who the player can address, and clear-with-LOS cutoff. */
const TALK_RANGE = CLEAR_RANGE;
/** Muffled earshot beyond TALK_RANGE. Farther than this, silence. */
const HEAR_RANGE = 16;
const CHAT_CAP = 80;
/** Extra think turns after a bad ActionPlan or a tool call with tools closed. */
const PLAN_RETRY_CAP = 3;
const AI_LOG_CAP = 250;
const CELEBRATE_LIFE = 48;
const EVENT_CAP = 12;
const INFERENCE_ROOT = '/inference';
const INFERENCE_BASE = '/inference/v1';
const MAGIC_POTION = 'MagicPotion';
/** Who wins a tie after watch max. Glen Servant is 1; everyone else starts at 0.5. */
const DEFAULT_RANK = 0.5;
const NEAR_RADIUS = CLEAR_RANGE;
const HEARD_WINDOW = 8;
const STALL_VERBS = new Set(['wait', 'wander', 'say', 'set_status']);
const PROGRESS_VERBS = new Set([
	'pick_up', 'give', 'use', 'buy', 'sell', 'steal', 'drop', 'equip', 'unequip', 'rest',
]);

function stepKey(plan:ActionPlan | null | undefined, result:ActionResult):string {
	const verb = result.verb ?? plan?.head.verb ?? '';
	const args = plan?.head.args ?? {};
	const name = typeof args.name === 'string'
		? args.name
		: typeof args.item === 'string'
			? args.item
			: typeof args.to === 'string'
				? args.to
				: result.reason ?? '';
	return `${verb}:${name}`;
}

function eventIsUrgent(event:AgentEvent):boolean {
	if (/^(Theft|HeardSpeech|Hurt)$/i.test(event.kind)) {
		return true;
	}
	return (event.tags ?? []).some((t) => /^(steal|theft|hurt|speech|threat)$/i.test(t));
}

function bodyName(go:GameObject):string {
	return go.getComponent(Named)?.id ?? go.id;
}

function findBody(world:World, name:string):GameObject | undefined {
	return world.findNamed(name) ?? world.findByID(name);
}

function sayToLabel(to?:string | string[]):string | undefined {
	if (to == null) {
		return undefined;
	}
	return Array.isArray(to) ? to.join(', ') : to;
}

function orderStations(text:string):boolean {
	return /\b(stay|remain|wait here|wait there|inside|in the house|in the cottage|go back|don'?t come|do not come|stop following|don'?t follow|do not follow|no longer follow)\b/i.test(text);
}

function orderFollows(text:string):boolean {
	if (orderStations(text)) {
		return false;
	}
	return /\b(follow|come here|come with|with me|heel|join me)\b/i.test(text);
}

/**
 * Host range check for TalkNet — the library never sees these numbers.
 * Observer hides the player from NPC perception lists, not from distance:
 * the player can speak, and an NPC who addresses them by name can answer.
 */
export function inTalkRange(world:World, speakerID:string, listenerID:string):boolean {
	const speaker = findBody(world, speakerID);
	const listener = findBody(world, listenerID);
	if (!speaker || !listener || speaker === listener) {
		return false;
	}
	return distXZ(speaker, listener) <= HEAR_RANGE;
}

/** Everyone in earshot, nearest first. */
export function nearbyTalkPeers(world:World, speakerID:string):string[] {
	const speaker = findBody(world, speakerID);
	if (!speaker) {
		return [];
	}
	const hits:{ name:string; d:number }[] = [];
	for (const go of world.objects) {
		if (go === speaker || !go.getComponent(HumanBody)) {
			continue;
		}
		const d = distXZ(speaker, go);
		if (d <= TALK_RANGE) {
			hits.push({ name: bodyName(go), d });
		}
	}
	hits.sort((a, b) => a.d - b.d);
	return hits.map((h) => h.name);
}

export function nearestTalkPeer(world:World, speakerID:string):string | undefined {
	return nearbyTalkPeers(world, speakerID)[0];
}

function carriedLabels(actor:GameObject):string[] {
	const seen = new Set<string>();
	const out:string[] = [];
	for (const it of listCarried(actor)) {
		const label = pascalCase(it.name) || it.name;
		const key = compactName(label);
		if (!key || seen.has(key)) {
			continue;
		}
		seen.add(key);
		out.push(label);
	}
	return out;
}

function findKeyFor(world:World, keyID:string):{ name:string; holder:string } | null {
	for (const go of world.objects) {
		if (go.getComponent(HumanBody)) {
			const it = findCarried(go, (item) => item.Key?.keyID === keyID);
			if (it) {
				return { name: pascalCase(it.name) || it.name, holder: bodyName(go) };
			}
		}
		if (!go.getComponent(Pickupable) || !go.getComponent(Item)) {
			continue;
		}
		const inst = captureItem(go);
		if (inst.Key?.keyID === keyID) {
			return { name: go.getComponent(Named)?.id || pascalCase(inst.name) || inst.name, holder: '' };
		}
	}
	return null;
}

export function playerSayCatalog(world:World):SayCatalog {
	const player = world.findByID('Player');
	const peers = nearbyTalkPeers(world, 'Player');
	const items = player ? carriedLabels(player) : [];
	const gold = player ? coinsOf(player) : 0;
	const goods:{ item:string; from:string }[] = [];
	const seen = new Set<string>();
	for (const name of peers) {
		const go = findBody(world, name);
		if (!go) {
			continue;
		}
		for (const it of listCarried(go)) {
			if (goodsAsk(it) === undefined) {
				continue;
			}
			const label = pascalCase(it.name) || it.name;
			const key = `${compactName(label)}:${compactName(name)}`;
			if (seen.has(key)) {
				continue;
			}
			seen.add(key);
			goods.push({ item: label, from: name });
		}
	}
	return { peers, items, gold, goods };
}

/** `@Rook hello` addresses one person in a crowd; the rest of the line is spoken. */
function parseDirectedLine(spoken:string):{ to:string; text:string } | undefined {
	const m = spoken.match(/^@(\S+)\s+([\s\S]+)$/);
	if (!m) {
		return undefined;
	}
	const text = m[2].trim();
	if (!text) {
		return undefined;
	}
	return { to: m[1], text };
}

function viewerSees(viewer:GameObject, go:GameObject):boolean {
	const world = viewer.world;
	if (!world) {
		return false;
	}
	if (world.npcCanSee(go)) {
		return true;
	}
	const bond = viewer.getComponent(Companion);
	return !!bond && (go.id === bond.targetID || go.getComponent(Named)?.id === bond.targetID);
}

export function talkOthers(world:World, speakerID:string):string[] {
	const speaker = findBody(world, speakerID);
	const names:string[] = [];
	for (const go of world.objects) {
		if (!go.getComponent(HumanBody)) {
			continue;
		}
		if (speaker) {
			if (!viewerSees(speaker, go)) {
				continue;
			}
		}
		else if (!world.npcCanSee(go)) {
			continue;
		}
		const id = bodyName(go);
		if (id && id !== speakerID) {
			names.push(id);
		}
	}
	return names;
}

export type HostCtx = {
	world:World;
	actor:GameObject;
	director:NPCDirector;
};

function argString(step:Step, key:string):string {
	const v = step.args[key];
	return typeof v === 'string' ? v : '';
}

function argNumber(step:Step, key:string, fallback:number):number {
	const v = step.args[key];
	return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function itemLabel(item:ItemInstance):string {
	const id = pascalCase(item.name) || pascalCase(item.defID);
	return item.count > 1 ? `${id} x${item.count}` : id;
}

function matchesItem(item:ItemInstance, name:string):boolean {
	return itemMatchesName(item, name);
}

function findItem(actor:GameObject, name:string):ItemInstance | null {
	return findCarried(actor, (it) => matchesItem(it, name));
}

function asSlot(raw:string):BodySlot | undefined {
	return (BODY_SLOTS as readonly string[]).includes(raw) ? raw as BodySlot : undefined;
}

function tagsOf(go:GameObject):string[] {
	const tags:string[] = [];
	if (go.getComponent(Interior)) {
		tags.push('building', 'landmark');
	}
	if (go.getComponent(Door)) {
		tags.push('door', 'landmark');
	}
	if (go.getComponent(Bridge)) {
		tags.push('bridge', 'landmark');
	}
	if (go.getComponent(Chest)) {
		tags.push('chest', 'furniture');
	}
	if (go.getComponent(BrewHearth) || go.getComponent(Sickbed)) {
		tags.push('furniture', 'landmark');
	}
	if (go.getComponent(Pickupable) || go.getComponent(Item)) {
		tags.push('item');
	}
	if (go.id === 'Player' || go.name === 'NPC') {
		tags.push('agent', 'person');
	}
	if (go.getComponent(Torch) && !go.getComponent(Item)) {
		tags.push('torch');
	}
	return tags;
}

type PosedFact = {
	id:string;
	tags:string[];
	x:number;
	z:number;
	until?:number;
};

function entityOf(go:GameObject):ExprEntity {
	return dummyEntity(bodyName(go), {
		name: go.getComponent(Named)?.id ?? go.id,
		tags: tagsOf(go),
	});
}

function itemEntity(item:ItemInstance):ExprEntity {
	const id = pascalCase(item.name) || item.name;
	const tags = ['item'];
	if (item.Key) {
		tags.push('key');
	}
	return dummyEntity(item.id || id, { name: id, tags });
}

function facingToward(from:GameObject, x:number, z:number):number {
	const f = yawToForward(from.transform.yaw);
	const dx = x - from.transform.position.x;
	const dz = z - from.transform.position.z;
	const len = Math.hypot(dx, dz);
	if (len < 1e-6) {
		return 1;
	}
	return Math.max(-1, Math.min(1, (f.x * dx + f.z * dz) / len));
}

const EXPR_STRINGIFIERS:Stringifiers = {
	person: (v) => (v.kind === 'entity' ? (v.value.name ?? v.value.id) : ''),
	item: (v) => (v.kind === 'entity' ? (v.value.name ?? v.value.id) : ''),
	number: (v) => {
		if (v.kind !== 'number') {
			return '';
		}
		return Number.isInteger(v.value) ? String(v.value) : v.value.toFixed(1);
	},
	bool: (v) => (v.kind === 'bool' ? (v.value ? 'true' : 'false') : ''),
};

function exprKind(entity:{ tags:string[] }):StringifierKind {
	if (entity.tags.includes('agent') || entity.tags.includes('person')) {
		return 'person';
	}
	if (entity.tags.includes('item')) {
		return 'item';
	}
	return 'entity';
}

function nounOf(go:GameObject):string {
	if (go.id === 'CottageDoor') {
		return 'cottage door';
	}
	if (go.getComponent(Door)) {
		return 'iron gate';
	}
	if (go.getComponent(Chest)) {
		return 'wooden chest';
	}
	if (go.id === 'Player') {
		return 'traveler';
	}
	if (go.id === 'Alchemist') {
		return 'threadbare alchemist';
	}
	if (go.id === 'Herbalist') {
		return 'forager in travel clothes';
	}
	if (go.id === 'Captain') {
		return 'pay-captain of the abbey watch';
	}
	if (go.id === 'Forager') {
		return 'glen forager with stained hands';
	}
	if (go.id === 'Miller') {
		return 'dusty miller of the cottage';
	}
	if (go.id === 'Angler') {
		return 'stranded angler with a wet pack';
	}
	if (go.id === 'Servant') {
		return 'sorceress in the traveler\'s service';
	}
	if (go.id === 'Baker') {
		return 'baker at a loaf stall';
	}
	if (go.id === 'Weaver') {
		return 'weaver selling scarves';
	}
	if (go.id === 'Potter') {
		return 'potter with clay bowls';
	}
	if (go.id === 'Cutler') {
		return 'cutler selling knives';
	}
	if (go.id === 'Holt' || go.id === 'Pike' || go.id === 'Brant' || go.id === 'Cass') {
		return 'market watch';
	}
	if (go.getComponent(Crowd)?.kind === 'guard') {
		return 'market watch';
	}
	if (go.getComponent(Crowd)?.kind === 'customer') {
		return 'market visitor';
	}
	if (go.getComponent(Merchant)) {
		return 'stall keeper';
	}
	if (go.id === 'WestGate' || go.id === 'EastGate') {
		return 'street gate';
	}
	if (go.name === 'Stall') {
		return 'market stall';
	}
	if (go.id === 'Cottage') {
		return 'thatched mill cottage';
	}
	if (go.id === 'CottageKey') {
		return 'brass key to the cottage';
	}
	if (go.id === 'MillBridge') {
		return 'wooden mill bridge';
	}
	if (go.id === 'MillLever') {
		return 'sluice lever';
	}
	if (go.id === 'BrewHearth') {
		return 'stone brew hearth';
	}
	if (go.id === 'NollCot') {
		return 'Noll\'s sick cot';
	}
	if (go.id === 'LinaCot') {
		return 'Lina\'s sick cot';
	}
	if (go.id === 'Falls') {
		return 'waterfall';
	}
	if (go.getComponent(Item) || go.getComponent(Pickupable)) {
		return go.getComponent(Named)?.id || go.name;
	}
	if (go.getComponent(Torch)) {
		return 'torch';
	}
	return go.getComponent(Named)?.id ?? go.name;
}

function hostPluralize(word:string):string {
	if (word === 'person') {
		return 'people';
	}
	return basicPluralize(word);
}

function toPerception(go:GameObject):PerceptionObject {
	const named = go.getComponent(Named);
	const id = named?.id || go.id;
	const tags = tagsOf(go);
	const movable = !go.getComponent(Door) && !go.getComponent(Chest) && !!go.getComponent(Pickupable);
	const interactable = !!go.getComponent(Door)
		|| !!go.getComponent(Chest)
		|| !!go.getComponent(Pickupable)
		|| !!go.getComponent(BrewHearth)
		|| !!go.getComponent(Sickbed)
		|| go.id === 'MillLever'
		|| go.id === 'MillBridge'
		|| !!go.getComponent(Crowd)
		|| !!go.getComponent(Merchant)
		|| !!go.getComponent(Interior);
	return {
		id,
		tags,
		interesting: interactable || tags.includes('agent'),
		interactable,
		movable,
		landmarkTier: defaultLandmarkTier({ tags, movable }),
		describe: () => nounOf(go),
	};
}

function gatherScene(actor:GameObject, ambient:string):string {
	const world = actor.world;
	if (!world) {
		return '';
	}
	const objects:PerceptionObject[] = [];
	const poses = new Map<string, { x:number; z:number }>();
	const selfID = actor.getComponent(Named)?.id ?? actor.id;
	const p = actor.transform.position;
	poses.set(selfID, { x: p.x, z: p.z });
	for (const go of world.objects) {
		if (go === actor || go.id === 'MainCamera') {
			continue;
		}
		if (!viewerSees(actor, go)) {
			continue;
		}
		const named = go.getComponent(Named);
		const torch = go.getComponent(Torch) && !go.getComponent(Item);
		if (!named && !torch) {
			continue;
		}
		const row = toPerception(go);
		poses.set(row.id, { x: go.transform.position.x, z: go.transform.position.z });
		objects.push(row);
		const chest = go.getComponent(Chest);
		const bag = go.getComponent(Container);
		const lock = go.getComponent(Lock);
		if (chest?.open && bag && !lock?.locked) {
			for (const it of bag.contents) {
				const id = pascalCase(it.name) || pascalCase(it.defID) || it.id;
				poses.set(id, { x: go.transform.position.x, z: go.transform.position.z });
				objects.push({
					id,
					tags: ['item'],
					interesting: true,
					interactable: true,
					movable: true,
					landmarkTier: 0,
					describe: () => `${id} in ${named?.id ?? go.id}`,
				});
			}
		}
	}
	const scene = describeScene({
		self: { id: selfID },
		radius: SIGHT,
		unitName: ' paces',
		ambient,
		objects,
		closeness: 2,
		farDistance: 12,
		clusterFactor: 1.2,
		lodLayers: builtinLodLayers(),
		relationships: builtinStringifiers(),
		pluralize: hostPluralize,
		distance: (a, b) => {
			const pa = poses.get(a.id);
			const pb = poses.get(b.id);
			if (!pa || !pb) {
				return Infinity;
			}
			return Math.hypot(pa.x - pb.x, pa.z - pb.z);
		},
	});
	return [
		whereabouts(actor),
		scene,
		'If that work is already done, do not repeat it. Keep listening and acting if something new happens.',
	].filter(Boolean).join('\n');
}

function formatEquipment(actor:GameObject):string {
	const body = actor.getComponent(HumanBody);
	if (!body) {
		return 'No equipment.';
	}
	const lines:string[] = [];
	for (const slot of BODY_SLOTS) {
		const fill = body.slots[slot];
		if (!fill) {
			lines.push(`${slot}: empty`);
		}
		else if (isOccupied(fill)) {
			lines.push(`${slot}: occupied by ${fill.occupiedBy}`);
		}
		else {
			lines.push(`${slot}: ${itemLabel(fill)}`);
		}
	}
	return lines.join('\n');
}

function formatBags(actor:GameObject):string {
	const lines:string[] = [];
	const purse = actor.getComponent(Wallet);
	if (purse) {
		lines.push(`Purse: ${purse.coins} gold`);
	}
	const body = actor.getComponent(HumanBody);
	const pockets = body?.pockets;
	if (pockets) {
		const names = pockets.contents.map(itemLabel);
		lines.push(
			`Pockets (${pockets.contents.length}/${pockets.size}): ${names.length > 0 ? names.join(', ') : 'empty'}`,
		);
	}
	const pack = body ? slotItem(body, 'back') : null;
	if (pack?.Container) {
		const names = pack.Container.contents.map(itemLabel);
		lines.push(
			`Backpack ${itemLabel(pack)} (${pack.Container.contents.length}/${pack.Container.size}): `
			+ `${names.length > 0 ? names.join(', ') : 'empty'}`,
		);
	}
	else {
		lines.push('No backpack.');
	}
	return lines.join('\n');
}

function examineItem(item:ItemInstance):Record<string, unknown> {
	return {
		id: pascalCase(item.name) || item.id,
		name: item.name,
		defID: item.defID,
		count: item.count,
		keyID: item.Key?.keyID,
		equipable: item.Equipable ? { slots: item.Equipable.slots, hands: item.Equipable.hands } : undefined,
		container: item.Container
			? { size: item.Container.size, contents: item.Container.contents.map(itemLabel) }
			: undefined,
		ingredient: item.Ingredient
			? {
				brewer: item.Ingredient.brewer,
				fee: item.Ingredient.fee,
				brew: item.Ingredient.brew,
				yield: item.Ingredient.yield,
			}
			: undefined,
		ask: goodsAsk(item),
	};
}

function examineWorld(go:GameObject):Record<string, unknown> {
	const named = go.getComponent(Named)?.id ?? go.id;
	const lock = go.getComponent(Lock);
	const door = go.getComponent(Door);
	const item = go.getComponent(Item);
	const row:Record<string, unknown> = { name: named };
	if (door) {
		row.kind = 'door';
		row.open = door.open;
	}
	if (lock) {
		row.locked = lock.locked;
		row.needs = lock.keyID ? `${lock.keyID} key` : undefined;
	}
	if (item) {
		row.kind = 'item';
		row.defID = item.defID;
		row.count = item.count;
	}
	if (go.getComponent(Chest)) {
		row.kind = 'chest';
		row.open = !!go.getComponent(Chest)?.open;
		const bag = go.getComponent(Container);
		row.contents = bag && go.getComponent(Chest)?.open && !lock?.locked
			? bag.contents.map((it) => pascalCase(it.name) || it.name)
			: lock?.locked ? 'locked' : 'closed';
	}
	if (go.getComponent(Crowd) || go.getComponent(HumanBody)) {
		row.purse = coinsOf(go);
		row.carrying = carriedLabels(go);
		const crowd = go.getComponent(Crowd);
		if (crowd) {
			row.role = crowd.kind;
			row.wants = crowd.wants;
		}
		const shop = go.getComponent(Merchant);
		if (shop) {
			row.sells = shop.specialty;
			row.ask = shop.ask;
			row.lowest = shop.floor;
		}
		const mark = go.getComponent(Wanted);
		if (mark?.enabled) {
			row.wanted = mark.reason || 'theft';
			row.stolen = mark.items;
		}
	}
	return row;
}

function recipe(director:NPCDirector):PerceptionRecipe<HostCtx> {
	return {
		push: {
			environment: {
				description: 'English scene with named interactables. No coordinates. No wall lists.',
				gather: (ctx) => gatherScene(ctx.actor, director.ambient),
			},
			carrying: {
				description: 'What you wear and carry right now. Do not use tools to re-read this.',
				gather: (ctx) => `${formatEquipment(ctx.actor)}\n${formatBags(ctx.actor)}`,
			},
			master: {
				description: 'What the person you follow is carrying. Ask them to give() items; you cannot take from their pack.',
				gather: (ctx) => {
					const bond = ctx.actor.getComponent(Companion);
					if (!bond) {
						return '';
					}
					const master = ctx.world.findByID(bond.targetID);
					if (!master) {
						return '';
					}
					const items = carriedLabels(master);
					return `${bond.targetID} is carrying: ${items.length > 0 ? items.join(', ') : 'nothing you can see'}. `
						+ `If you need an item they hold, say() to ${bond.targetID} and ask them to give() it to you.`;
				},
			},
			events: {
				description: 'Recent happenings, names not coordinates.',
				gather: (ctx) => director.takeEvents(bodyName(ctx.actor)),
			},
		},
		tools: {
			equipment: {
				description: 'Worn and held slots. Empty slots are named.',
				parameters: { type: 'object', additionalProperties: false, properties: {} },
				handler: (ctx) => formatEquipment(ctx.actor),
			},
			backpack: {
				description: 'Pockets and backpack contents after equip.',
				parameters: { type: 'object', additionalProperties: false, properties: {} },
				handler: (ctx) => formatBags(ctx.actor),
			},
			examine: {
				description: 'Full description of a named thing in sight or in possession. Names only.',
				parameters: {
					type: 'object',
					additionalProperties: false,
					required: ['name'],
					properties: { name: { type: 'string' } },
				},
				handler: (ctx, args) => {
					const name = isRecord(args) && typeof args.name === 'string' ? args.name : '';
					const held = findItem(ctx.actor, name);
					if (held) {
						return examineItem(held);
					}
					const go = ctx.world.findNamed(name);
					if (!go) {
						return { error: `unknown name ${name}` };
					}
					if (!viewerSees(ctx.actor, go) || distXZ(ctx.actor, go) > SIGHT) {
						return { error: `${name} is not in sight` };
					}
					return examineWorld(go);
				},
			},
		},
	};
}

async function executeStep(step:Step, ctx:HostCtx):Promise<ActionResult> {
	const npc = ctx.actor.getComponent(NPCInput);
	if (!npc) {
		return { ok: false, verb: step.verb, reason: 'no NPCInput' };
	}
	if (step.verb !== 'think') {
		ctx.director.noteActorVerb(ctx.actor, step.verb);
	}
	switch (step.verb) {
		case 'go_to': {
			const result = await npc.goTo(argString(step, 'name'));
			if (!result.ok && /locked/.test(result.reason ?? '')) {
				ctx.director.afterLocked(ctx.actor, result.reason ?? '');
			}
			return result;
		}
		case 'follow': {
			const name = argString(step, 'name');
			const bond = ctx.actor.getComponent(Companion);
			if (bond?.hold && (name === bond.targetID || name === 'Player')) {
				return npc.wait(8);
			}
			return npc.follow(name);
		}
		case 'wander': {
			const bond = ctx.actor.getComponent(Companion);
			if (bond?.hold) {
				return npc.wait(8);
			}
			if (bond) {
				return npc.follow(bond.targetID);
			}
			return npc.wander();
		}
		case 'wait': {
			const forExpr = waitForOf(step);
			if (forExpr) {
				ctx.director.armWaitFor(ctx.actor, forExpr);
			}
			return npc.wait(argNumber(step, 'seconds', 1));
		}
		case 'say': {
			const text = argString(step, 'text');
			const to = argString(step, 'to');
			return ctx.director.talk.say(
				bodyName(ctx.actor),
				text,
				to || undefined,
				ctx.world.time,
			);
		}
		case 'use':
			return doUse(ctx, npc, argString(step, 'item'), argString(step, 'target') || undefined);
		case 'equip':
			return doEquip(ctx, argString(step, 'item'), argString(step, 'slot') || undefined);
		case 'unequip':
			return doUnequip(ctx, argString(step, 'slot'));
		case 'pick_up':
			return doPickUp(ctx, npc, argString(step, 'name'));
		case 'drop':
			return doDrop(ctx, argString(step, 'name'));
		case 'give':
			return doGive(ctx, npc, argString(step, 'item'), argString(step, 'to'));
		case 'buy':
			return doBuy(ctx, npc, argString(step, 'item'), argString(step, 'from'), argNumber(step, 'offer', NaN));
		case 'sell':
			return doSell(ctx, npc, argString(step, 'item'), argString(step, 'to'), argNumber(step, 'ask', NaN));
		case 'steal':
			return doSteal(ctx, npc, argString(step, 'item'), argString(step, 'from'));
		case 'set_status':
			return ctx.director.setOverhead(
				bodyName(ctx.actor),
				argString(step, 'text'),
				argNumber(step, 'seconds', 6),
			);
		case 'rest':
			return ctx.director.rest(bodyName(ctx.actor));
		default:
			return ctx.director.performAgentStep(ctx.actor, step);
	}
}

async function ensureRange(
	npc:NPCInput,
	actor:GameObject,
	target:GameObject,
	name:string,
):Promise<ActionResult> {
	if (distXZ(actor, target) <= USE_RANGE) {
		return { ok: true };
	}
	return npc.goTo(name);
}

async function doUse(
	ctx:HostCtx,
	npc:NPCInput,
	itemName:string,
	targetName?:string,
):Promise<ActionResult> {
	const item = findItem(ctx.actor, itemName);
	if (!item) {
		if (ctx.actor.getComponent(Companion)) {
			ctx.director.afterNeedItem(ctx.actor, itemName);
		}
		return { ok: false, verb: 'use', reason: `not carrying ${itemName}` };
	}
	let target:GameObject | null = null;
	if (targetName) {
		target = ctx.world.findNamed(targetName) ?? null;
		if (!target) {
			return { ok: false, verb: 'use', reason: `no such target ${targetName}` };
		}
		const walk = await ensureRange(npc, ctx.actor, target, targetName);
		if (!walk.ok) {
			return { ...walk, verb: 'use' };
		}
	}
	const result = useItem(ctx.actor, item, target);
	if (result.ok && result.reason === 'unlocked' && target?.getComponent(Door)) {
		ctx.director.afterUnlock(target);
	}
	if (result.ok && result.reason.startsWith('brewed')) {
		ctx.director.afterBrew(ctx.actor, result.reason);
	}
	if (result.ok && result.reason === 'tended' && target) {
		ctx.director.afterTend(ctx.actor, target);
	}
	if (result.ok && result.reason.startsWith('lowered')) {
		ctx.director.afterBridge();
	}
	return { ok: result.ok, verb: 'use', reason: result.reason };
}

async function doEquip(ctx:HostCtx, itemName:string, slotName?:string):Promise<ActionResult> {
	const item = findItem(ctx.actor, itemName);
	if (!item) {
		return { ok: false, verb: 'equip', reason: `not carrying ${itemName}` };
	}
	const slot = slotName ? asSlot(slotName) : undefined;
	if (slotName && !slot) {
		return { ok: false, verb: 'equip', reason: `no slot ${slotName}` };
	}
	const err = equipItem(ctx.actor, item, ctx.world, slot);
	if (err) {
		return { ok: false, verb: 'equip', reason: err };
	}
	removeFromBags(ctx.actor, item);
	return { ok: true, verb: 'equip' };
}

async function doUnequip(ctx:HostCtx, slotName:string):Promise<ActionResult> {
	const slot = asSlot(slotName);
	if (!slot) {
		return { ok: false, verb: 'unequip', reason: `no slot ${slotName}` };
	}
	unequipSlot(ctx.actor, slot, ctx.world);
	return { ok: true, verb: 'unequip' };
}

async function doPickUp(ctx:HostCtx, npc:NPCInput, name:string):Promise<ActionResult> {
	const loot = ctx.world.findNamed(name);
	if (loot?.getComponent(Pickupable)) {
		const crop = loot.getComponent(Harvest);
		if (crop && !actorIs(ctx.actor, crop.harvester)) {
			return { ok: false, verb: 'pick_up', reason: `only ${crop.harvester} can harvest that` };
		}
		const walk = await ensureRange(npc, ctx.actor, loot, name);
		if (!walk.ok) {
			return { ...walk, verb: 'pick_up' };
		}
		const magic = isMagicPotion(loot);
		const reason = pickup(ctx.actor, loot);
		const ok = reason !== 'no room' && reason !== 'no world';
		if (ok) {
			ctx.actor.getComponent(HumanSprite)?.playClip('take', ctx.world.time);
			ctx.director.afterPickUp(ctx.actor, name);
		}
		if (ok && magic) {
			ctx.director.afterPotion(ctx.actor);
		}
		return { ok, verb: 'pick_up', reason };
	}
	const held = findChestHolding(ctx.world, name);
	if (held) {
		const chestName = held.chest.getComponent(Named)?.id ?? held.chest.id;
		const lock = held.chest.getComponent(Lock);
		if (lock?.locked) {
			return { ok: false, verb: 'pick_up', reason: `${chestName} is locked — unlock it first` };
		}
		const walk = await ensureRange(npc, ctx.actor, held.chest, chestName);
		if (!walk.ok) {
			return { ...walk, verb: 'pick_up' };
		}
		const reason = takeFromChest(ctx.actor, held);
		const ok = reason.startsWith('took ');
		if (ok) {
			ctx.actor.getComponent(HumanSprite)?.playClip('take', ctx.world.time);
			ctx.director.afterPickUp(ctx.actor, name);
		}
		return { ok, verb: 'pick_up', reason };
	}
	return { ok: false, verb: 'pick_up', reason: `no such item ${name}` };
}

function isMagicPotion(go:GameObject):boolean {
	const named = go.getComponent(Named)?.id ?? go.id;
	const defID = go.getComponent(Item)?.defID;
	return named === MAGIC_POTION || defID === 'magic_potion';
}

async function doDrop(ctx:HostCtx, name:string):Promise<ActionResult> {
	const item = findItem(ctx.actor, name);
	if (!item) {
		return { ok: false, verb: 'drop', reason: `not carrying ${name}` };
	}
	removeFromBags(ctx.actor, item);
	const body = ctx.actor.getComponent(HumanBody);
	if (body) {
		for (const slot of BODY_SLOTS) {
			if (slotItem(body, slot) === item) {
				body.slots[slot] = null;
			}
		}
	}
	dropItem(ctx.actor, item);
	return { ok: true, verb: 'drop', reason: `dropped ${item.name}` };
}

function takeOne(actor:GameObject, item:ItemInstance):ItemInstance {
	const gift = item.count > 1 ? cloneItem(item, 1) : item;
	if (gift === item) {
		removeFromBags(actor, item);
		const body = actor.getComponent(HumanBody);
		if (body) {
			for (const slot of BODY_SLOTS) {
				if (slotItem(body, slot) === item) {
					body.slots[slot] = null;
				}
			}
		}
	}
	else {
		item.count -= 1;
	}
	return gift;
}

function restoreOne(actor:GameObject, item:ItemInstance, original:ItemInstance):void {
	if (item === original) {
		tryInsert(actor, item);
		return;
	}
	original.count += 1;
}

function tooFar(actor:GameObject, target:GameObject, name:string):string | null {
	if (distXZ(actor, target) > USE_RANGE) {
		return `too far — walk closer to ${name}`;
	}
	return null;
}

function settleGive(from:GameObject, to:GameObject, itemName:string, director:NPCDirector):ActionResult {
	if (to === from) {
		return { ok: false, verb: 'give', reason: 'cannot give to yourself' };
	}
	const item = findItem(from, itemName);
	if (!item) {
		return { ok: false, verb: 'give', reason: `not carrying ${itemName}` };
	}
	const gift = takeOne(from, item);
	if (!tryInsert(to, gift)) {
		const master = from.getComponent(Companion)?.targetID;
		if (to.id === 'Player' || bodyName(to) === master) {
			dropItem(to, gift);
			const label = pascalCase(gift.name) || gift.name;
			const t = from.world?.time ?? 0;
			from.getComponent(HumanSprite)?.playClip('give', t);
			to.getComponent(HumanSprite)?.playClip('take', t);
			director.afterGive(from, to, label);
			return {
				ok: true,
				verb: 'give',
				reason: `gave ${label} to ${bodyName(to)} (left at their feet — no room)`,
			};
		}
		restoreOne(from, gift, item);
		return { ok: false, verb: 'give', reason: `${bodyName(to)} has no room` };
	}
	const label = pascalCase(gift.name) || gift.name;
	const t = from.world?.time ?? 0;
	from.getComponent(HumanSprite)?.playClip('give', t);
	to.getComponent(HumanSprite)?.playClip('take', t);
	director.afterGive(from, to, label);
	return { ok: true, verb: 'give', reason: `gave ${label} to ${bodyName(to)}` };
}

function settlePay(from:GameObject, to:GameObject, amount:number, director:NPCDirector):ActionResult {
	if (to === from) {
		return { ok: false, verb: 'give', reason: 'cannot give to yourself' };
	}
	const err = transferCoins(from, to, amount);
	if (err) {
		return { ok: false, verb: 'give', reason: err };
	}
	const t = from.world?.time ?? 0;
	from.getComponent(HumanSprite)?.playClip('give', t);
	to.getComponent(HumanSprite)?.playClip('take', t);
	director.afterPay(from, to, amount);
	return { ok: true, verb: 'give', reason: `gave ${amount} gold to ${bodyName(to)}` };
}

function settleBuy(
	buyer:GameObject,
	seller:GameObject,
	itemName:string,
	offer:number,
	director:NPCDirector,
):ActionResult {
	const fromName = bodyName(seller);
	const stock = findSaleItem(seller, itemName);
	if (!stock) {
		return { ok: false, verb: 'buy', reason: `${fromName} has no ${itemName}` };
	}
	const buyerID = bodyName(buyer);
	const quote = priceFor(seller, stock, buyerID);
	if (!quote) {
		return { ok: false, verb: 'buy', reason: `${itemName} is not for sale` };
	}
	const offered = Number.isFinite(offer);
	let price = quote.agreed ?? quote.ask;
	if (offered) {
		if (offer + 1e-6 < quote.floor) {
			return { ok: false, verb: 'buy', reason: `${fromName} will not go below ${quote.floor} gold` };
		}
		price = Math.floor(offer);
	}
	const err = transferCoins(buyer, seller, price);
	if (err) {
		return { ok: false, verb: 'buy', reason: err };
	}
	const gift = takeOne(seller, stock);
	if (!tryInsert(buyer, gift)) {
		restoreOne(seller, gift, stock);
		transferCoins(seller, buyer, price);
		return { ok: false, verb: 'buy', reason: 'no room' };
	}
	const shop = seller.getComponent(Merchant);
	if (shop) {
		delete shop.deals[buyerID];
	}
	const label = pascalCase(gift.name) || gift.name;
	const t = buyer.world?.time ?? 0;
	buyer.getComponent(HumanSprite)?.playClip('take', t);
	seller.getComponent(HumanSprite)?.playClip('give', t);
	director.afterTrade(buyer, seller, label, price);
	return { ok: true, verb: 'buy', reason: `bought ${label} from ${fromName} for ${price} gold` };
}

function settleSell(
	seller:GameObject,
	buyer:GameObject,
	itemName:string,
	ask:number,
	director:NPCDirector,
):ActionResult {
	const toName = bodyName(buyer);
	const stock = findSaleItem(seller, itemName) ?? findItem(seller, itemName);
	if (!stock) {
		return { ok: false, verb: 'sell', reason: `not carrying ${itemName}` };
	}
	const quote = priceFor(seller, stock, toName);
	const price = Number.isFinite(ask) ? Math.floor(ask) : (quote?.ask ?? quote?.floor);
	if (price === undefined || price <= 0) {
		return { ok: false, verb: 'sell', reason: `${itemName} has no price — name an ask` };
	}
	const crowd = buyer.getComponent(Crowd);
	if (crowd && crowd.wants.length > 0) {
		const want = crowd.wants.some((w) => compactName(w) === compactName(itemName));
		if (!want && toName !== 'Player') {
			return { ok: false, verb: 'sell', reason: `${toName} does not want ${itemName}` };
		}
	}
	if (coinsOf(buyer) < price) {
		return { ok: false, verb: 'sell', reason: `${toName} has only ${coinsOf(buyer)} gold` };
	}
	const err = transferCoins(buyer, seller, price);
	if (err) {
		return { ok: false, verb: 'sell', reason: err };
	}
	const gift = takeOne(seller, stock);
	if (!tryInsert(buyer, gift)) {
		restoreOne(seller, gift, stock);
		transferCoins(seller, buyer, price);
		return { ok: false, verb: 'sell', reason: `${toName} has no room` };
	}
	const label = pascalCase(gift.name) || gift.name;
	const t = seller.world?.time ?? 0;
	seller.getComponent(HumanSprite)?.playClip('give', t);
	buyer.getComponent(HumanSprite)?.playClip('take', t);
	director.afterTrade(buyer, seller, label, price);
	return { ok: true, verb: 'sell', reason: `sold ${label} to ${toName} for ${price} gold` };
}

async function doGive(
	ctx:HostCtx,
	npc:NPCInput,
	itemName:string,
	toName:string,
):Promise<ActionResult> {
	if (!toName) {
		return { ok: false, verb: 'give', reason: 'give to whom?' };
	}
	const target = findBody(ctx.world, toName);
	if (!target) {
		return { ok: false, verb: 'give', reason: `no such person ${toName}` };
	}
	const walk = await ensureRange(npc, ctx.actor, target, toName);
	if (!walk.ok) {
		return { ...walk, verb: 'give' };
	}
	return settleGive(ctx.actor, target, itemName, ctx.director);
}

async function doBuy(
	ctx:HostCtx,
	npc:NPCInput,
	itemName:string,
	fromName:string,
	offer:number,
):Promise<ActionResult> {
	if (!fromName) {
		return { ok: false, verb: 'buy', reason: 'buy from whom?' };
	}
	const seller = findBody(ctx.world, fromName);
	if (!seller) {
		return { ok: false, verb: 'buy', reason: `no such person ${fromName}` };
	}
	const walk = await ensureRange(npc, ctx.actor, seller, fromName);
	if (!walk.ok) {
		return { ...walk, verb: 'buy' };
	}
	return settleBuy(ctx.actor, seller, itemName, offer, ctx.director);
}

async function doSell(
	ctx:HostCtx,
	npc:NPCInput,
	itemName:string,
	toName:string,
	ask:number,
):Promise<ActionResult> {
	if (!toName) {
		return { ok: false, verb: 'sell', reason: 'sell to whom?' };
	}
	const buyer = findBody(ctx.world, toName);
	if (!buyer) {
		return { ok: false, verb: 'sell', reason: `no such person ${toName}` };
	}
	const walk = await ensureRange(npc, ctx.actor, buyer, toName);
	if (!walk.ok) {
		return { ...walk, verb: 'sell' };
	}
	return settleSell(ctx.actor, buyer, itemName, ask, ctx.director);
}

async function doSteal(
	ctx:HostCtx,
	npc:NPCInput,
	itemName:string,
	fromName:string,
):Promise<ActionResult> {
	if (!fromName) {
		return { ok: false, verb: 'steal', reason: 'steal from whom?' };
	}
	if (ctx.actor.getComponent(Crowd)?.kind === 'guard') {
		return { ok: false, verb: 'steal', reason: 'the watch does not steal' };
	}
	const victim = findBody(ctx.world, fromName);
	if (!victim) {
		return { ok: false, verb: 'steal', reason: `no such person ${fromName}` };
	}
	if (victim === ctx.actor) {
		return { ok: false, verb: 'steal', reason: 'cannot steal from yourself' };
	}
	const walk = await ensureRange(npc, ctx.actor, victim, fromName);
	if (!walk.ok) {
		return { ...walk, verb: 'steal' };
	}
	const stock = findSaleItem(victim, itemName) ?? findItem(victim, itemName);
	if (!stock) {
		return { ok: false, verb: 'steal', reason: `${fromName} has no ${itemName}` };
	}
	const gift = takeOne(victim, stock);
	if (!tryInsert(ctx.actor, gift)) {
		restoreOne(victim, gift, stock);
		return { ok: false, verb: 'steal', reason: 'no room' };
	}
	const label = pascalCase(gift.name) || gift.name;
	ctx.actor.getComponent(HumanSprite)?.playClip('take', ctx.world.time);
	ctx.director.reportTheft(ctx.actor, label, fromName, 'stole without paying');
	return { ok: true, verb: 'steal', reason: `stole ${label} from ${fromName}` };
}

async function resolveBrowserModel(requested?:string):Promise<{ id:string; catalog:ModelInfo[] } | null> {
	const catalog = await fetchModelCatalog(INFERENCE_ROOT);
	const chat = catalog.filter((m) => !isEmbeddingModel(m));
	const loaded = chat.filter(isLoadedModel);
	const listed = catalog.map((m) => `${m.id}${loaded.some((l) => l.id === m.id) ? ' [loaded]' : ''}`).join(', ')
		|| '(empty)';
	const want = requested?.trim();
	if (want) {
		const hit = chat.find((m) => m.id === want)
			?? chat.find((m) => m.id.endsWith(want) || m.id.includes(want));
		if (hit) {
			console.info('NPCDirector: catalog', listed, '→', hit.id, '(menu)');
			return { id: hit.id, catalog };
		}
		if (chat.length === 0) {
			console.info('NPCDirector: catalog empty, trying', want);
			return { id: want, catalog };
		}
	}
	const picked = pickSingleChatModel(catalog, PREFERRED_MODELS) ?? null;
	if (picked) {
		console.info('NPCDirector: catalog', listed, '→', picked);
		return { id: picked, catalog };
	}
	return null;
}

function whoFromMessages(messages:ChatMessage[]):string | undefined {
	for (const m of messages) {
		if (m.role !== 'system' || typeof m.content !== 'string') {
			continue;
		}
		const hit = /^You are ([^.]+)/.exec(m.content);
		if (hit) {
			return hit[1].trim();
		}
	}
	return undefined;
}

type NPCMind = {
	id:string;
	agent:Agent<HostCtx>;
	busy:boolean;
	aiOn:boolean;
	rank:number;
	thoughtAt:number;
	progressAt:number;
	progressKey:string;
	note:string;
	label:string;
	labelUntil:number;
	skipHeartbeat:boolean;
	skipMajor:boolean;
	cache:SampleCache;
};

type MindSeed = {
	id:string;
	rank?:number;
	identity:AgentIdentity;
	goals:Goal[];
	memories:{ text:string; tags:string[]; pinned?:boolean }[];
	watches?:Watches;
	pinnedWatches?:Watches;
	watchesWritable?:boolean;
	skipHeartbeat?:boolean;
	skipMajor?:boolean;
};

const HERBALIST_SEED:MindSeed = {
	id: 'Herbalist',
	identity: {
		name: 'Herbalist',
		role: 'You are Bram, a forager. The hall names you Herbalist. Your boy Noll lies fevered on NollCot in the vault beyond EastGate. You do not know where the EastGate key is. Ask Alchemist how to open EastGate. You cannot unlock doors or chests. When EastGate opens, walk through it — do not go_to(EastGate) after it is open. go_to(Bitterroot), pick_up(Bitterroot), give(Bitterroot, Alchemist) at BrewHearth. Then take one MagicPotion and use(MagicPotion, NollCot). You alone harvest Bitterroot. You cannot brew. Do not drink the vial. Do not linger in the doorway. Act; do not only talk. Use names, never coordinates.',
		traits: ['plain', 'anxious', 'generous'],
	},
	goals: [{
		text: 'Ask Alchemist how EastGate opens. When it is open, walk through to Bitterroot: pick_up(Bitterroot), give it to Alchemist at BrewHearth, use(MagicPotion, NollCot). Do not drink it.',
		priority: 2,
	}],
	memories: [
		{
			text: 'Noll lies on NollCot in the vault. Only I tend him. Only I pick Bitterroot, and it grows past EastGate. Alchemist brews two MagicPotion at BrewHearth if they hold GoldCoin. Captain has GoldCoin. I do not know where the EastGate key is. Alchemist knows the hall better than I do.',
			tags: ['NollCot', 'Bitterroot', 'EastGate', 'Alchemist', 'Captain', 'BrewHearth'],
			pinned: true,
		},
		{
			text: 'The hall has no cure. We must enter the vault. I will give Bitterroot to Alchemist. I will use MagicPotion on NollCot. I will not drink it. I will not steal GoldCoin.',
			tags: ['deal', 'NollCot', 'vault'],
			pinned: true,
		},
	],
};

const ALCHEMIST_SEED:MindSeed = {
	id: 'Alchemist',
	identity: {
		name: 'Alchemist',
		role: 'You are Sable, a vault alchemist. The hall names you Alchemist. You are penniless and will not brew unpaid. You know a secret: BrassKey is inside locked ArmoryChest. You do not have ChestKey. Captain holds ChestKey. FIRST: tell Captain that BrassKey is in ArmoryChest and to use(ChestKey, ArmoryChest), then pick_up(BrassKey) and use(BrassKey, EastGate). You cannot unlock or harvest. When EastGate opens, walk through to BrewHearth — do not linger in the doorway. If GoldCoin is already in your pack, do not ask for it again. Get Bitterroot from Herbalist, then use(Bitterroot, BrewHearth). Give one MagicPotion to Herbalist and one to Captain. Keep the coin. Do not drink the vials. Act; do not only talk. Use names, never coordinates.',
		traits: ['proud', 'hungry', 'exact'],
	},
	goals: [{
		text: 'Tell Captain: BrassKey is in ArmoryChest. Ask them to use(ChestKey, ArmoryChest), pick_up(BrassKey), use(BrassKey, EastGate). Then wait at BrewHearth for GoldCoin and Bitterroot.',
		priority: 2,
	}],
	memories: [
		{
			text: 'I brew only at BrewHearth in the vault. use(Bitterroot, BrewHearth) makes two MagicPotion if I already hold GoldCoin. I keep the coin. I give the vials away. I do not tend the cots.',
			tags: ['brew', 'BrewHearth', 'Bitterroot', 'GoldCoin', 'MagicPotion'],
			pinned: true,
		},
		{
			text: 'EastGate is locked. BrassKey is inside ArmoryChest. I hid that fact; Captain does not know the contents. Captain holds ChestKey, which opens ArmoryChest. Herbalist harvests in the vault. I will not brew in the hall. I will not brew for charity. I will not drink the vials.',
			tags: ['deal', 'EastGate', 'ArmoryChest', 'BrassKey', 'vault'],
			pinned: true,
		},
	],
};

const CAPTAIN_SEED:MindSeed = {
	id: 'Captain',
	identity: {
		name: 'Captain',
		role: 'You are Lys, pay-captain of the abbey watch. The hall names you Captain. Your sister Lina lies fevered on LinaCot in the vault. ChestKey and GoldCoin start in your pack. ChestKey opens ArmoryChest — that is all you know about the chest; you do not know what is inside. EastGate is locked and you do not hold its key. Listen to Alchemist. If they ask, use(ChestKey, ArmoryChest), then look inside. If you later hold BrassKey, use(BrassKey, EastGate) and walk through. If you still hold GoldCoin, give(GoldCoin, Alchemist) at BrewHearth. Then go_to(LinaCot) and use(MagicPotion, LinaCot). Do not stand in the doorway. Do not harvest. Do not brew. Do not drink the vial. Act; do not only talk. Use names, never coordinates.',
		traits: ['brisk', 'fair', 'worried'],
	},
	goals: [{
		text: 'Ask Alchemist how EastGate opens. ChestKey in your pack opens ArmoryChest; you do not know what is inside. After you hold BrassKey, use(BrassKey, EastGate). Then pay Alchemist and tend LinaCot.',
		priority: 2,
	}],
	memories: [
		{
			text: 'ChestKey and GoldCoin are in my traveler pack. ChestKey opens ArmoryChest. I do not know what is inside ArmoryChest. EastGate is locked and I do not have its key. Lina lies on LinaCot in the vault — only I tend her. Alchemist will not brew without my coin, and only at BrewHearth.',
			tags: ['ChestKey', 'ArmoryChest', 'EastGate', 'GoldCoin', 'LinaCot', 'Alchemist', 'BrewHearth'],
			pinned: true,
		},
		{
			text: 'The hall has no cure. Open what I can, find the EastGate key, pay Alchemist, enter the vault, use MagicPotion on LinaCot. I will not drink it. I will not harvest. I will not brew.',
			tags: ['deal', 'Lina', 'vault'],
			pinned: true,
		},
	],
};

const MIND_SEEDS:MindSeed[] = [HERBALIST_SEED, ALCHEMIST_SEED, CAPTAIN_SEED];

const FORAGER_SEED:MindSeed = {
	id: 'Forager',
	rank: 0.5,
	identity: {
		name: 'Forager',
		role: 'You are Wren, a glen forager. The land names you Forager. Stay among the western trees until someone approaches or talks to you. Then go_to(FireMushroom), pick_up(FireMushroom), give(FireMushroom, Miller). Ignore CottageDoor. After MillBridge is down, take SilverTrout from Angler. Only you harvest FireMushroom. You cannot lower the bridge. Do not walk into water. Act; do not only talk. Use names, never coordinates.',
		traits: ['quiet', 'hungry', 'kind'],
	},
	goals: [{
		text: 'Wait until approached or spoken to. Then pick_up(FireMushroom) and give(FireMushroom, Miller). Then take SilverTrout after MillBridge is down.',
		priority: 2,
	}],
	memories: [
		{
			text: 'FireMushroom grows among the western trees, outdoors. Only I pick it. CottageDoor is not the way. Miller keeps FireMushroom as the mill-fee and will not lower MillBridge until he has it. Then he uses MillCrank on MillLever. Angler has SilverTrout south of the water and cannot cross until MillBridge is down.',
			tags: ['FireMushroom', 'Miller', 'Angler', 'MillBridge'],
			pinned: true,
		},
	],
	pinnedWatches: {
		hurt: 'isHurt(me)',
		approaching: 'hasHeard || some(others.nearby().approaching())',
	},
	watchesWritable: false,
	skipHeartbeat: true,
	skipMajor: true,
};

const MILLER_SEED:MindSeed = {
	id: 'Miller',
	rank: 0.5,
	identity: {
		name: 'Miller',
		role: 'You are Oat, miller of the cottage. The land names you Miller. Ignore CottageDoor and CottageKey. Your aim is FireMushroom. MillBridge is your leverage: do not use(MillCrank, MillLever) until Forager give(FireMushroom) to you. You keep the mushroom. After you are paid, immediately use(MillCrank, MillLever). After it is down, do not take SilverTrout. Do not harvest. Act; do not only talk. Use names, never coordinates.',
		traits: ['stubborn', 'fair', 'tired'],
	},
	goals: [{
		text: 'Get FireMushroom from Forager. Do not lower MillBridge until you hold it. Then NOW use(MillCrank, MillLever). Ignore the cottage. Do not take SilverTrout.',
		priority: 2,
	}],
	memories: [
		{
			text: 'MillCrank is in my pack. The sluice works whenever I use it. I will not — FireMushroom is the mill-fee, and MillBridge stays up until I have it. Once I hold the mushroom I use(MillCrank, MillLever) at once and keep it. I do not harvest. I do not fish.',
			tags: ['MillCrank', 'MillLever', 'FireMushroom', 'MillBridge'],
			pinned: true,
		},
	],
};

const ANGLER_SEED:MindSeed = {
	id: 'Angler',
	rank: 0.5,
	identity: {
		name: 'Angler',
		role: 'You are Pike, an angler. The land names you Angler. Stay on the south grass. Do not walk into water. MillBridge is raised. SilverTrout is in your pack. FIRST: wait. When MillBridge is down, walk north across MillBridge and give(SilverTrout, Forager). Do not drop the trout. Act when the bridge is down; do not only talk. Use names, never coordinates.',
		traits: ['wet', 'impatient', 'grateful'],
	},
	goals: [{
		text: 'Stay south of the water. When MillBridge is down, cross north and give(SilverTrout, Forager).',
		priority: 2,
	}],
	memories: [
		{
			text: 'I cannot swim the mill-race. The bridge must come down. I will not drop SilverTrout in the water. Forager harvests. Miller works the sluice.',
			tags: ['MillBridge', 'SilverTrout', 'Forager', 'Miller'],
			pinned: true,
		},
	],
	watches: { bridge: 'hasJustOpened(MillBridge) || some(events.filter("bridge"))' },
	skipHeartbeat: true,
	skipMajor: true,
};

const SERVANT_SEED:MindSeed = {
	id: 'Servant',
	rank: 1,
	identity: {
		name: 'Servant',
		role: 'You serve Player. The land names you Servant. When Player gives an order, do the whole order and keep it in mind until it is finished — do not drop parts. If they tell you to stay, wait, stop following, or go back inside, wait() there; do not follow(Player) out. If they tell you to return an item, give() it (walk to them if you must), then go back if they told you to stay. Follow Player only when idle and not stationed. If a door is locked, use the matching key. If Player holds that key, say() and ask them to give() it. You may enter Cottage when ordered. After CottageDoor is open, go_to(Cottage). If you are already inside Cottage, stay inside — do not go back through CottageDoor unless told to leave. Do not join Forager, Miller, or Angler unless Player orders it. Do not walk into water. Use names, never coordinates.',
		traits: ['obedient', 'watchful', 'eager'],
	},
	goals: [{
		text: 'Obey Player\'s last order in full. Follow Player only when idle and not told to stay. If told to enter and return a key, give() the key, then wait() inside — do not follow back out.',
		priority: 2,
	}],
	memories: [
		{
			text: 'I serve Player. I keep their last order until it is done. If CottageDoor is locked I need CottageKey. If they tell me to stay inside, I wait() there after I give things back. I do not harvest FireMushroom, work the mill, or fish unless Player orders it.',
			tags: ['Player', 'follow', 'CottageDoor', 'CottageKey'],
			pinned: true,
		},
	],
};

const GLEN_SEEDS:MindSeed[] = [FORAGER_SEED, MILLER_SEED, ANGLER_SEED, SERVANT_SEED];

function emptyInferClock():{
	calls:number;
	contextMs:number;
	generateMs:number;
	wallMs:number;
	contextKnown:number;
	lastContextMs:number | null;
	lastGenerateMs:number | null;
	lastWallMs:number | null;
} {
	return {
		calls: 0,
		contextMs: 0,
		generateMs: 0,
		wallMs: 0,
		contextKnown: 0,
		lastContextMs: null,
		lastGenerateMs: null,
		lastWallMs: null,
	};
}

export class NPCDirector {
	readonly talk:TalkNet;
	ambient:string;
	private readonly sceneID:string;
	private readonly minds:NPCMind[] = [];
	private readonly inbox = new Map<string, AgentEvent[]>();
	private ready = false;
	private disposed = false;
	bargainDone = false;
	private readonly spoken = new Set<string>();
	private readonly doorOpen = new Map<string, boolean>();
	private readonly chestOpen = new Map<string, boolean>();
	private storedAgents:Record<string, AgentJSON>;
	private provider:InferenceProvider | null = null;
	private model = '';
	private catalog:ModelInfo[] = [];
	private vision = false;
	private logSeq = 0;
	private connecting = false;
	private nextTryAt = 0;
	private nextCrowdAt = 12;
	private readonly pendingHear = new Map<string, {
		speakerID:string;
		spoken:string;
		addressed:boolean;
		until:number;
	}[]>();
	private readonly lockNudgeAt = new Map<string, number>();
	private readonly queue = new ThinkQueue({ maxParallel: loadThinkPref() });
	private readonly readyThink:ThinkRow[] = [];
	private readonly acting = new Set<string>();
	private posedEvents:PosedFact[] = [];
	private infer = emptyInferClock();

	constructor(
		private readonly world:World,
		private readonly chat:HudChatLine[],
		private readonly log:HudAiLogEntry[],
		opts:{
			sceneID?:string;
			ambient?:string;
			agents?:Record<string, AgentJSON>;
			bargainDone?:boolean;
		} = {},
	) {
		this.sceneID = opts.sceneID ?? 'abbey_vault';
		this.ambient = opts.ambient
			?? 'A damp stone hall of the abbey vault. Use names, never coordinates.';
		this.storedAgents = JSON.parse(rewriteRetiredFeeNames(JSON.stringify(opts.agents ?? {}))) as Record<string, AgentJSON>;
		this.bargainDone = opts.bargainDone ?? false;
		this.talk = new TalkNet({
			inRange: (speakerID, listenerID) => inTalkRange(world, speakerID, listenerID),
			others: (speakerID) => talkOthers(world, speakerID),
			canSee: (a, b) => talkCanSee(world, a, b),
			clearHear: (a, b) => canHearClearly(world, a, b),
			names: (id) => this.talkNames(id),
			face: (who, toward) => talkFace(world, who, toward),
		}, (utterance) => this.onSpoke(utterance), { approach: false });
		this.log.length = 0;
		resetAiLogSink();
	}

	pushLog(name:string, message:string, image?:string):void {
		this.logSeq += 1;
		const entry:HudAiLogEntry = image
			? { seq: this.logSeq, name, message, image }
			: { seq: this.logSeq, name, message };
		this.log.push(entry);
		let trimmed = false;
		if (this.log.length > AI_LOG_CAP) {
			this.log.splice(0, this.log.length - AI_LOG_CAP);
			trimmed = true;
		}
		sinkAiLog(this.log, entry, trimmed);
	}

	async logLook(id:string, zoom:number, snap:MapSnapshot):Promise<void> {
		const stamped = await stampMap(snap);
		const legend = stamped.legend || '(no marks)';
		const z = zoom === 0 || zoom === 1 ? String(zoom) : String(Math.round(zoom * 100) / 100);
		this.pushLog(
			id,
			`see_map({zoom:${z}})\n${legend}`,
			stamped.image,
		);
	}

	/** What `see_map` would send: stamped image + name legend, no coordinates. */
	async dumpLookMaps():Promise<number> {
		const ids:string[] = [];
		this.world.forEachComponent(HumanBody, (_body, go) => {
			if (go.id === 'Player') {
				return;
			}
			ids.push(go.id);
		});
		let n = 0;
		for (const npcID of ids) {
			for (const zoom of [1, 0]) {
				const snap = snapshotMap(this.world, npcID, zoom);
				if (!snap || !('marks' in snap)) {
					continue;
				}
				await this.logLook(npcID, zoom, snap);
				n += 1;
			}
		}
		return n;
	}

	status():string {
		if (this.minds.length === 0) {
			return '';
		}
		return this.minds.map((m) => m.note).filter(Boolean).join('  ·  ');
	}

	/** Overhead captions: thinking while a tick is in flight, else a timed self-status. */
	statusLabels():{ id:string; text:string }[] {
		const now = this.world.time;
		const out:{ id:string; text:string }[] = [];
		for (const mind of this.minds) {
			if (mind.busy) {
				out.push({ id: mind.id, text: 'thinking...' });
				continue;
			}
			if (mind.label && now < mind.labelUntil) {
				out.push({ id: mind.id, text: mind.label });
			}
		}
		return out;
	}

	setOverhead(id:string, text:string, seconds:number):ActionResult {
		const mind = this.mindByID(id);
		if (!mind) {
			return { ok: false, verb: 'set_status', reason: 'no mind' };
		}
		const label = text.trim().slice(0, 72);
		if (!label) {
			return { ok: false, verb: 'set_status', reason: 'nothing to show' };
		}
		const life = Math.min(60, Math.max(1, seconds));
		mind.label = label;
		mind.labelUntil = this.world.time + life;
		return { ok: true, verb: 'set_status', reason: `${life}s` };
	}

	liveModel():string {
		return this.model;
	}

	liveMaxParallel():number {
		return this.queue.maxParallel;
	}

	setMaxParallel(n:number):void {
		const v = clampParallelThinkers(n);
		if (this.queue.maxParallel === v) {
			return;
		}
		this.queue.maxParallel = v;
		saveThinkPref(v);
	}

	patchInfer(hud:HudModel):void {
		hud.inferCalls = this.infer.calls;
		hud.inferContextMs = this.infer.contextMs;
		hud.inferGenerateMs = this.infer.generateMs;
		hud.inferWallMs = this.infer.wallMs;
		hud.inferContextKnown = this.infer.contextKnown;
		hud.inferLastContextMs = this.infer.lastContextMs;
		hud.inferLastGenerateMs = this.infer.lastGenerateMs;
		hud.inferLastWallMs = this.infer.lastWallMs;
	}

	resetInferStats():void {
		this.infer = emptyInferClock();
	}

	private recordInfer(wallMs:number, res:{ promptMs?:number; generateMs?:number }):void {
		const context = res.promptMs;
		let generate = res.generateMs;
		if (generate === undefined && context !== undefined) {
			generate = Math.max(0, wallMs - context);
		}
		this.infer.calls += 1;
		this.infer.wallMs += wallMs;
		this.infer.lastWallMs = wallMs;
		if (context !== undefined) {
			this.infer.contextMs += context;
			this.infer.contextKnown += 1;
			this.infer.lastContextMs = context;
		}
		else {
			this.infer.lastContextMs = null;
		}
		if (generate !== undefined) {
			this.infer.generateMs += generate;
			this.infer.lastGenerateMs = generate;
		}
		else {
			this.infer.generateMs += wallMs;
			this.infer.lastGenerateMs = wallMs;
		}
	}

	private syncVision(modelID:string):void {
		const row = this.catalog.find((m) => m.id === modelID)
			?? this.catalog.find((m) => m.id.endsWith(modelID) || m.id.includes(modelID));
		this.vision = isVisionModel(row ?? modelID);
		for (const mind of this.minds) {
			mind.agent.vision = this.vision;
		}
	}

	setModel(id:string):void {
		const name = id.trim();
		if (!name) {
			return;
		}
		saveModelPref(name);
		if (name === this.model) {
			return;
		}
		this.model = name;
		this.syncVision(name);
		this.pushLog('NPCDirector', `using ${name}${this.vision ? ' (vision)' : ''}`);
		for (const mind of this.minds) {
			mind.agent.model = name;
			mind.agent.vision = this.vision;
		}
	}

	async refreshHudModels(hud:HudModel):Promise<void> {
		const catalog = await fetchModelCatalog(INFERENCE_ROOT);
		this.catalog = catalog;
		if (this.model) {
			this.syncVision(this.model);
		}
		const chat = catalog.filter((m) => !isEmbeddingModel(m));
		chat.sort((a, b) => {
			const la = isLoadedModel(a) ? 0 : 1;
			const lb = isLoadedModel(b) ? 0 : 1;
			if (la !== lb) {
				return la - lb;
			}
			return a.id.localeCompare(b.id);
		});
		const models:HudModelOption[] = chat.map((m) => ({
			id: m.id,
			loaded: isLoadedModel(m),
		}));
		const current = this.model || loadModelPref();
		if (current && !models.some((m) => m.id === current)) {
			models.unshift({ id: current, loaded: false });
		}
		if (hud.model && !models.some((m) => m.id === hud.model)) {
			models.unshift({ id: hud.model, loaded: false });
		}
		hud.models = models;
		if (!hud.model) {
			hud.model = current || models[0]?.id || '';
		}
	}

	debug():{
		note:string;
		minds:{
			id:string;
			note:string;
			rank:number;
			heartbeat:number;
			watchMax:number;
			aiOn:boolean;
			x:number;
			z:number;
			speech:string;
		}[];
		bargainDone:boolean;
		gold:string[];
		herb:string[];
		potion:string[];
	} {
		const holders = (name:string):string[] => {
			const out:string[] = [];
			for (const id of ['Herbalist', 'Alchemist', 'Captain']) {
				const actor = this.world.findByID(id);
				if (actor && findCarried(actor, (it) => itemMatchesName(it, name))) {
					out.push(id);
				}
			}
			return out;
		};
		return {
			note: this.status(),
			bargainDone: this.bargainDone,
			gold: holders('GoldCoin'),
			herb: holders('Bitterroot'),
			potion: holders('MagicPotion'),
			minds: this.minds.map((m) => {
				const actor = this.world.findByID(m.id);
				const p = actor?.transform.position;
				const bubble = actor?.getComponent(SpeechBubble);
				const speech = bubble && this.world.time < bubble.until ? bubble.text : '';
				return {
					id: m.id,
					note: m.note,
					rank: m.rank,
					heartbeat: this.queue.heartbeatSeconds(m.id),
					watchMax: this.queue.lastMax(m.id),
					aiOn: m.aiOn,
					x: p?.x ?? 0,
					z: p?.z ?? 0,
					speech,
				};
			}),
		};
	}

	publishDebug():void {
		(window as unknown as { __npcWatch:ReturnType<NPCDirector['debug']> }).__npcWatch = this.debug();
		publishAiLog(this.log);
	}

	async start():Promise<void> {
		if (this.disposed || this.ready || this.connecting) {
			return;
		}
		this.connecting = true;
		try {
			await this.connectMinds();
		}
		finally {
			this.connecting = false;
			if (!this.ready && !this.disposed) {
				this.nextTryAt = this.world.time + 3;
			}
		}
	}

	private async connectMinds():Promise<void> {
		const prev = this.minds.map((m) => m.id);
		this.minds.length = 0;
		for (const id of prev) {
			this.queue.setAiOn(id, false);
		}
		const resolved = await resolveBrowserModel(this.model || loadModelPref());
		if (!resolved) {
			console.warn('NPCDirector: no local model at', INFERENCE_BASE);
			this.pushLog('NPCDirector', `no local model at ${INFERENCE_BASE}`);
			this.world.setMessage('NPCs idle — start LM Studio on port 1234');
			return;
		}
		const model = resolved.id;
		this.catalog = resolved.catalog;
		const http = new HttpProvider({
			baseURL: INFERENCE_BASE,
			timeoutMs: 60_000,
			enableThinking: false,
			maxTokens: 1024,
			load: {
				flashAttention: true,
				offloadKvCacheToGpu: true,
				evalBatchSize: 512,
				parallel: this.queue.maxParallel,
			},
		});
		const queued = withQueue(http, 2);
		const provider:InferenceProvider = {
			chat: async (req) => {
				const name = whoFromMessages(req.messages) ?? this.model;
				const t0 = performance.now();
				try {
					const res = await queued.chat(req);
					const ms = Math.round(performance.now() - t0);
					this.recordInfer(ms, res);
					const parts = [`${ms}ms`];
					if (res.promptMs !== undefined) {
						parts.push(`ctx ${Math.round(res.promptMs)}ms`);
					}
					if (res.generateMs !== undefined) {
						parts.push(`gen ${Math.round(res.generateMs)}ms`);
					}
					if (res.cachedTokens) {
						parts.push(`cache ${res.cachedTokens}`);
					}
					if (res.toolCalls.length > 0) {
						parts.push(`tool ${res.toolCalls.map((c) => c.name).join(', ')}`);
					}
					if (res.content) {
						parts.push(res.content);
					}
					else if (res.toolCalls.length === 0) {
						parts.push('(empty content)');
					}
					this.pushLog(name, parts.join('\n'));
					return res;
				}
				catch (err:unknown) {
					const ms = Math.round(performance.now() - t0);
					this.recordInfer(ms, {});
					const text = err instanceof Error ? err.message : String(err);
					this.pushLog(name, `${ms}ms\n${text}`);
					throw err;
				}
			},
		};
		this.provider = provider;
		const pref = loadModelPref();
		this.model = pref && pref !== model ? pref : model;
		this.syncVision(this.model);
		if (!pref) {
			saveModelPref(this.model);
		}
		this.pushLog('NPCDirector', `using ${this.model}${this.vision ? ' (vision)' : ''}`);
		const seeds = this.sceneSeeds();
		for (const seed of seeds) {
			const mind = this.bootMind(seed, provider, this.model, this.storedAgents[seed.id]);
			if (mind) {
				this.minds.push(mind);
			}
		}
		if (this.minds.length === 0) {
			return;
		}
		this.ready = true;
		this.pushLog('NPCDirector', `${this.minds.map((m) => m.id).join(', ')} on ${this.model}${this.vision ? ' (vision)' : ''}`);
		console.info(`NPCDirector: ${this.minds.map((m) => m.id).join(', ')} on ${this.model}${this.vision ? ' (vision)' : ''}`);
	}

	private sceneSeeds():MindSeed[] {
		if (this.sceneID === 'glen') {
			return GLEN_SEEDS;
		}
		if (this.sceneID === 'marketplace') {
			return MARKET_SEEDS;
		}
		return MIND_SEEDS;
	}

	private applySeedAuthoring(agent:Agent<HostCtx>, seed:MindSeed, fresh:boolean):void {
		if (fresh) {
			agent.identity = {
				...seed.identity,
				traits: seed.identity.traits ? [...seed.identity.traits] : undefined,
			};
		}
		for (const mem of seed.memories) {
			if (!mem.pinned) {
				if (fresh) {
					agent.memory.add({
						category: 'episodic',
						text: mem.text,
						tags: mem.tags,
						pinned: false,
					}, 0);
				}
				continue;
			}
			const keyTags = mem.tags.slice(0, 2);
			const existing = agent.memory.pinned().find((row) => {
				if (keyTags.length === 0) {
					return false;
				}
				return keyTags.every((tag) => row.tags.includes(tag));
			});
			if (existing) {
				existing.text = mem.text;
				existing.tags = [...mem.tags];
				continue;
			}
			agent.memory.add({
				category: 'episodic',
				text: mem.text,
				tags: mem.tags,
				pinned: true,
			}, 0);
		}
	}

	private restoreCompanionHold(actor:GameObject, agent:Agent<HostCtx>):void {
		const bond = actor.getComponent(Companion);
		if (!bond) {
			return;
		}
		const pin = agent.memory.pinned().find((row) => (
			row.tags.includes('Player')
			&& (row.tags.includes('order') || row.tags.includes('follow') || row.tags.includes('identity'))
		));
		if (pin) {
			bond.hold = orderStations(pin.text);
		}
	}

	private bootMind(
		seed:MindSeed,
		provider:InferenceProvider,
		model:string,
		stored?:AgentJSON,
	):NPCMind | null {
		const actor = this.world.findByID(seed.id);
		if (!actor) {
			console.warn(`NPCDirector: no ${seed.id}`);
			this.pushLog('NPCDirector', `no ${seed.id} in the world`);
			return null;
		}
		const named = actor.getComponent(Named);
		if (named) {
			const noun = nounOf(actor);
			const given = roleMentionTitles(seed.identity.role).filter((t) => /^[A-Z][A-Za-z0-9]*$/.test(t));
			named.aliases = [...new Set([...(named.aliases ?? []), noun, seed.identity.name, ...given])];
		}
		const id = seed.id;
		this.inbox.set(id, []);
		const deps = this.agentDeps(id, provider, model);
		const agent = stored
			? Agent.fromJSON(stored, deps)
			: new Agent<HostCtx>({
				id,
				identity: seed.identity,
				goals: seed.goals.map((g) => ({ ...g })),
				...deps,
			});
		this.applySeedAuthoring(agent, seed, !stored);
		this.applySeedWatches(agent, seed, !stored);
		this.restoreCompanionHold(actor, agent);
		this.hookTalk(id, agent);
		const npc = actor.getComponent(NPCInput);
		if (npc) {
			npc.aiOn = true;
		}
		this.queue.ensure(id, {
			skipHeartbeat: seed.skipHeartbeat ?? false,
			skipMajor: seed.skipMajor ?? false,
		});
		this.queue.setWatches(id, agent.effectiveWatches());
		this.queue.setAiOn(id, true);
		return {
			id,
			agent,
			busy: false,
			aiOn: true,
			rank: seed.rank ?? DEFAULT_RANK,
			thoughtAt: Number.NEGATIVE_INFINITY,
			progressAt: 0,
			progressKey: '',
			note: '',
			label: '',
			labelUntil: 0,
			skipHeartbeat: seed.skipHeartbeat ?? false,
			skipMajor: seed.skipMajor ?? false,
			cache: new SampleCache(),
		};
	}

	private talkNames(id:string):string[] {
		const out:string[] = [];
		const add = (raw:string | undefined):void => {
			const name = raw?.trim();
			if (!name) {
				return;
			}
			if (out.some((row) => row.toLowerCase() === name.toLowerCase())) {
				return;
			}
			out.push(name);
		};
		add(id);
		const go = findBody(this.world, id);
		const named = go?.getComponent(Named);
		add(named?.id);
		for (const alias of named?.aliases ?? []) {
			add(alias);
		}
		add(this.mindByID(id)?.agent.identity.name);
		for (const title of roleMentionTitles(this.mindByID(id)?.agent.identity.role ?? '')) {
			add(title);
		}
		return out;
	}

	private hookTalk(id:string, agent:Agent<HostCtx>):void {
		this.talk.attach({
			id,
			pushEvent: (event) => {
				const list = this.inbox.get(id) ?? [];
				const stamped = { ...event, at: event.at ?? this.world.time };
				agent.pushEvent(stamped);
				list.push(stamped);
				if (list.length > EVENT_CAP) {
					list.splice(0, list.length - EVENT_CAP);
				}
				this.inbox.set(id, list);
				if (stamped.major) {
					this.wakeMind(id);
					this.queue.enqueueMajor(id, true);
				}
			},
		});
	}

	private agentDeps(id:string, provider:InferenceProvider, model:string):AgentDeps<HostCtx> {
		const director = this;
		const companion = !!director.world.findByID(id)?.getComponent(Companion);
		const seed = director.sceneSeeds().find((s) => s.id === id);
		return {
			provider,
			verbs: registerCoreVerbs(new VerbRegistry())
				.add('give', { item: 'id', to: 'id' })
				.add('buy', { item: 'id', from: 'id', offer: 'number?' })
				.add('sell', { item: 'id', to: 'id', ask: 'number?' })
				.add('steal', { item: 'id', from: 'id' })
				.add('set_status', { text: 'string', seconds: 'number?' })
				.add('rest', {}),
			recipe: recipe(director),
			context: () => {
				const body = director.world.findByID(id);
				if (!body) {
					throw new Error(`missing body ${id}`);
				}
				return { world: director.world, actor: body, director };
			},
			catalog: (ctx) => director.catalogForMind(id, ctx.actor),
			model,
			heartbeat: 0,
			strategicInterval: companion ? 0 : 10_000,
			toolRoundCap: 0,
			planRetryCap: PLAN_RETRY_CAP,
			talk: this.talk,
			map: {
				you: YOU_SYMBOL,
				snapshot: (npcID, zoom, prev) => {
					const snap = snapshotMap(director.world, npcID, zoom, prev);
					if (snap && 'marks' in snap) {
						void director.logLook(npcID, zoom, snap);
					}
					return snap;
				},
			},
			vision: this.vision,
			watchesWritable: seed?.watchesWritable ?? true,
			pinnedWatches: seed?.pinnedWatches ?? { hurt: 'isHurt(me)' },
		};
	}

	private applySeedWatches(agent:Agent<HostCtx>, seed:MindSeed, fresh:boolean):void {
		if (seed.watchesWritable !== undefined) {
			agent.watchesWritable = seed.watchesWritable;
		}
		if (seed.pinnedWatches !== undefined) {
			agent.pinnedWatches = { ...seed.pinnedWatches };
		}
		const pinNames = new Set(Object.keys(agent.pinnedWatches).map((n) => n.trim().toLowerCase()));
		const extras:Watches = {};
		for (const [name, expr] of Object.entries(seed.watches ?? {})) {
			if (!pinNames.has(name.trim().toLowerCase())) {
				extras[name] = expr;
			}
		}
		if (seed.watchesWritable === false) {
			agent.watches = extras;
			return;
		}
		if (fresh && seed.watches) {
			agent.watches = extras;
		}
	}

	exportAgents():Record<string, AgentJSON> {
		const out:Record<string, AgentJSON> = {};
		for (const mind of this.minds) {
			out[mind.id] = mind.agent.toJSON();
		}
		return out;
	}

	restoreAgents(agents:Record<string, AgentJSON>):void {
		this.storedAgents = JSON.parse(rewriteRetiredFeeNames(JSON.stringify(agents))) as Record<string, AgentJSON>;
		this.doorOpen.clear();
		this.chestOpen.clear();
		if (!this.provider || !this.model) {
			return;
		}
		for (const mind of this.minds) {
			const json = this.storedAgents[mind.id];
			if (!json) {
				continue;
			}
			this.talk.detach(mind.id);
			const remapped = JSON.parse(rewriteRetiredFeeNames(JSON.stringify(json))) as AgentJSON;
			mind.agent = Agent.fromJSON(remapped, this.agentDeps(mind.id, this.provider, this.model));
			const seed = this.sceneSeeds().find((s) => s.id === mind.id);
			if (seed) {
				this.applySeedAuthoring(mind.agent, seed, false);
				this.applySeedWatches(mind.agent, seed, false);
			}
			const body = this.world.findByID(mind.id);
			if (body) {
				this.restoreCompanionHold(body, mind.agent);
			}
			this.hookTalk(mind.id, mind.agent);
			mind.busy = false;
			this.queue.setWatches(mind.id, mind.agent.effectiveWatches());
			this.queue.setAiOn(mind.id, mind.aiOn);
		}
	}

	private lookupGo(id:string):GameObject | undefined {
		return this.world.findNamed(id) ?? this.world.findByID(id);
	}

	private poseOf(id:string):{ x:number; z:number } | undefined {
		const go = this.lookupGo(id);
		if (go) {
			const p = go.transform.position;
			return { x: p.x, z: p.z };
		}
		const now = this.world.time;
		const fact = this.posedEvents.find((e) => e.id === id && (e.until === undefined || e.until > now));
		if (!fact) {
			return undefined;
		}
		return { x: fact.x, z: fact.z };
	}

	private catalogForMind(id:string, actor:GameObject):Catalog {
		const mind = this.mindByID(id);
		const cache = mind?.cache ?? new SampleCache();
		const hidePlayer = this.world.playerInperceivable;
		const me = entityOf(actor);
		const others:ExprEntity[] = [];
		const items:ExprEntity[] = [];
		const bindings:Record<string, ExprVal> = {};
		for (const go of this.world.objects) {
			if (go.getComponent(HumanBody)) {
				const name = bodyName(go);
				if (name === id) {
					continue;
				}
				if (hidePlayer && go.id === 'Player') {
					continue;
				}
				others.push(entityOf(go));
			}
			if ((go.getComponent(Pickupable) || go.getComponent(Item)) && !go.getComponent(HumanBody)) {
				items.push(entityOf(go));
			}
			if (
				go.getComponent(Door)
				|| go.getComponent(Bridge)
				|| go.getComponent(Chest)
				|| go.getComponent(Interior)
			) {
				const name = bodyName(go);
				bindings[name] = { kind: 'entity', value: entityOf(go) };
			}
		}
		if (!hidePlayer) {
			const player = this.world.findByID('Player');
			if (player) {
				bindings.Player = { kind: 'entity', value: entityOf(player) };
			}
		}
		const now = this.world.time;
		const facts = this.posedEvents.filter((e) => e.until === undefined || e.until > now);
		bindings.events = {
			kind: 'list',
			value: facts.map((e) => ({
				kind: 'entity' as const,
				value: dummyEntity(e.id, { tags: e.tags }),
			})),
		};
		const lastAt = mind?.agent.lastTacticalAt;
		const last = mind?.agent.lastResult;
		return buildCatalog({
			me,
			others,
			items,
			cache,
			bindings,
			distance: (a, b) => {
				const pa = this.poseOf(a.id);
				const pb = this.poseOf(b.id);
				if (!pa || !pb) {
					return undefined;
				}
				return Math.hypot(pa.x - pb.x, pa.z - pb.z);
			},
			nearRadius: NEAR_RADIUS,
			canSee: (a, b) => talkCanSee(this.world, a.id, b.id),
			facing: (a, b) => {
				const from = this.lookupGo(a.id);
				const pb = this.poseOf(b.id);
				if (!from || !pb) {
					return 0;
				}
				return facingToward(from, pb.x, pb.z);
			},
			inventory: (who) => {
				const go = this.lookupGo(who.id);
				if (!go) {
					return [];
				}
				return listCarried(go).map(itemEntity);
			},
			hp: (who) => {
				const go = this.lookupGo(who.id);
				const vitals = go?.getComponent(Vitals);
				if (!vitals) {
					return undefined;
				}
				return { hp: vitals.hp, maxHP: vitals.maxHP };
			},
			isOpen: (who) => {
				const go = this.lookupGo(who.id);
				if (!go) {
					return undefined;
				}
				const door = go.getComponent(Door);
				if (door) {
					return door.open;
				}
				const bridge = go.getComponent(Bridge);
				if (bridge) {
					return bridge.open;
				}
				const chest = go.getComponent(Chest);
				if (chest) {
					return chest.open;
				}
				return undefined;
			},
			hasHeard: this.mindHasHeard(id),
			prevThought: lastAt !== undefined && Number.isFinite(lastAt)
				? { secondsAgo: Math.max(0, now - lastAt) }
				: undefined,
			prevActions: last
				? [{
					secondsAgo: lastAt !== undefined && Number.isFinite(lastAt) ? Math.max(0, now - lastAt) : 0,
					isOk: last.ok,
					reason: last.reason ?? '',
					verb: last.verb ?? '',
				}]
				: [],
			stringifiers: EXPR_STRINGIFIERS,
			stringifierKind: exprKind,
			hostFns: {
				isInside: (args, ctx) => {
					let who = ctx.catalog.me;
					let buildingID:string | undefined;
					const a0 = args[0];
					const a1 = args[1];
					if (a0?.kind === 'entity') {
						const go = this.lookupGo(a0.value.id);
						if (go?.getComponent(Interior)) {
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
					const body = this.lookupGo(who.id);
					if (!body) {
						return { kind: 'bool', value: false };
					}
					const p = body.transform.position;
					if (buildingID) {
						const building = this.world.findNamed(buildingID) ?? this.world.findByID(buildingID);
						const box = building?.getComponent(Interior);
						return { kind: 'bool', value: !!box && interiorContains(box, p.x, p.z) };
					}
					return { kind: 'bool', value: !!enclosureAt(this.world, p.x, p.z) };
				},
			},
		});
	}

	private mindHasHeard(id:string):boolean {
		const now = this.world.time;
		const inbox = this.inbox.get(id) ?? [];
		return inbox.some((e) => {
			if (e.kind !== 'HeardSpeech') {
				return false;
			}
			const at = e.at ?? now;
			return now - at <= HEARD_WINDOW;
		});
	}

	private httpInFlight():number {
		return this.minds.filter((m) => m.busy).length;
	}

	private upsertPosed(fact:PosedFact):void {
		const i = this.posedEvents.findIndex((e) => e.id === fact.id);
		if (i >= 0) {
			this.posedEvents[i] = fact;
			return;
		}
		this.posedEvents.push(fact);
	}

	private syncPosedEvents():void {
		const now = this.world.time;
		const live = new Set<string>();
		this.world.forEachComponent(Wanted, (mark, go) => {
			if (!mark.enabled) {
				return;
			}
			const id = `Theft:${bodyName(go)}`;
			live.add(id);
			const p = go.transform.position;
			this.upsertPosed({ id, tags: ['theft', 'event'], x: p.x, z: p.z });
		});
		this.posedEvents = this.posedEvents.filter((e) => {
			if (e.until !== undefined && e.until <= now) {
				return false;
			}
			if (e.tags.includes('theft') && !live.has(e.id)) {
				return false;
			}
			return true;
		});
	}

	observe(dt = 0):void {
		this.world.forEachComponent(Door, (door, go) => {
			const name = go.getComponent(Named)?.id ?? go.id;
			const was = this.doorOpen.get(name);
			if (was === undefined) {
				this.doorOpen.set(name, door.open);
				return;
			}
			if (door.open && !was) {
				this.pushEvent({
					kind: 'DoorOpened',
					text: `${name} opened`,
					tags: ['door', name],
					major: true,
				});
				if (name === 'EastGate') {
					this.setGoals('Captain', 'EastGate is open. Walk through it. Give GoldCoin to Alchemist only if you still carry it. Then go_to(LinaCot). Do not stand in the doorway.', 3);
					this.setGoals('Herbalist', 'EastGate is open. Walk through it. go_to(Bitterroot), pick_up(Bitterroot), give(Bitterroot, Alchemist) at BrewHearth.', 3);
					this.setGoals('Alchemist', 'EastGate is open. Walk through it to BrewHearth. If you already hold GoldCoin, wait only for Bitterroot, then use(Bitterroot, BrewHearth).', 3);
				}
			}
			this.doorOpen.set(name, door.open);
		});
		this.world.forEachComponent(Chest, (chest, go) => {
			const name = go.getComponent(Named)?.id ?? go.id;
			const was = this.chestOpen.get(name);
			if (was === undefined) {
				this.chestOpen.set(name, chest.open);
				return;
			}
			if (chest.open && !was) {
				this.afterChestOpen(go);
			}
			this.chestOpen.set(name, chest.open);
		});
		this.world.forEachComponent(SpeechBubble, (bubble, go) => {
			if (go.getComponent(Celebrating)) {
				return;
			}
			if (bubble.text && this.world.time >= bubble.until) {
				bubble.text = '';
			}
		});
		this.checkBargain();
		this.tickMarket();
		this.hearIfClose();
		this.syncPosedEvents();
		this.unstickRested();
		this.tickThinkQueue(dt);
		this.publishDebug();
	}

	private tickThinkQueue(dt:number):void {
		const catalogs = new Map<string, Catalog>();
		for (const mind of this.minds) {
			if (!mind.aiOn) {
				continue;
			}
			const actor = this.world.findByID(mind.id);
			if (!actor) {
				continue;
			}
			catalogs.set(mind.id, this.catalogForMind(mind.id, actor));
		}
		const rows = this.queue.tick(dt, catalogs, this.httpInFlight());
		this.readyThink.push(...rows);
		for (const mind of this.minds) {
			mind.cache.commit();
		}
	}

	pulse():void {
		if (this.disposed) {
			return;
		}
		if (!this.ready) {
			if (!this.connecting && this.world.time >= this.nextTryAt) {
				void this.start();
			}
			return;
		}
		this.readyThink.sort((a, b) => {
			const score = this.queue.rankScore(b.npcID, b.score) - this.queue.rankScore(a.npcID, a.score);
			if (score !== 0) {
				return score;
			}
			const mindA = this.mindByID(a.npcID);
			const mindB = this.mindByID(b.npcID);
			return (mindB?.rank ?? 0) - (mindA?.rank ?? 0);
		});
		let slots = Math.max(0, this.queue.maxParallel - this.httpInFlight());
		const held:ThinkRow[] = [];
		for (const row of this.readyThink) {
			const mind = this.mindByID(row.npcID);
			if (!mind || !mind.aiOn || mind.busy || slots <= 0) {
				if (mind?.aiOn) {
					held.push(row);
				}
				continue;
			}
			const go = this.world.findByID(mind.id);
			const npc = go?.getComponent(NPCInput);
			if (this.acting.has(mind.id)) {
				if (row.reason === 'major' || (row.reason === 'watch' && this.queue.rankScore(row.npcID, row.score) >= 0.5)) {
					npc?.interrupt('urgent');
					go?.getComponent(Celebrating)?.stop();
				}
				held.push(row);
				continue;
			}
			if ((row.reason === 'heartbeat' || row.reason === 'action') && npc?.busy()) {
				held.push(row);
				continue;
			}
			this.queue.drop(mind.id);
			this.runMind(mind);
			slots -= 1;
		}
		this.readyThink.length = 0;
		this.readyThink.push(...held);
	}

	rest(id:string):ActionResult {
		const mind = this.mindByID(id);
		if (!mind) {
			return { ok: false, verb: 'rest', reason: 'no mind' };
		}
		mind.note = this.goalDone(id) ? `${id}: idle` : `${id}: easing`;
		return { ok: true, verb: 'rest', reason: this.goalDone(id) ? 'done — still listening' : 'goal still open' };
	}

	private wakeMind(id:string):void {
		const mind = this.mindByID(id);
		if (!mind) {
			return;
		}
		const go = this.world.findByID(mind.id);
		go?.getComponent(Celebrating)?.stop();
		if (!mind.aiOn) {
			mind.aiOn = true;
			this.queue.setAiOn(mind.id, true);
			const npc = go?.getComponent(NPCInput);
			if (npc) {
				npc.aiOn = true;
			}
			mind.note = `${id}: woke`;
		}
	}

	private goalDone(id:string):boolean {
		if (this.sceneID === 'glen') {
			if (id === 'Miller') {
				return this.carries('Miller', 'FireMushroom');
			}
			if (id === 'Forager') {
				return this.carries('Forager', 'SilverTrout');
			}
			if (id === 'Angler') {
				const angler = this.world.findByID('Angler');
				return !!angler && !this.carries('Angler', 'SilverTrout') && angler.transform.position.z < 20;
			}
			return false;
		}
		if (this.sceneID === 'marketplace') {
			return false;
		}
		if (id === 'Herbalist') {
			return this.cotTended('NollCot');
		}
		if (id === 'Captain') {
			return this.cotTended('LinaCot');
		}
		if (id === 'Alchemist') {
			return this.cotTended('NollCot')
				&& this.cotTended('LinaCot')
				&& this.carries('Alchemist', 'GoldCoin');
		}
		return false;
	}

	private bridgeOpen():boolean {
		let open = false;
		this.world.forEachComponent(Bridge, (span) => {
			if (span.open) {
				open = true;
			}
		});
		return open;
	}

	/** Goal-done used to freeze minds (`aiOn = false`). Bring those back. */
	private unstickRested():void {
		for (const mind of this.minds) {
			if (!mind.aiOn) {
				this.wakeMind(mind.id);
			}
		}
	}

	private runMind(mind:NPCMind):void {
		this.queue.clearOnce(mind.id);
		mind.busy = true;
		mind.thoughtAt = this.world.time;
		mind.note = `${mind.id} is thinking...`;
		this.world.findByID(mind.id)?.getComponent(Celebrating)?.stop();
		const agent = mind.agent;
		void agent.tick(this.world.time)
			.then(async (plan) => {
				this.queue.setWatches(mind.id, agent.effectiveWatches());
				if (!plan) {
					mind.busy = false;
					if (mind.note === `${mind.id} is thinking...`) {
						mind.note = '';
					}
					this.queue.noteResult(mind.id, true);
					return;
				}
				if (mind.aiOn) {
					mind.note = `${mind.id}: ${formatPlan(plan)}`;
				}
				this.pushLog(mind.id, formatPlan(plan));
				const body = this.world.findByID(mind.id);
				if (!body || !mind.aiOn) {
					mind.busy = false;
					this.queue.noteResult(mind.id, true);
					return;
				}
				this.acting.add(mind.id);
				mind.busy = false;
				this.revealChosenName(mind);
				try {
					const result = await runPlan(plan, (step) => executeStep(step, { world: this.world, actor: body, director: this }));
					this.revealChosenName(mind);
					agent.ingestResult(result);
					this.noteThinkResult(mind, plan, result);
				}
				finally {
					this.acting.delete(mind.id);
				}
			})
			.catch((err:unknown) => {
				const text = err instanceof Error ? err.message : String(err);
				mind.note = `${mind.id} stalled: ${text}`;
				this.pushLog(mind.id, `stalled: ${text}`);
				console.error(`npc tick ${mind.id}`, err);
				this.queue.noteResult(mind.id, true);
			})
			.finally(() => {
				mind.busy = false;
			});
	}

	private noteThinkResult(mind:NPCMind, plan:ActionPlan, result:ActionResult):void {
		const verb = result.verb ?? plan.head.verb ?? '';
		const key = stepKey(plan, result);
		if (result.ok && (PROGRESS_VERBS.has(verb) || verb === 'go_to' || verb === 'follow')) {
			mind.progressAt = this.world.time;
			mind.progressKey = key;
		}
		const stalled = !result.ok || !!result.interrupted || STALL_VERBS.has(verb);
		this.queue.noteResult(mind.id, stalled);
		if (!result.interrupted) {
			this.queue.enqueuePlan(mind.id, plan, result.ok);
		}
		const status = result.ok ? (result.reason || 'ok') : `failed — ${result.reason ?? 'error'}`;
		if (mind.aiOn) {
			mind.note = `${mind.id}: ${verb} ${status}`;
		}
		this.pushLog(mind.id, `${verb} ${status}`.trim());
		console.info(`npc ${mind.id}`, verb, result.ok, result.reason, formatPlan(plan));
	}

	pushEvent(event:AgentEvent):void {
		const stamped = { ...event, at: event.at ?? this.world.time };
		for (const mind of this.minds) {
			const list = this.inbox.get(mind.id) ?? [];
			list.push(stamped);
			if (list.length > EVENT_CAP) {
				list.splice(0, list.length - EVENT_CAP);
			}
			this.inbox.set(mind.id, list);
			if (stamped.major) {
				mind.agent.pushEvent(stamped);
				const urgent = eventIsUrgent(stamped);
				if (urgent) {
					this.wakeMind(mind.id);
				}
				if (mind.aiOn) {
					this.queue.enqueueMajor(mind.id, urgent);
				}
			}
		}
	}

	takeEvents(who:string):string {
		const list = this.inbox.get(who);
		if (!list || list.length === 0) {
			return 'None.';
		}
		const lines = list.map((e) => `${e.kind}: ${e.text}`);
		list.length = 0;
		return lines.join('\n');
	}

	afterUnlock(door?:GameObject):void {
		const name = door?.getComponent(Named)?.id ?? door?.id ?? 'EastGate';
		this.pushEvent({
			kind: 'DoorOpened',
			text: `${name} opened`,
			tags: ['door', name],
			major: true,
		});
		if (name !== 'EastGate') {
			return;
		}
		this.setGoals('Captain', 'EastGate is open. Walk through it. Give GoldCoin to Alchemist only if you still carry it. Then go_to(LinaCot). Do not stand in the doorway.', 3);
		this.setGoals('Herbalist', 'EastGate is open. Walk through it. go_to(Bitterroot), pick_up(Bitterroot), give(Bitterroot, Alchemist) at BrewHearth.', 3);
		this.setGoals('Alchemist', 'EastGate is open. Walk through it to BrewHearth. If you already hold GoldCoin, wait only for Bitterroot, then use(Bitterroot, BrewHearth).', 3);
	}

	afterLocked(actor:GameObject, reason:string):void {
		if (!actor.getComponent(Companion)) {
			return;
		}
		const who = bodyName(actor);
		const now = this.world.time;
		if ((this.lockNudgeAt.get(who) ?? 0) + 8 > now) {
			return;
		}
		this.lockNudgeAt.set(who, now);
		const doorName = reason.match(/^(\S+) is locked/)?.[1] ?? '';
		const door = doorName ? this.world.findNamed(doorName) : undefined;
		const keyID = door?.getComponent(Lock)?.keyID ?? '';
		const found = keyID ? findKeyFor(this.world, keyID) : null;
		const master = actor.getComponent(Companion)?.targetID ?? 'Player';
		let extra = `${doorName || 'The door'} is locked. If ${master} holds the key, say() and ask them to give() it. Otherwise find the key, pick_up, and use it on the door.`;
		if (found && found.holder === who) {
			extra = `use(${found.name}, ${doorName}) now, then go in.`;
		}
		else if (found && (found.holder === master || found.holder === 'Player')) {
			extra = `${doorName} is locked. ${found.holder} holds ${found.name}. `
				+ `say() to ${found.holder}: ask them to give(${found.name}) to you. `
				+ `You cannot take from their pack. After they give it, use(${found.name}, ${doorName}) and go in.`;
		}
		else if (found && !found.holder) {
			extra = `${doorName} is locked. go_to(${found.name}), pick_up(${found.name}), then use(${found.name}, ${doorName}).`;
		}
		else if (found?.holder) {
			extra = `${doorName} is locked. ${found.holder} holds ${found.name}. `
				+ `say() and ask them to give(${found.name}). Then use(${found.name}, ${doorName}).`;
		}
		this.keepOrderGoal(who, extra, 4);
	}

	afterNeedItem(actor:GameObject, itemName:string):void {
		const bond = actor.getComponent(Companion);
		if (!bond) {
			return;
		}
		const who = bodyName(actor);
		const now = this.world.time;
		if ((this.lockNudgeAt.get(who) ?? 0) + 8 > now) {
			return;
		}
		this.lockNudgeAt.set(who, now);
		const master = this.world.findByID(bond.targetID);
		if (master && findCarried(master, (it) => itemMatchesName(it, itemName))) {
			this.keepOrderGoal(
				who,
				`${bond.targetID} is carrying ${itemName}. say() to ${bond.targetID} and ask them to give(${itemName}) to you. `
					+ `You cannot take it from their pack. Then use it.`,
				4,
			);
			return;
		}
		const floor = this.world.findNamed(itemName);
		if (floor?.getComponent(Pickupable)) {
			this.keepOrderGoal(who, `go_to(${itemName}), pick_up(${itemName}), then use it.`, 4);
		}
	}

	afterChestOpen(chest:GameObject):void {
		const name = chest.getComponent(Named)?.id ?? chest.id;
		this.pushEvent({
			kind: 'ChestOpened',
			text: `${name} opened`,
			tags: ['chest', name],
			major: true,
		});
		this.stampMemory(`${name} opened`, ['chest', name]);
		if (name === 'ArmoryChest' && this.eastGateLocked()) {
			this.setGoals('Captain', 'ArmoryChest is open. pick_up(BrassKey), then use(BrassKey, EastGate).', 3);
			this.setGoals('Alchemist', 'The chest is open. Tell Captain to pick_up(BrassKey) and use(BrassKey, EastGate).', 3);
			this.setGoals('Herbalist', 'ArmoryChest is open. Wait for Captain to unlock EastGate.', 3);
		}
	}

	afterPickUp(actor:GameObject, name:string):void {
		this.pushEvent({
			kind: 'PickedUp',
			text: `${bodyName(actor)} picked up ${name}`,
			tags: ['item', name, bodyName(actor)],
			major: true,
		});
		if (compactName(name) === compactName('BrassKey') && this.eastGateLocked()) {
			if (actorIs(actor, 'Captain')) {
				this.setGoals('Captain', 'use(BrassKey, EastGate) now. Then enter the vault.', 3);
			}
			else {
				this.setGoals(actor.id, `give(BrassKey, Captain) now so they can open EastGate.`, 3);
				this.setGoals('Captain', 'Take BrassKey and use(BrassKey, EastGate).', 3);
			}
		}
		if (actorIs(actor, 'Herbalist') && compactName(name) === compactName('Bitterroot')) {
			this.setGoals('Herbalist', 'Give Bitterroot to Alchemist at BrewHearth. Do not brew. Do not drink it.', 3);
			this.setGoals('Alchemist', 'Herbalist harvested Bitterroot. Ask them to give it to you. You still need GoldCoin from Captain before you brew at BrewHearth.', 3);
		}
		if (actorIs(actor, 'Forager') && compactName(name) === compactName('FireMushroom')) {
			this.setGoals('Forager', 'Give FireMushroom to Miller. Do not cross the river yourself unless you must.', 3);
			this.setGoals('Miller', 'Forager harvested FireMushroom. Ask them to give it to you. Then use MillCrank on MillLever.', 3);
		}
		if (this.sceneID === 'marketplace') {
			this.afterMarketPickUp(actor, name);
		}
	}

	afterGive(from:GameObject, to:GameObject, item:string):void {
		this.pushEvent({
			kind: 'Given',
			text: `${bodyName(from)} gave ${item} to ${bodyName(to)}`,
			tags: ['give', item, bodyName(from), bodyName(to)],
			major: true,
		});
		if (this.sceneID === 'glen') {
			this.nudgeGlen();
		}
		else if (this.sceneID === 'marketplace') {
			this.afterTrade(to, from, item, 0);
		}
		else {
			this.nudgeBargain();
		}
	}

	afterPay(from:GameObject, to:GameObject, amount:number):void {
		this.pushEvent({
			kind: 'Given',
			text: `${bodyName(from)} gave ${amount} gold to ${bodyName(to)}`,
			tags: ['give', 'gold', bodyName(from), bodyName(to)],
			major: true,
		});
		if (this.sceneID === 'marketplace') {
			this.nudgeMarketPerson(to);
		}
	}

	afterBridge():void {
		this.pushEvent({
			kind: 'BridgeLowered',
			text: 'Miller lowered MillBridge. The river can be crossed.',
			tags: ['MillBridge', 'Miller'],
			major: true,
		});
		const bridge = this.world.findByID('MillBridge') ?? this.world.findNamed('MillBridge');
		if (bridge) {
			const p = bridge.transform.position;
			this.upsertPosed({
				id: 'BridgeLowered',
				tags: ['bridge', 'event'],
				x: p.x,
				z: p.z,
				until: this.world.time + 16,
			});
		}
		this.setGoals('Miller', 'Keep FireMushroom. Let Angler cross. Do not take SilverTrout.', 3);
	}

	afterBrew(actor:GameObject, reason:string):void {
		this.pushEvent({
			kind: 'Brewed',
			text: `${bodyName(actor)} ${reason}`,
			tags: ['brew', 'MagicPotion', 'BrewHearth'],
			major: true,
		});
		this.setGoals('Alchemist', 'Give one MagicPotion to Herbalist and one MagicPotion to Captain. Keep GoldCoin. Do not drink the vials.', 3);
		this.setGoals('Herbalist', 'Alchemist brewed at BrewHearth. Take one MagicPotion and use(MagicPotion, NollCot). Do not drink it.', 3);
		this.setGoals('Captain', 'Alchemist brewed at BrewHearth. Take one MagicPotion and use(MagicPotion, LinaCot). Do not drink it.', 3);
	}

	afterTend(actor:GameObject, cot:GameObject):void {
		const cotName = cot.getComponent(Named)?.id ?? cot.id;
		this.pushEvent({
			kind: 'Tended',
			text: `${bodyName(actor)} tended ${cotName}`,
			tags: ['cot', cotName, bodyName(actor)],
			major: true,
		});
		if (cotName === 'NollCot') {
			this.setGoals('Herbalist', 'Noll is tended. Stay in the vault. Do not take the other vial.', 3);
		}
		if (cotName === 'LinaCot') {
			this.setGoals('Captain', 'Lina is tended. Stay in the vault. Do not take the other vial.', 3);
		}
	}

	afterPotion(actor:GameObject):void {
		this.pushEvent({
			kind: 'PotionTaken',
			text: `${bodyName(actor)} took MagicPotion`,
			tags: ['MagicPotion', bodyName(actor)],
			major: true,
		});
	}

	afterTrade(buyer:GameObject, seller:GameObject, item:string, price:number):void {
		if (price > 0) {
			this.pushEvent({
				kind: 'Bought',
				text: `${bodyName(buyer)} bought ${item} from ${bodyName(seller)} for ${price} gold`,
				tags: ['buy', item, bodyName(buyer), bodyName(seller)],
				major: true,
			});
		}
		noteWant(buyer, item);
		this.nudgeMarketPerson(buyer);
	}

	private tickMarket():void {
		if (this.sceneID !== 'marketplace') {
			return;
		}
		this.seizeNearby();
		this.world.forEachComponent(Crowd, (crowd, go) => {
			if (crowd.kind !== 'customer') {
				return;
			}
			if (go.getComponent(Wanted)?.enabled) {
				return;
			}
			if (crowd.wants.length === 0 && !crowd.leaving) {
				crowd.leaving = true;
				const gate = crowd.leaveGate || 'EastGate';
				this.setGoals(bodyName(go), `You have what you came for. go_to(${gate}) now and leave. Do not linger.`, 3);
			}
		});
		const doomed:GameObject[] = [];
		this.world.forEachComponent(CrowdExit, (_exit, gate) => {
			this.world.forEachComponent(Crowd, (crowd, go) => {
				if (crowd.kind !== 'customer' || crowd.wants.length > 0) {
					return;
				}
				if (go.getComponent(Wanted)?.enabled) {
					return;
				}
				if (crowd.leaveGate && bodyName(gate) !== crowd.leaveGate) {
					return;
				}
				if (distXZ(go, gate) <= USE_RANGE) {
					doomed.push(go);
				}
			});
		});
		for (const go of doomed) {
			this.despawnNPC(go);
		}
		if (this.world.time < this.nextCrowdAt) {
			return;
		}
		this.nextCrowdAt = this.world.time + 10 + Math.random() * 12;
		if (customerCount(this.world) >= 4) {
			return;
		}
		if (Math.random() < 0.35) {
			return;
		}
		const spawned = spawnRandomCustomer(this.world);
		if (!spawned) {
			return;
		}
		this.pushEvent({
			kind: 'Arrived',
			text: `${spawned.seed.id} arrived from the street`,
			tags: [spawned.seed.id, 'crowd'],
			major: true,
		});
		if (!this.provider || !this.model) {
			return;
		}
		const mind = this.bootMind(spawned.seed, this.provider, this.model);
		if (mind) {
			this.minds.push(mind);
		}
	}

	private nudgeMarketPerson(go:GameObject):void {
		const crowd = go.getComponent(Crowd);
		if (!crowd || crowd.kind !== 'customer') {
			return;
		}
		if (go.getComponent(Wanted)?.enabled) {
			return;
		}
		if (crowd.wants.length > 0) {
			this.setGoals(
				bodyName(go),
				`Still need ${crowd.wants.join(' and ')}. Buy what you came for. Then leave through ${crowd.leaveGate || 'EastGate'}.`,
				3,
			);
			return;
		}
		if (!crowd.leaving) {
			crowd.leaving = true;
		}
		const gate = crowd.leaveGate || 'EastGate';
		this.setGoals(bodyName(go), `You have what you came for. go_to(${gate}) now and leave. Do not linger.`, 3);
	}

	private despawnNPC(go:GameObject):void {
		const id = bodyName(go);
		this.talk.detach(id);
		const i = this.minds.findIndex((m) => m.id === id);
		if (i >= 0) {
			this.minds.splice(i, 1);
		}
		this.queue.setAiOn(id, false);
		this.inbox.delete(id);
		this.world.remove(go);
		this.pushEvent({
			kind: 'Left',
			text: `${id} left through the gate`,
			tags: [id, 'gate'],
			major: true,
		});
		this.world.setMessage(`${id} left the market`);
	}

	reportTheft(thief:GameObject, item:string, fromID:string, reason:string):void {
		if (this.sceneID !== 'marketplace') {
			return;
		}
		if (thief.getComponent(Crowd)?.kind === 'guard') {
			return;
		}
		let mark = thief.getComponent(Wanted);
		if (!mark) {
			mark = thief.addComponent(new Wanted());
		}
		mark.enabled = true;
		mark.reason = reason;
		if (fromID) {
			mark.fromID = fromID;
		}
		if (!mark.items.some((it) => compactName(it) === compactName(item))) {
			mark.items.push(item);
		}
		const who = bodyName(thief);
		this.pushEvent({
			kind: 'Theft',
			text: `${who} ${reason}: ${item}${fromID ? ` from ${fromID}` : ''}`,
			tags: ['steal', item, who, fromID],
			major: true,
		});
		const p = thief.transform.position;
		this.upsertPosed({ id: `Theft:${who}`, tags: ['theft', 'event'], x: p.x, z: p.z });
		this.world.setMessage(`Theft — ${who} took ${item}`);
	}

	private afterMarketPickUp(actor:GameObject, name:string):void {
		if (actor.getComponent(Crowd)?.kind === 'guard') {
			return;
		}
		const owner = this.stallOwner(name);
		if (!owner) {
			return;
		}
		if (bodyName(actor) === bodyName(owner)) {
			return;
		}
		this.reportTheft(actor, name, bodyName(owner), 'took unpaid stall goods');
	}

	private stallOwner(itemName:string):GameObject | undefined {
		let owner:GameObject | undefined;
		this.world.forEachComponent(Merchant, (shop, go) => {
			if (compactName(shop.specialty) === compactName(itemName)) {
				owner = go;
			}
		});
		return owner;
	}

	private seizeNearby():void {
		this.world.forEachComponent(Crowd, (crowd, guard) => {
			if (crowd.kind !== 'guard') {
				return;
			}
			this.world.forEachComponent(Wanted, (mark, thief) => {
				if (!mark.enabled) {
					return;
				}
				if (distXZ(guard, thief) <= USE_RANGE) {
					this.catchThief(guard, thief);
				}
			});
		});
	}

	private catchThief(guard:GameObject, thief:GameObject):void {
		const mark = thief.getComponent(Wanted);
		if (!mark?.enabled) {
			return;
		}
		const seized:string[] = [];
		for (const name of [...mark.items]) {
			const stock = findItem(thief, name);
			if (!stock) {
				continue;
			}
			const gift = takeOne(thief, stock);
			this.returnGoods(gift, mark.fromID, guard);
			seized.push(pascalCase(gift.name) || gift.name);
		}
		mark.enabled = false;
		mark.items = [];
		mark.reason = '';
		const who = bodyName(thief);
		const watch = bodyName(guard);
		const loot = seized.length > 0 ? seized.join(' and ') : 'the goods';
		this.showSpeech(guard, `That's stolen. ${loot} goes back.`);
		this.pushEvent({
			kind: 'Caught',
			text: `${watch} caught ${who} and took ${loot} back`,
			tags: ['steal', watch, who],
			major: true,
		});
		this.world.setMessage(`${watch} caught ${who} stealing`);
		const crowd = thief.getComponent(Crowd);
		if (crowd?.kind === 'customer') {
			crowd.wants = [];
			crowd.leaving = true;
			const gate = crowd.leaveGate || 'EastGate';
			this.setGoals(who, `The watch caught you. go_to(${gate}) and leave. Do not steal again.`, 3);
			const npc = thief.getComponent(NPCInput);
			if (npc && npc.headingTo() !== gate) {
				void npc.goTo(gate);
			}
		}
		const post = guard.getComponent(Crowd)?.leaveGate || 'WestGate';
		const postNPC = guard.getComponent(NPCInput);
		if (postNPC && postNPC.headingTo() !== post) {
			void postNPC.goTo(post);
		}
	}

	private returnGoods(item:ItemInstance, fromID:string, guard:GameObject):void {
		const owner = (fromID ? findBody(this.world, fromID) : undefined) ?? this.stallOwner(item.name);
		if (owner && owner !== guard && tryInsert(owner, item)) {
			return;
		}
		if (!tryInsert(guard, item)) {
			dropItem(guard, item);
		}
	}

	private carries(id:string, name:string):boolean {
		const actor = this.world.findByID(id);
		return !!actor && !!findCarried(actor, (it) => itemMatchesName(it, name));
	}

	private inVault(id:string):boolean {
		const go = this.world.findByID(id);
		if (!go) {
			return false;
		}
		const { cx, cz } = worldToChunk(go.transform.position.x, go.transform.position.z);
		return cx === 1 && cz === 0;
	}

	private cotTended(id:string):boolean {
		const cot = this.world.findNamed(id);
		return !!cot?.getComponent(Sickbed)?.tended;
	}

	private eastGateLocked():boolean {
		const gate = this.world.findNamed('EastGate');
		return !!gate?.getComponent(Lock)?.locked;
	}

	private armoryLocked():boolean {
		const chest = this.world.findNamed('ArmoryChest');
		return !!chest?.getComponent(Lock)?.locked;
	}

	private nudgeGateKey():void {
		if (this.carries('Captain', 'BrassKey')) {
			this.setGoals('Captain', 'use(BrassKey, EastGate) now. Then enter the vault.', 3);
			this.setGoals('Herbalist', 'EastGate is locked. Wait for Captain to use BrassKey. Then enter the vault.', 3);
			this.setGoals('Alchemist', 'Captain has BrassKey. Wait for EastGate to open, then wait at BrewHearth.', 3);
			return;
		}
		if (this.carries('Herbalist', 'BrassKey') || this.carries('Alchemist', 'BrassKey')) {
			const who = this.carries('Herbalist', 'BrassKey') ? 'Herbalist' : 'Alchemist';
			this.setGoals(who, 'give(BrassKey, Captain) now so they can open EastGate.', 3);
			this.setGoals('Captain', 'Take BrassKey and use(BrassKey, EastGate).', 3);
			return;
		}
		if (this.armoryLocked()) {
			this.setGoals(
				'Alchemist',
				'Tell Captain that BrassKey is inside ArmoryChest. Ask them to use(ChestKey, ArmoryChest). You do not hold ChestKey.',
				3,
			);
			this.setGoals(
				'Captain',
				'use(ChestKey, ArmoryChest) now. ChestKey is in your pack. You do not know what is inside until it opens.',
				3,
			);
			this.setGoals(
				'Herbalist',
				'EastGate is locked. Ask Alchemist how to open it. Wait. Do not harvest yet.',
				3,
			);
			return;
		}
		this.setGoals('Captain', 'pick_up(BrassKey) from ArmoryChest, then use(BrassKey, EastGate).', 3);
		this.setGoals('Alchemist', 'Tell Captain to pick_up(BrassKey) from ArmoryChest and use it on EastGate.', 3);
		this.setGoals('Herbalist', 'EastGate is still locked. Wait for Captain to take BrassKey from ArmoryChest.', 3);
	}

	private nudgeBargain():void {
		if (this.bargainDone) {
			return;
		}
		if (this.eastGateLocked()) {
			this.nudgeGateKey();
			return;
		}
		const noll = this.cotTended('NollCot');
		const lina = this.cotTended('LinaCot');
		if (this.carries('Herbalist', MAGIC_POTION) && !noll) {
			this.setGoals('Herbalist', 'use(MagicPotion, NollCot) now. Do not drink it. Stay in the vault.', 3);
		}
		if (this.carries('Captain', MAGIC_POTION) && !lina) {
			this.setGoals('Captain', 'use(MagicPotion, LinaCot) now. Do not drink it. Stay in the vault.', 3);
		}
		const herb = this.carries('Alchemist', 'Bitterroot');
		const gold = this.carries('Alchemist', 'GoldCoin');
		const vials = this.carries('Alchemist', MAGIC_POTION);
		if (vials) {
			this.setGoals(
				'Alchemist',
				'Give one MagicPotion to Herbalist and one MagicPotion to Captain. Keep GoldCoin. Do not drink. Stay at BrewHearth.',
				3,
			);
			return;
		}
		if (herb && gold) {
			this.setGoals(
				'Alchemist',
				'You hold Bitterroot and GoldCoin. use(Bitterroot, BrewHearth) now. Do not give them away. Then give one MagicPotion to each of the others.',
				3,
			);
			return;
		}
		if (herb && !gold) {
			this.setGoals('Captain', 'Alchemist has Bitterroot. Give GoldCoin to Alchemist now. Then take one MagicPotion for LinaCot.', 3);
			this.setGoals('Alchemist', 'You have the herb. Wait at BrewHearth for Captain to give GoldCoin, then use(Bitterroot, BrewHearth).', 3);
			return;
		}
		if (gold && !herb) {
			if (noll || lina || this.carries('Herbalist', MAGIC_POTION) || this.carries('Captain', MAGIC_POTION)) {
				return;
			}
			if (this.carries('Herbalist', 'Bitterroot')) {
				this.setGoals('Herbalist', 'Alchemist is paid. Give Bitterroot to Alchemist at BrewHearth now.', 3);
			}
			else {
				this.setGoals('Herbalist', 'Alchemist is paid. Pick up Bitterroot in the vault and give it to Alchemist.', 3);
			}
			this.setGoals('Alchemist', 'You have GoldCoin. Wait at BrewHearth for Herbalist to give Bitterroot, then use(Bitterroot, BrewHearth).', 3);
			this.setGoals('Captain', 'GoldCoin is already with Alchemist. Walk through EastGate to LinaCot. Wait for MagicPotion. Do not stand in the doorway. Do not try to give GoldCoin again.', 3);
		}
	}

	private nudgeGlen():void {
		if (this.bargainDone) {
			return;
		}
		if (this.carries('Forager', 'FireMushroom') && !this.carries('Miller', 'FireMushroom')) {
			this.setGoals('Forager', 'give(FireMushroom, Miller) now. Do not talk. Do not harvest again.', 3);
			this.setGoals('Miller', 'Take FireMushroom from Forager, then immediately use(MillCrank, MillLever).', 3);
		}
		if (this.carries('Miller', 'FireMushroom')) {
			this.setGoals('Miller', 'You hold FireMushroom. use(MillCrank, MillLever) now to lower MillBridge.', 3);
			this.setGoals('Angler', 'Miller is paid. Wait at the south bank for MillBridge to come down.', 3);
			this.setGoals('Forager', 'FireMushroom is delivered. Wait north of the water for SilverTrout.', 3);
		}
	}

	private checkBargain():void {
		if (this.bargainDone) {
			return;
		}
		if (this.sceneID === 'marketplace') {
			return;
		}
		if (this.sceneID === 'glen') {
			this.checkGlen();
			return;
		}
		const herbalist = this.world.findByID('Herbalist');
		const alchemist = this.world.findByID('Alchemist');
		const captain = this.world.findByID('Captain');
		if (!herbalist || !alchemist || !captain) {
			return;
		}
		const gold = !!findCarried(alchemist, (it) => itemMatchesName(it, 'GoldCoin'));
		if (
			!this.cotTended('NollCot')
			|| !this.cotTended('LinaCot')
			|| !gold
			|| !this.inVault('Herbalist')
			|| !this.inVault('Alchemist')
			|| !this.inVault('Captain')
		) {
			return;
		}
		this.bargainDone = true;
		this.world.setMessage('The vault holds — Noll and Lina tend, the coin is paid');
		for (const go of [herbalist, alchemist, captain]) {
			let hop = go.getComponent(Celebrating);
			if (!hop) {
				hop = go.addComponent(new Celebrating());
			}
			hop.until = this.world.time + CELEBRATE_LIFE;
			hop.enabled = true;
		}
		console.info('npc bargain done', this.debug());
		this.publishDebug();
	}

	private checkGlen():void {
		const forager = this.world.findByID('Forager');
		const miller = this.world.findByID('Miller');
		const angler = this.world.findByID('Angler');
		if (!forager || !miller || !angler) {
			return;
		}
		let bridgeOpen = false;
		this.world.forEachComponent(Bridge, (span) => {
			if (span.open) {
				bridgeOpen = true;
			}
		});
		const fee = this.carries('Miller', 'FireMushroom');
		const trout = this.carries('Forager', 'SilverTrout');
		const crossed = angler.transform.position.z < 20;
		if (!bridgeOpen || !fee || !trout || !crossed) {
			return;
		}
		this.bargainDone = true;
		this.world.setMessage('The glen holds — trout, mushroom, and a lowered bridge');
		for (const go of [forager, miller, angler]) {
			let hop = go.getComponent(Celebrating);
			if (!hop) {
				hop = go.addComponent(new Celebrating());
			}
			hop.until = this.world.time + CELEBRATE_LIFE;
			hop.enabled = true;
		}
		console.info('npc glen bargain done', this.debug());
		this.publishDebug();
	}

	private stampMemory(text:string, tags:string[]):void {
		for (const mind of this.minds) {
			mind.agent.memory.add({
				category: 'episodic',
				text,
				tags,
			}, this.world.time);
		}
	}

	private setGoals(id:string, text:string, priority:number):void {
		const mind = this.mindByID(id);
		if (!mind || !mind.aiOn) {
			return;
		}
		mind.agent.goals = [{ text, priority }];
		this.queue.enqueueMajor(mind.id);
	}

	private keepOrderGoal(id:string, extra:string, priority:number):void {
		const mind = this.mindByID(id);
		const current = mind?.agent.goals[0]?.text ?? '';
		if (current.startsWith('Player ordered you:')) {
			this.setGoals(id, `${current} ${extra}`, 5);
			return;
		}
		this.setGoals(id, extra, priority);
	}

	private mindByID(id:string):NPCMind | undefined {
		const direct = this.minds.find((m) => m.id === id);
		if (direct) {
			return direct;
		}
		const go = findBody(this.world, id);
		if (!go) {
			return undefined;
		}
		return this.minds.find((m) => m.id === go.id)
			?? this.minds.find((m) => m.id === bodyName(go));
	}

	noteActorVerb(actor:GameObject, verb:string):void {
		const mind = this.mindByID(actor.id) ?? this.mindByID(bodyName(actor));
		mind?.agent.noteVerb(verb);
	}

	armWaitFor(actor:GameObject, expr:string):void {
		const mind = this.mindByID(actor.id) ?? this.mindByID(bodyName(actor));
		if (mind) {
			this.queue.armOnce(mind.id, expr);
		}
	}

	performAgentStep(actor:GameObject, step:Step):Promise<ActionResult> {
		const mind = this.mindByID(actor.id) ?? this.mindByID(bodyName(actor));
		if (!mind) {
			return Promise.resolve({ ok: false, verb: step.verb, reason: `unhandled verb ${step.verb}` });
		}
		return mind.agent.perform(step, { world: this.world, actor, director: this }).then((result) => {
			this.revealChosenName(mind);
			return result;
		});
	}

	/** World address is Named.id. Spawn id stays put so minds and saves still key off it. */
	private revealChosenName(mind:NPCMind):void {
		const go = this.world.findByID(mind.id);
		const named = go?.getComponent(Named);
		if (!go || !named) {
			return;
		}
		const next = pascalCase(mind.agent.identity.name);
		if (!next || next === named.id || next === 'Player') {
			return;
		}
		const taken = this.world.findNamed(next) ?? this.world.findByID(next);
		if (taken && taken !== go) {
			return;
		}
		named.aliases = [...new Set([...(named.aliases ?? []), named.id, mind.id, go.id])];
		named.id = next;
	}

	playerSay(text:string):void {
		const spoken = text.trim();
		if (!spoken) {
			return;
		}
		const slash = parseSlash(spoken);
		if (slash) {
			this.playerSlash(slash);
			return;
		}
		const directed = parseDirectedLine(spoken);
		const peers = nearbyTalkPeers(this.world, 'Player');
		const line = directed?.text ?? spoken;
		const to = directed?.to ?? (peers.length <= 1 ? peers[0] : peers);
		const result = this.talk.say('Player', line, to, this.world.time);
		if (!result.ok) {
			this.world.setMessage(result.reason ?? 'no one heard');
			return;
		}
		this.dispatchPlayerOrder(line, to);
	}

	private dispatchPlayerOrder(text:string, to?:string | string[]):void {
		const names = to == null
			? nearbyTalkPeers(this.world, 'Player')
			: Array.isArray(to)
				? to
				: [to];
		for (const name of names) {
			this.takePlayerOrder(name, text);
		}
	}

	private takePlayerOrder(id:string, text:string):void {
		const actor = this.world.findByID(id) ?? findBody(this.world, id);
		const bond = actor?.getComponent(Companion);
		if (!actor || !bond) {
			return;
		}
		if (orderStations(text)) {
			bond.hold = true;
		}
		else if (orderFollows(text)) {
			bond.hold = false;
		}
		this.setGoals(
			id,
			`Player ordered you: "${text}". Do the whole order. Do not follow(Player) until it is done. `
				+ `If you must give an item back, give() it. If told to stay or go back inside, wait() there after; do not follow out.`,
			5,
		);
		const mind = this.mindByID(id);
		if (mind) {
			const existing = mind.agent.memory.pinned().find((row) => (
				row.tags.includes('Player') && row.tags.includes('order')
			));
			const line = `Player ordered: "${text}". Keep this until it is done.`;
			if (existing) {
				existing.text = line;
			}
			else {
				mind.agent.memory.add({
					category: 'episodic',
					text: line,
					tags: ['Player', 'order'],
					pinned: true,
				}, this.world.time);
			}
		}
		if (bond.hold) {
			const npc = actor.getComponent(NPCInput);
			if (npc?.headingTo() === bond.targetID || npc?.headingTo() === 'Player') {
				void npc.wait(0.2);
			}
		}
	}

	private playerSlash(slash:ParsedSlash):void {
		if (!slash.ok) {
			this.world.setMessage(slash.reason);
			return;
		}
		if (slash.verb === 'help') {
			this.world.setMessage(SLASH_HELP);
			this.chat.push({
				speaker: 'Help',
				text: SLASH_HELP,
				at: this.world.time,
			});
			if (this.chat.length > CHAT_CAP) {
				this.chat.splice(0, this.chat.length - CHAT_CAP);
			}
			return;
		}
		const player = this.world.findByID('Player');
		if (!player) {
			this.world.setMessage('no player');
			return;
		}
		const result = this.runPlayerSlash(player, slash);
		this.world.setMessage(result.reason ?? '');
	}

	private runPlayerSlash(
		player:GameObject,
		slash:Exclude<ParsedSlash, { ok:false } | { ok:true; verb:'help' }>,
	):ActionResult {
		if (slash.verb === 'give') {
			const target = this.playerReach(player, slash.to, 'give');
			if (!target.ok) {
				return target;
			}
			return settleGive(player, target.who, slash.item, this);
		}
		if (slash.verb === 'pay') {
			const target = this.playerReach(player, slash.to, 'give');
			if (!target.ok) {
				return target;
			}
			return settlePay(player, target.who, slash.amount, this);
		}
		if (slash.verb === 'buy') {
			const target = this.playerReach(player, slash.from, 'buy');
			if (!target.ok) {
				return target;
			}
			return settleBuy(player, target.who, slash.item, slash.offer ?? NaN, this);
		}
		if (slash.verb === 'sell') {
			const target = this.playerReach(player, slash.to, 'sell');
			if (!target.ok) {
				return target;
			}
			return settleSell(player, target.who, slash.item, slash.ask ?? NaN, this);
		}
		const unseen:never = slash;
		return { ok: false, verb: 'buy', reason: String(unseen) };
	}

	private playerReach(
		player:GameObject,
		name:string,
		verb:string,
	):{ ok:true; who:GameObject } | { ok:false; verb:string; reason:string } {
		const who = findBody(this.world, name);
		if (!who) {
			return { ok: false, verb, reason: `no such person ${name}` };
		}
		const far = tooFar(player, who, name);
		if (far) {
			return { ok: false, verb, reason: far };
		}
		return { ok: true, who };
	}

	private onSpoke(utterance:SpeechUtterance):void {
		const actor = findBody(this.world, utterance.speakerID);
		if (actor) {
			this.showSpeech(actor, utterance.text, sayToLabel(utterance.to));
		}
		const targets = utterance.to == null
			? []
			: Array.isArray(utterance.to)
				? utterance.to
				: [utterance.to];
		for (const id of utterance.heardBy) {
			if (canHearClearly(this.world, utterance.speakerID, id)) {
				continue;
			}
			const list = this.pendingHear.get(id) ?? [];
			list.push({
				speakerID: utterance.speakerID,
				spoken: utterance.text,
				addressed: targets.includes(id),
				until: this.world.time + SPEECH_LIFE,
			});
			this.pendingHear.set(id, list);
		}
	}

	private hearIfClose():void {
		const now = this.world.time;
		for (const [listener, rows] of this.pendingHear) {
			const keep:{
				speakerID:string;
				spoken:string;
				addressed:boolean;
				until:number;
			}[] = [];
			for (const row of rows) {
				if (now >= row.until) {
					continue;
				}
				if (!canHearClearly(this.world, row.speakerID, listener)) {
					keep.push(row);
					continue;
				}
				const mind = this.mindByID(listener);
				if (!mind) {
					continue;
				}
				const event = {
					kind: 'HeardSpeech',
					text: row.addressed
						? `${row.speakerID} says to you, now clear: "${row.spoken}"`
						: `${row.speakerID} says, now clear: "${row.spoken}"`,
					tags: ['speech', row.speakerID],
					major: true,
					at: now,
				};
				mind.agent.pushEvent(event);
				const inbox = this.inbox.get(mind.id) ?? [];
				inbox.push(event);
				if (inbox.length > EVENT_CAP) {
					inbox.splice(0, inbox.length - EVENT_CAP);
				}
				this.inbox.set(mind.id, inbox);
				this.wakeMind(mind.id);
				this.queue.enqueueMajor(mind.id, true);
			}
			if (keep.length > 0) {
				this.pendingHear.set(listener, keep);
			}
			else {
				this.pendingHear.delete(listener);
			}
		}
	}

	showSpeech(actor:GameObject, text:string, to?:string, life = SPEECH_LIFE):void {
		const spoken = text.trim();
		if (!spoken) {
			return;
		}
		let bubble = actor.getComponent(SpeechBubble);
		if (!bubble) {
			bubble = actor.addComponent(new SpeechBubble());
		}
		bubble.text = to ? `${spoken} (${to})` : spoken;
		bubble.until = this.world.time + life;
		this.chat.push({
			speaker: bodyName(actor),
			text: spoken,
			to,
			at: this.world.time,
		});
		if (this.chat.length > CHAT_CAP) {
			this.chat.splice(0, this.chat.length - CHAT_CAP);
		}
	}

	speak(actor:GameObject, text:string, to?:string, life = SPEECH_LIFE):boolean {
		const key = text.trim().toLowerCase();
		if (!key) {
			return false;
		}
		if (this.spoken.has(key)) {
			return false;
		}
		this.spoken.add(key);
		this.showSpeech(actor, text, to, life);
		return true;
	}

	dispose():void {
		this.disposed = true;
		this.ready = false;
		for (const mind of this.minds) {
			this.talk.detach(mind.id);
		}
	}
}

