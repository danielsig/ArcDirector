import { Time, type GameObject } from '@arc-director/kindling';
import { markRaw } from 'vue';
import { PlayerInput } from '../characters/PlayerInput';
import { HumanBody, Appearance, Named, SpeechBubble, Vitals, Wallet } from './components';
import type { World } from './World';
import type { Renderer } from '@arc-director/kindling';
import { CELL_SIZE, CHUNK_SIZE } from '../world/constants';
import { Container, Item } from '../items/components';
import { allEquipped, slotItem } from '../items/inventory';
import type { ItemInstance } from '../items/instance';
import { nearestPickup, pickupLabel } from '../items/pickup';
import type { HudModel, MinimapCell } from '../ui/hudModel';
import type { GameHost } from '../director/adapter';
import { idOf, findObject, isLiving } from '../director/names';

function chunkStamp(world:World):string {
	let s = '';
	for (const chunk of world.chunks.values()) {
		s += chunk.id;
		s += ';';
	}
	return s;
}

let lastMinimapStamp = '';

export function resetHudPatch():void {
	lastMinimapStamp = '';
}

function voidCell():MinimapCell {
	return { def: 'void', blocked: true, height: 0 };
}

function fillTile(world:World, x:number, z:number):MinimapCell {
	const tile = world.tileAtWorld(x, z);
	if (!tile) {
		return voidCell();
	}
	return { def: tile.def, blocked: tile.blocked, height: tile.height };
}

function minimapStamp(world:World, follow:boolean, x:number, z:number):string {
	const chunks = chunkStamp(world);
	if (follow) {
		const half = (CHUNK_SIZE * CELL_SIZE) / 2;
		const ox = Math.floor((x - half) / CELL_SIZE);
		const oz = Math.floor((z - half) / CELL_SIZE);
		return `f:${ox}:${oz}:${chunks}`;
	}
	const { cx, cz } = world.chunkCoordAt(x, z);
	return `c:${cx}:${cz}:${chunks}`;
}

function rebuildMinimap(world:World, hud:HudModel, x:number, z:number):void {
	const follow = hud.minimap.follow;
	let originX:number;
	let originZ:number;
	let width:number;
	let height:number;
	if (follow) {
		const half = (CHUNK_SIZE * CELL_SIZE) / 2;
		originX = Math.floor((x - half) / CELL_SIZE) * CELL_SIZE;
		originZ = Math.floor((z - half) / CELL_SIZE) * CELL_SIZE;
		width = CHUNK_SIZE + 1;
		height = CHUNK_SIZE + 1;
	}
	else {
		const chunk = world.chunkAtWorld(x, z);
		originX = chunk?.worldOriginX()
			?? Math.floor(x / (CHUNK_SIZE * CELL_SIZE)) * CHUNK_SIZE * CELL_SIZE;
		originZ = chunk?.worldOriginZ()
			?? Math.floor(z / (CHUNK_SIZE * CELL_SIZE)) * CHUNK_SIZE * CELL_SIZE;
		width = CHUNK_SIZE;
		height = CHUNK_SIZE;
	}
	const cells:MinimapCell[] = new Array(width * height);
	for (let lz = 0; lz < height; lz++) {
		for (let lx = 0; lx < width; lx++) {
			cells[lz * width + lx] = fillTile(
				world,
				originX + (lx + 0.5) * CELL_SIZE,
				originZ + (lz + 0.5) * CELL_SIZE,
			);
		}
	}
	const m = hud.minimap;
	m.originX = originX;
	m.originZ = originZ;
	m.width = width;
	m.height = height;
	m.cells = markRaw(cells);
	m.tileRev += 1;
}

/** Extra meters above the head. */
const HEAD_PAD = 0.28;
/** Above a fallen body, so the name clears it. */
const DOWNED_Y = 0.48;


/** Top of the head in meters above the feet. */
function crownY(go:GameObject):number {
	return go.getComponent(Appearance)?.height ?? 1.7;
}

function overheadY(go:GameObject, downed:boolean):number {
	return downed ? DOWNED_Y : crownY(go) + HEAD_PAD;
}

function projectOverhead(
	go:GameObject,
	height:number,
	view:Renderer,
):{ x:number; y:number; visible:boolean } {
	const p = go.transform.position;
	return view.projectToCanvas(p.x, p.y + height, p.z);
}

/** A line under someone's bubble (what they are doing), or `thinking` while their mind is. */
export type OverheadNote = { id:string; text:string; thinking?:boolean };

function patchOverhead(
	world:World,
	hud:HudModel,
	view:Renderer,
	npcNotes:OverheadNote[],
	healthBars:boolean,
):void {
	const byID = new Map<string, {
		go:GameObject;
		text:string;
		status:string;
		thinking:boolean;
		height:number;
		hp:number;
		maxHP:number;
		timestamp:number;
	}>();
	world.forEachComponent(SpeechBubble, (bubble, go) => {
		if (!bubble.text || Time.time >= bubble.until) {
			return;
		}
		byID.set(go.id, {
			go,
			text: bubble.text,
			status: '',
			thinking: false,
			height: overheadY(go, false),
			hp: 0,
			maxHP: 0,
			timestamp: bubble.timestamp,
		});
	});
	for (const note of npcNotes) {
		if (!note.text && !note.thinking) {
			continue;
		}
		const go = findObject(world, note.id);
		if (!go) {
			continue;
		}
		const row = byID.get(go.id);
		if (row) {
			row.status = note.text;
			row.thinking = note.thinking ?? false;
		}
		else {
			byID.set(go.id, {
				go,
				text: '',
				status: note.text,
				thinking: note.thinking ?? false,
				height: overheadY(go, false),
				hp: 0,
				maxHP: 0,
				timestamp: 0,
			});
		}
	}
	if (healthBars) world.forEachComponent(Vitals, (vitals, go) => {
		if (go.id === 'Player' || vitals.hp <= 0 || !go.getComponent(HumanBody)) {
			return;
		}
		const barY = overheadY(go, vitals.hp <= 0);
		const row = byID.get(go.id);
		if (row) {
			row.hp = vitals.hp;
			row.maxHP = vitals.maxHP;
			row.height = barY;
		}
		else {
			byID.set(go.id, {
				go,
				text: '',
				status: '',
				thinking: false,
				height: barY,
				hp: vitals.hp,
				maxHP: vitals.maxHP,
				timestamp: 0,
			});
		}
	});

	const speech = hud.speech;
	let n = 0;
	for (const [id, row] of byID) {
		const screen = projectOverhead(row.go, row.height, view);
		if (n < speech.length) {
			const slot = speech[n];
			slot.id = id;
			slot.name = idOf(row.go);
			slot.text = row.text;
			slot.status = row.status;
			slot.thinking = row.thinking;
			slot.hp = row.hp;
			slot.maxHP = row.maxHP;
			slot.x = screen.x;
			slot.y = screen.y;
			slot.visible = screen.visible;
			slot.timestamp = row.timestamp;
		}
		else {
			speech.push({
				id,
				name: idOf(row.go),
				text: row.text,
				status: row.status,
				thinking: row.thinking,
				hp: row.hp,
				maxHP: row.maxHP,
				x: screen.x,
				y: screen.y,
				visible: screen.visible,
				timestamp: row.timestamp,
			});
		}
		n += 1;
	}
	if (speech.length > n) {
		speech.length = n;
	}
}

function patchHotbar(hud:HudModel, bar:{ name:string; count:number }[], sel:number):void {
	const prev = hud.hotbar;
	const len = bar.length;
	if (prev.length !== len) {
		hud.hotbar = bar.map((it, i) => ({
			name: it.name,
			count: it.count,
			selected: len > 0 && i === sel % len,
		}));
		return;
	}
	for (let i = 0; i < len; i++) {
		const it = bar[i];
		const row = prev[i];
		const selected = i === sel % len;
		if (row.name !== it.name) {
			row.name = it.name;
		}
		if (row.count !== it.count) {
			row.count = it.count;
		}
		if (row.selected !== selected) {
			row.selected = selected;
		}
	}
}

function walkCoin(it:ItemInstance):boolean {
	if (it.defID === 'gold_coin') {
		return true;
	}
	const nested = it.Container?.contents;
	if (!nested) {
		return false;
	}
	for (const child of nested) {
		if (walkCoin(child)) {
			return true;
		}
	}
	return false;
}

/** A purse with coins, or a gold coin on the ground, in a chest, or in a pack. */
function sceneHasGold(world:World):boolean {
	let found = false;
	world.forEachComponent(Wallet, (purse) => {
		if (purse.coins > 0) {
			found = true;
		}
	});
	if (found) {
		return true;
	}
	world.forEachComponent(Container, (bag) => {
		for (const it of bag.contents) {
			if (walkCoin(it)) {
				found = true;
			}
		}
	});
	if (found) {
		return true;
	}
	world.forEachComponent(Item, (item) => {
		if (item.defID === 'gold_coin') {
			found = true;
		}
	});
	if (found) {
		return true;
	}
	world.forEachComponent(HumanBody, (body) => {
		for (const it of allEquipped(body)) {
			if (walkCoin(it)) {
				found = true;
			}
		}
	});
	return found;
}

export function patchHud(
	world:World,
	hud:HudModel,
	view:Renderer,
	npcNotes:OverheadNote[] = [],
	healthBars = false,
):void {
	const player = world.findByID('Player');
	const vitals = player?.getComponent(Vitals);
	hud.hp = vitals?.hp ?? 0;
	hud.maxHP = vitals?.maxHP ?? 5;
	hud.gold = player?.getComponent(Wallet)?.coins ?? 0;
	hud.showGold = sceneHasGold(world);
	hud.message = Time.time - world.hudMessageTimestamp < world.hudMessageLife ? world.hudMessage : '';
	if (hud.statsOverlay || (hud.menuOpen && hud.menuPage === 'testing')) {
		hud.renderStats = view.stats();
	}
	if (hud.fpsCounter) {
		const ms = view.frameMS(1000);
		hud.fps = ms > 0 ? Math.round(1000 / ms) : 0;
	}
	const input = player?.getComponent(PlayerInput);
	hud.cursorName = input?.cursorName ?? '';
	const loot = player ? nearestPickup(player) : null;
	const hint = hud.pickupHint;
	if (loot) {
		const p = loot.transform.position;
		const screen = view.projectToCanvas(p.x, p.y, p.z);
		hint.name = pickupLabel(loot);
		hint.x = screen.x;
		hint.y = screen.y;
		hint.visible = screen.visible;
		const lootName = loot.getComponent(Named)?.id ?? loot.name;
		if (hud.cursorName === lootName) {
			hud.cursorName = '';
		}
	}
	else {
		hint.name = '';
		hint.visible = false;
	}
	const bar = input?.hotbar() ?? [];
	const sel = input?.selected ?? 0;
	patchHotbar(hud, bar, sel);
	const body = player?.getComponent(HumanBody);
	hud.heldLeft = body ? slotItem(body, 'hands.left.held')?.name ?? '' : '';
	hud.heldRight = body ? slotItem(body, 'hands.right.held')?.name ?? '' : '';
	hud.back = body ? slotItem(body, 'back')?.name ?? '' : '';

	patchOverhead(world, hud, view, npcNotes, healthBars);

	const p = player?.transform.position;
	const px = p?.x ?? 0;
	const pz = p?.z ?? 0;
	const stamp = minimapStamp(world, hud.minimap.follow, px, pz);
	if (stamp !== lastMinimapStamp) {
		lastMinimapStamp = stamp;
		rebuildMinimap(world, hud, px, pz);
	}
	hud.minimap.playerX = px;
	hud.minimap.playerZ = pz;
	hud.minimap.playerYaw = player?.transform.yaw ?? 0;
}

/** Living body `thinkThread` names. Reject `findNamed` loose matches. */
function overheadID(host:GameHost, mind:{ thinkThread():string }):string | undefined {
	const want = mind.thinkThread();
	const body = findObject(host.world, want);
	if (!isLiving(body) || (idOf(body) !== want && body.id !== want)) {
		return undefined;
	}
	return idOf(body);
}

export function statusLabels(host:GameHost):OverheadNote[] {
	const now = Time.time;
	const out:OverheadNote[] = [];
	const queue = host.arc?.mindQueue();
	for (const mind of host.arc?.minds() ?? []) {
		const id = overheadID(host, mind);
		if (!id) {
			continue;
		}
		if (queue?.isThinking(mind.id)) {
			out.push({ id, text: '', thinking: true });
			continue;
		}
		const row = host.labels.get(id);
		if (row && now < row.until) {
			out.push({ id, text: row.text });
		}
	}
	return out;
}

export function patchInfer(host:GameHost, hud:HudModel):void {
	const infer = host.arc?.infer;
	const queue = host.arc?.mindQueue();
	const now = Time.time;
	const rows = host.arc?.minds() ?? [];
	const next = rows.map((mind) => {
		const last = mind.lastTacticalTimestamp;
		return {
			id: mind.id,
			pulse: queue?.heartbeatSeconds(mind.id) ?? null,
			ago: Number.isFinite(last) ? Math.max(0, now - last) : null,
			thinking: queue?.isThinking(mind.id) ?? false,
			thinkMs: infer?.thinkMs[mind.id] ?? 0,
		};
	});
	next.sort((a, b) => a.id.localeCompare(b.id));
	hud.heartrates = next;

	if (!infer) return;
	hud.inferCalls = infer.calls;
	hud.inferContextMs = infer.contextMs;
	hud.inferGenerateMs = infer.generateMs;
	hud.inferWallMs = infer.wallMs;
	hud.inferContextKnown = infer.contextKnown;
	hud.inferLastContextMs = infer.lastContextMs;
	hud.inferLastGenerateMs = infer.lastGenerateMs;
	hud.inferLastWallMs = infer.lastWallMs;
}
