import { markRaw } from 'vue';
import { PlayerInput } from '../actors/PlayerInput';
import { HumanBody, Named, SpeechBubble, Vitals, Wallet } from './components';
import type { GameObject } from './GameObject';
import type { World } from './World';
import type { Renderer } from '@arc-director/kindling';
import { CHUNK_SIZE } from '../world/constants';
import { countDef, slotItem } from '../items/inventory';
import { nearestPickup, pickupLabel } from '../items/pickup';
import type { HudModel, MinimapCell } from '../ui/hudModel';

const MSG_LIFE = 3.2;

function chunkStamp(world:World):string {
	let s = '';
	for (const chunk of world.chunks.values()) {
		s += chunk.id;
		s += ';';
	}
	return s;
}

let lastChunkStamp = '';

export function resetHudPatch():void {
	lastChunkStamp = '';
}

function rebuildMinimap(world:World, hud:HudModel):void {
	let minCX = 0;
	let minCZ = 0;
	let maxCX = 0;
	let maxCZ = 0;
	let first = true;
	for (const chunk of world.chunks.values()) {
		if (first) {
			minCX = maxCX = chunk.origin.cx;
			minCZ = maxCZ = chunk.origin.cz;
			first = false;
		}
		else {
			minCX = Math.min(minCX, chunk.origin.cx);
			minCZ = Math.min(minCZ, chunk.origin.cz);
			maxCX = Math.max(maxCX, chunk.origin.cx);
			maxCZ = Math.max(maxCZ, chunk.origin.cz);
		}
	}
	const width = (maxCX - minCX + 1) * CHUNK_SIZE;
	const height = (maxCZ - minCZ + 1) * CHUNK_SIZE;
	const cells:MinimapCell[] = new Array(width * height);
	for (let i = 0; i < cells.length; i++) {
		cells[i] = { def: 'void', blocked: true, height: 0 };
	}
	for (const chunk of world.chunks.values()) {
		const ox = (chunk.origin.cx - minCX) * CHUNK_SIZE;
		const oz = (chunk.origin.cz - minCZ) * CHUNK_SIZE;
		for (let lz = 0; lz < CHUNK_SIZE; lz++) {
			for (let lx = 0; lx < CHUNK_SIZE; lx++) {
				const tile = chunk.tile(lx, lz);
				if (!tile) {
					continue;
				}
				cells[(oz + lz) * width + (ox + lx)] = {
					def: tile.def,
					blocked: tile.blocked,
					height: tile.height,
				};
			}
		}
	}
	const m = hud.minimap;
	m.originX = minCX * CHUNK_SIZE;
	m.originZ = minCZ * CHUNK_SIZE;
	m.width = width;
	m.height = height;
	m.cells = markRaw(cells);
	m.tileRev += 1;
}

const HEAD_Y = 1.42;

function patchOverhead(
	world:World,
	hud:HudModel,
	view:Renderer,
	npcNotes:{ id:string; text:string }[],
):void {
	const byID = new Map<string, { go:GameObject; text:string; status:string; height:number }>();
	world.forEachComponent(SpeechBubble, (bubble, go) => {
		if (!bubble.text || world.time >= bubble.until) {
			return;
		}
		byID.set(go.id, {
			go,
			text: bubble.text,
			status: '',
			height: bubble.height,
		});
	});
	for (const note of npcNotes) {
		if (!note.text) {
			continue;
		}
		const go = world.findByID(note.id) ?? world.findNamed(note.id);
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
				height: HEAD_Y,
			});
		}
	}

	const speech = hud.speech;
	let n = 0;
	for (const [id, row] of byID) {
		const p = row.go.transform.position;
		const screen = view.projectToCanvas(p.x, p.y + row.height, p.z);
		if (n < speech.length) {
			const slot = speech[n];
			slot.id = id;
			slot.text = row.text;
			slot.status = row.status;
			slot.x = screen.x;
			slot.y = screen.y;
			slot.visible = screen.visible;
		}
		else {
			speech.push({
				id,
				text: row.text,
				status: row.status,
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

	const stamp = chunkStamp(world);
	if (stamp !== lastChunkStamp) {
		lastChunkStamp = stamp;
		rebuildMinimap(world, hud);
	}
	const p = player?.transform.position;
	hud.minimap.playerX = p?.x ?? 0;
	hud.minimap.playerZ = p?.z ?? 0;
	hud.minimap.playerYaw = player?.transform.yaw ?? 0;
}
