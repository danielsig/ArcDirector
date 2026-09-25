import { markRaw } from 'vue';
import { PlayerInput } from '../actors/PlayerInput';
import { HumanBody, HumanSprite, Named, SpeechBubble, Vitals, Wallet } from './components';
import type { GameObject } from './GameObject';
import { worldToChunk, type World } from './World';
import type { Renderer } from '@arc-director/kindling';
import { CELL_SIZE, CHUNK_SIZE } from '../world/constants';
import { countDef, slotItem } from '../items/inventory';
import { nearestPickup, pickupLabel } from '../items/pickup';
import { characterHeight } from '../render/artCache';
import type { HudModel, MinimapCell } from '../ui/hudModel';
import type { GameHost } from '../npc/adapter';
import { bodyName, findBody, isLiving } from '../npc/names';

const MSG_LIFE = 3.2;

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
	const { cx, cz } = worldToChunk(x, z);
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

/** Same XZ lead as the character billboard in `present.ts`. */
const SPRITE_LEAD = 0.11;
/** Extra meters above the unflattened sprite crown. */
const HEAD_PAD = 0.28;
/** Above the flat corpse in present.ts (0.36) so the name clears the body. */
const DOWNED_Y = 0.48;

function cameraPitch(view:Renderer):number {
	return view.findCamera()?.gameObject.transform.pitch ?? 0;
}

/** Visual crown in meters above feet. Matches `present.ts` unflatten. */
function spriteCrownY(go:GameObject, pitch:number):number {
	const sprite = go.getComponent(HumanSprite);
	const heightM = sprite && sprite.height > 0
		? sprite.height
		: characterHeight(sprite?.kind ?? 'player');
	return (1 / Math.max(Math.cos(Math.abs(pitch)), 0.45)) * heightM - 0.02;
}

function overheadY(go:GameObject, pitch:number, downed:boolean):number {
	return downed ? DOWNED_Y : spriteCrownY(go, pitch) + HEAD_PAD;
}

function projectOverhead(
	go:GameObject,
	height:number,
	view:Renderer,
):{ x:number; y:number; visible:boolean } {
	const p = go.transform.position;
	const cam = view.findCamera()?.gameObject.transform.position;
	if (!cam) {
		return view.projectToCanvas(p.x, p.y + height, p.z);
	}
	const dx = cam.x - p.x;
	const dz = cam.z - p.z;
	const len = Math.hypot(dx, dz) || 1;
	return view.projectToCanvas(
		p.x + (dx / len) * SPRITE_LEAD,
		p.y + height,
		p.z + (dz / len) * SPRITE_LEAD,
	);
}

function patchOverhead(
	world:World,
	hud:HudModel,
	view:Renderer,
	npcNotes:{ id:string; text:string }[],
):void {
	const pitch = cameraPitch(view);
	const byID = new Map<string, {
		go:GameObject;
		text:string;
		status:string;
		height:number;
		hp:number;
		maxHP:number;
	}>();
	world.forEachComponent(SpeechBubble, (bubble, go) => {
		if (!bubble.text || world.time >= bubble.until) {
			return;
		}
		byID.set(go.id, {
			go,
			text: bubble.text,
			status: '',
			height: overheadY(go, pitch, false),
			hp: 0,
			maxHP: 0,
		});
	});
	for (const note of npcNotes) {
		if (!note.text) {
			continue;
		}
		const go = findBody(world, note.id);
		if (!go) {
			continue;
		}
		const row = byID.get(go.id);
		if (row) {
			row.status = note.text;
		}
		else {
			byID.set(go.id, {
				go,
				text: '',
				status: note.text,
				height: overheadY(go, pitch, false),
				hp: 0,
				maxHP: 0,
			});
		}
	}
	world.forEachComponent(Vitals, (vitals, go) => {
		if (go.id === 'Player' || !go.getComponent(HumanBody)) {
			return;
		}
		const barY = overheadY(go, pitch, vitals.hp <= 0);
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
				height: barY,
				hp: vitals.hp,
				maxHP: vitals.maxHP,
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
			slot.text = row.text;
			slot.status = row.status;
			slot.hp = row.hp;
			slot.maxHP = row.maxHP;
			slot.x = screen.x;
			slot.y = screen.y;
			slot.visible = screen.visible;
		}
		else {
			speech.push({
				id,
				text: row.text,
				status: row.status,
				hp: row.hp,
				maxHP: row.maxHP,
				x: screen.x,
				y: screen.y,
				visible: screen.visible,
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

export function patchHud(
	world:World,
	hud:HudModel,
	view:Renderer,
	npcNotes:{ id:string; text:string }[] = [],
):void {
	const player = world.findByID('Player');
	const vitals = player?.getComponent(Vitals);
	hud.hp = vitals?.hp ?? 0;
	hud.maxHP = vitals?.maxHP ?? 5;
	hud.mana = vitals?.mana ?? 0;
	hud.maxMana = vitals?.maxMana ?? 5;
	hud.keys = player ? countDef(player, 'brass_key') : 0;
	hud.bombs = player ? countDef(player, 'bomb') : 0;
	hud.gold = player?.getComponent(Wallet)?.coins ?? 0;
	hud.message = world.time - world.hudMessageAt < MSG_LIFE ? world.hudMessage : '';
	hud.graphicsMemory = view.graphicsMemory();
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

	patchOverhead(world, hud, view, npcNotes);

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
function overheadID(host:GameHost, agent:{ thinkThread():string }):string | undefined {
	const want = agent.thinkThread();
	const body = findBody(host.world, want);
	if (!isLiving(body) || (bodyName(body) !== want && body.id !== want)) {
		return undefined;
	}
	return bodyName(body);
}

export function statusLabels(host:GameHost):{ id:string; text:string }[] {
	const now = host.world.time;
	const out:{ id:string; text:string }[] = [];
	const queue = host.arc?.mindQueue();
	for (const agent of host.arc?.agents() ?? []) {
		const id = overheadID(host, agent);
		if (!id) {
			continue;
		}
		if (queue?.isThinking(agent.id)) {
			out.push({ id, text: 'thinking...' });
			continue;
		}
		const row = host.labels.get(agent.id);
		if (row && now < row.until) {
			out.push({ id, text: row.text });
		}
	}
	return out;
}

export function patchInfer(host:GameHost, hud:HudModel):void {
	const infer = host.arc?.infer;
	const queue = host.arc?.mindQueue();
	const now = host.world.time;
	const rows = host.arc?.agents() ?? [];
	const next = rows.map((agent) => {
		const last = agent.lastTacticalAt;
		return {
			id: agent.id,
			name: agent.identity.name || agent.id,
			pulse: queue?.heartbeatSeconds(agent.id) ?? null,
			ago: Number.isFinite(last) ? Math.max(0, now - last) : null,
			thinking: queue?.isThinking(agent.id) ?? false,
		};
	});
	next.sort((a, b) => a.name.localeCompare(b.name));
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
