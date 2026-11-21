import { MeshRenderer, Time, humanBone, distanceXZ, type GameObject, type Renderer } from '@arc-director/kindling';
import * as THREE from 'three';
import { markRaw } from 'vue';
import { PlayerInput } from '../characters/PlayerInput';
import { Seated } from '../characters/Seated';
import { HumanBody, Appearance, FollowCamera, Merchant, Named, SpeechBubble, Vitals, Wallet, idOf } from './components';
import type { DemoWorld } from './demo-world';
import { CELL_SIZE, CHUNK_SIZE } from '../world/constants';
import { Container, Item } from '../items/item-components';
import { allEquipped, countDef, listCarried, slotItem } from '../items/inventory';
import { coinsOf } from '../items/wallet';
import { isBackpack, type ItemInstance } from '../items/instance';
import { nearestPickup, pickupLabel } from '../items/pickup';
import { CARRY_ICONS, SLATE_WIDTH, noGoals, type HudGoalSide, type HudInspect, type HudFrame, type HudThink, type HudView, type MinimapCell } from '../ui/hud-model';
import type { SceneGoalSide, SceneGoals } from '../director/game-types';
import type { CarriedOverhead } from '../scenes/scene';
import type { GameHost } from '../director/adapter';
import type { ThinkSlate } from '../director/ThinkShow';
import type { Stance } from '../render/spell-fx';
import { findObject, isLiving } from '../director/names';
import { prefs } from '../prefs';

function chunkStamp(world:DemoWorld):string {
	let s = '';
	for (const chunk of world.terrain.loaded) {
		s += chunk.id;
		s += ';';
	}
	return s;
}

function voidCell():MinimapCell {
	return { def: 'void', blocked: true, height: 0 };
}

function fillTile(world:DemoWorld, x:number, z:number):MinimapCell {
	const tile = world.terrain.tileAtWorld(x, z);
	if (!tile) {
		return voidCell();
	}
	return { def: tile.def, blocked: tile.blocked, height: tile.height };
}

function minimapStamp(world:DemoWorld, follow:boolean, x:number, z:number):string {
	const chunks = chunkStamp(world);
	if (follow) {
		const half = (CHUNK_SIZE * CELL_SIZE) / 2;
		const ox = Math.floor((x - half) / CELL_SIZE);
		const oz = Math.floor((z - half) / CELL_SIZE);
		return `f:${ox}:${oz}:${chunks}`;
	}
	const { cx, cz } = world.terrain.chunkCoordAt(x, z);
	return `c:${cx}:${cz}:${chunks}`;
}

function rebuildMinimap(world:DemoWorld, hud:HudView, x:number, z:number):void {
	const follow = hud.minimapFollow;
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
		const chunk = world.terrain.chunkAtWorld(x, z);
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
/** Over a sleeper's head. */
const ASLEEP_LABEL = 'Zzz';
/** From the head bone (the base of the skull) up to the crown, as a share of standing height. */
const SKULL = 0.13;
const headAt = new THREE.Vector3();

/** Screen point just over the top of the head, wherever the pose has put it: lower sitting or crouched. A bare stance stands upright. */
function projectOverhead(go:GameObject | Stance, view:Renderer):{ x:number; y:number; visible:boolean } {
	if ('feet' in go) {
		return view.projectToCanvas(go.feet.x, go.feet.y + go.height + HEAD_PAD, go.feet.z);
	}
	const height = go.getComponent(Appearance)?.height ?? 1.7;
	const mesh = go.getComponent(MeshRenderer)?.mesh;
	const head = mesh && humanBone(mesh, 'head');
	if (head) {
		head.getWorldPosition(headAt);
		return view.projectToCanvas(headAt.x, headAt.y + SKULL * height + HEAD_PAD, headAt.z);
	}
	const p = go.transform.position;
	return view.projectToCanvas(p.x, p.y + height + HEAD_PAD, p.z);
}

/** A line under someone's bubble (what they are doing), or `thinking` while their mind is, or the `tool` it just called. */
export type OverheadNote = { id:string; text:string; thinking?:boolean; tool?:string };

/** What a scene shows over the characters' heads besides speech and status. */
export type Overheads = {
	/** `Scene.healthBars`. */
	healthBars:boolean;
	/** `Scene.carried`. */
	carried?:CarriedOverhead;
	/** `Scene.inspect`. */
	inspect?:boolean;
};

type OverheadRow = {
	go:GameObject;
	text:string;
	status:string;
	thinking:boolean;
	tool:string;
	hp:number;
	maxHP:number;
	gold:number;
	items:string[];
	timestamp:number;
};

/** One {@link CARRY_ICONS} def id per unit `go` carries. */
function carriedIcons(go:GameObject):string[] {
	const out:string[] = [];
	for (const defID of CARRY_ICONS) {
		for (let i = countDef(go, defID); i > 0; i--) {
			out.push(defID);
		}
	}
	return out;
}

function patchOverhead(
	world:DemoWorld,
	hud:HudFrame,
	view:Renderer,
	npcNotes:OverheadNote[],
	overheads:Overheads,
):void {
	const byID = new Map<string, OverheadRow>();
	const rowOf = (go:GameObject):OverheadRow => {
		let row = byID.get(go.id);
		if (!row) {
			row = { go, text: '', status: '', thinking: false, tool: '', hp: 0, maxHP: 0, gold: 0, items: [], timestamp: 0 };
			byID.set(go.id, row);
		}
		return row;
	};
	world.forEachComponent(SpeechBubble, (bubble, go) => {
		if (!bubble.text || Time.time >= bubble.until) {
			return;
		}
		const row = rowOf(go);
		row.text = bubble.text;
		row.timestamp = bubble.timestamp;
	});
	const bubbles = prefs().thinkingBubbles;
	for (const note of npcNotes) {
		if (!note.text && !note.thinking && !note.tool) {
			continue;
		}
		const go = findObject(world, note.id);
		if (!go) {
			continue;
		}
		const row = rowOf(go);
		row.status = note.text;
		row.thinking = bubbles && (note.thinking ?? false);
		row.tool = note.tool ?? '';
	}
	world.forEachComponent(HumanBody, (body, go) => {
		if (go.id === 'Player' || !isLiving(go)) {
			return;
		}
		if (overheads.healthBars) {
			const vitals = go.getComponent(Vitals);
			if (vitals) {
				const row = rowOf(go);
				row.hp = vitals.hp;
				row.maxHP = vitals.maxHP;
			}
		}
		const carried = overheads.carried;
		if (carried && !(carried === 'shoppers' && go.getComponent(Merchant))) {
			const gold = go.getComponent(Wallet)?.coins ?? 0;
			const items = carriedIcons(go);
			if (gold > 0 || items.length) {
				const row = rowOf(go);
				row.gold = gold;
				row.items = items;
			}
		}
	});

	const speech = hud.speech;
	let n = 0;
	for (const [id, row] of byID) {
		const screen = projectOverhead(row.go, view);
		if (n < speech.length) {
			const slot = speech[n];
			slot.id = id;
			slot.name = idOf(row.go);
			slot.text = row.text;
			slot.status = row.status;
			slot.thinking = row.thinking;
			slot.tool = row.tool;
			slot.hp = row.hp;
			slot.maxHP = row.maxHP;
			slot.gold = row.gold;
			if (slot.items.join() !== row.items.join()) {
				slot.items = row.items;
			}
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
				tool: row.tool,
				hp: row.hp,
				maxHP: row.maxHP,
				gold: row.gold,
				items: row.items,
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

function patchHotbar(hud:HudFrame, bar:{ name:string; count:number }[], sel:number):void {
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
function sceneHasGold(world:DemoWorld):boolean {
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
	world:DemoWorld,
	hud:HudView,
	view:Renderer,
	npcNotes:OverheadNote[],
	overheads:Overheads,
	/** The stamp of what the minimap shows: rebuilt when it changes. */
	shown:{ minimapStamp:string },
):void {
	const player = world.findByID('Player');
	const vitals = player?.getComponent(Vitals);
	hud.touch = world.input.touch;
	hud.pointerLocked = world.input.pointerLocked;
	hud.hp = vitals?.hp ?? 0;
	hud.maxHP = vitals?.maxHP ?? 5;
	hud.gold = player?.getComponent(Wallet)?.coins ?? 0;
	hud.showGold = sceneHasGold(world);
	hud.message = Time.time - world.hudMessageTimestamp < world.hudMessageLife ? world.hudMessage : '';
	if (hud.statsOverlay || (hud.menuOpen && hud.menuPage === 'testing')) {
		hud.renderStats = { ...view.stats(), ...world.perf.stats() };
	}
	if (prefs().fpsCounter) {
		const ms = view.frameMS(1000);
		hud.fps = ms > 0 ? Math.round(1000 / ms) : 0;
	}
	// A camera player has no hands: no cursor, loot hint or inventory.
	const pilot = player?.getComponent(PlayerInput);
	const input = pilot?.embodied ? pilot : undefined;
	hud.cursorName = input?.cursorName ?? '';
	const loot = player && input ? nearestPickup(player) : null;
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
	const body = input && player?.getComponent(HumanBody);
	hud.heldLeft = body ? slotItem(body, 'hands.left.held')?.name ?? '' : '';
	hud.heldRight = body ? slotItem(body, 'hands.right.held')?.name ?? '' : '';
	hud.back = body ? slotItem(body, 'back')?.name ?? '' : '';

	patchOverhead(world, hud, view, npcNotes, overheads);

	const p = player?.transform.position;
	const px = p?.x ?? 0;
	const pz = p?.z ?? 0;
	const stamp = minimapStamp(world, hud.minimapFollow, px, pz);
	if (stamp !== shown.minimapStamp) {
		shown.minimapStamp = stamp;
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
	const queue = host.arc?.queue;
	for (const mind of host.arc?.minds() ?? []) {
		const id = overheadID(host, mind);
		if (!id) {
			continue;
		}
		const tool = host.thinks.toolOf(id);
		if (queue?.isThinking(mind.id)) {
			out.push({ id, text: '', thinking: true, tool });
			continue;
		}
		const row = host.labels.get(id);
		const text = findObject(host.world, id)?.getComponent(Seated)?.asleep ? ASLEEP_LABEL : row && now < row.until ? row.text : '';
		if (text || tool) {
			out.push({ id, text, tool });
		}
	}
	return out;
}

/** How far beside the head a slate starts, px. */
const SLATE_GAP = 24;
/** How long before it goes that a slate fades, s. */
const SLATE_FADE = 0.3;

/** A think as the HUD reads it. */
function thinkRow(think:ThinkSlate):HudThink {
	return {
		seq: think.seq,
		id: think.id,
		name: think.name,
		color: think.color,
		why: think.why,
		thought: think.thought,
		arc: think.arc,
		state: think.state,
		error: think.error,
		wrong: Time.time < think.wrongUntil,
		ms: think.state === 'writing' ? performance.now() - think.began : think.ms,
	};
}

/** The AI log's list of thinks, while it is open. */
export function patchThinks(hud:HudView, host:GameHost):void {
	if (!hud.aiLogOpen) {
		return;
	}
	const thinks = host.thinks.thinks;
	hud.thinks.length = Math.min(hud.thinks.length, thinks.length);
	thinks.forEach((think, i) => {
		const shown = hud.thinks[i];
		if (shown) {
			Object.assign(shown, thinkRow(think));
		}
		else {
			hud.thinks.push(thinkRow(think));
		}
	});
}

/** Which side of `go` has fewer characters on screen; on a tie, the side away from the screen's middle. */
function emptierSide(world:DemoWorld, view:Renderer, go:GameObject | undefined, x:number):'left' | 'right' {
	let left = 0;
	let right = 0;
	world.forEachComponent(HumanBody, (body, other) => {
		const p = other.transform.position;
		const seen = other !== go && isLiving(other) ? view.projectToCanvas(p.x, p.y, p.z) : undefined;
		if (seen?.visible) {
			left += seen.x < x ? 1 : 0;
			right += seen.x < x ? 0 : 1;
		}
	});
	if (left !== right) {
		return left < right ? 'left' : 'right';
	}
	return x < view.canvas.clientWidth / 2 ? 'left' : 'right';
}

/**
 * Where each slate up wants to be: over the line of heads so it hides no one standing beside its writer, growing upward
 * from their head, on whichever side of them has fewer characters. Rows are reused, so a slate stays one element while
 * it is up.
 */
export function patchSlates(world:DemoWorld, hud:HudFrame, view:Renderer, host:GameHost):void {
	host.thinks.update();
	const up = [...host.thinks.slates.values()];
	hud.slates.length = Math.min(hud.slates.length, up.length);
	up.forEach((slate, i) => {
		const anchor = host.thinks.anchorOf(slate.id);
		const screen = anchor ? projectOverhead(anchor.go ?? anchor.stance, view) : { x: 0, y: 0, visible: false };
		slate.side ??= emptierSide(world, view, anchor?.go, screen.x);
		const row = {
			...thinkRow(slate),
			x: Math.round(slate.side === 'left' ? screen.x - SLATE_GAP - SLATE_WIDTH : screen.x + SLATE_GAP),
			y: Math.round(screen.y),
			visible: screen.visible,
			leaving: slate.until - Time.time < SLATE_FADE,
		};
		const shown = hud.slates[i];
		if (shown) {
			Object.assign(shown, row);
		}
		else {
			hud.slates.push(row);
		}
	});
}

export function patchInfer(host:GameHost, hud:HudView):void {
	hud.activeModel = host.arc?.getModel()?.id ?? '';
	// Only the menu's Arc Director page shows the model's clocks and each mind's heartrate.
	if (!hud.menuOpen || hud.menuPage !== 'testing') {
		return;
	}
	const infer = host.arc?.models.infer;
	const queue = host.arc?.queue;
	const now = Time.time;
	hud.mindStats = (host.arc?.minds() ?? []).map((mind) => {
		const last = mind.lastTacticalTimestamp;
		return {
			id: mind.id,
			rethink: queue?.rethinkSeconds(mind.id) ?? null,
			ago: Number.isFinite(last) ? Math.max(0, now - last) : null,
			thinking: queue?.isThinking(mind.id) ?? false,
			thinkMs: infer?.thinkMs[mind.id] ?? 0,
		};
	}).sort((a, b) => a.id.localeCompare(b.id));
	if (infer) {
		hud.infer = { ...infer };
	}
}

/** Progress steps the track shows; finer changes wait, so the HUD is not rewritten every frame. */
const GOAL_STEPS = 100;
/**
 * How far apart the two sides' mean screen X must be, as a share of the screen's width, before the track swaps ends:
 * no swapping while they are mixed in a melee, only once one side clearly stands on the other's end.
 */
const SWAP_APART = 0.1;

/** Mean screen X of the side's characters in view, or `undefined` with none. */
function screenX(world:DemoWorld, view:Renderer, side:SceneGoalSide | undefined):number | undefined {
	const xs:number[] = [];
	for (const id of side?.who ?? []) {
		const go = findObject(world, id);
		if (!isLiving(go)) {
			continue;
		}
		const p = go.transform.position;
		const screen = view.projectToCanvas(p.x, p.y, p.z);
		if (screen.visible) {
			xs.push(screen.x);
		}
	}
	return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined;
}

function hudSide(side:SceneGoalSide | undefined):HudGoalSide {
	return {
		color: side?.color ?? 'gold',
		goals: (side?.goals ?? []).map((goal) => ({
			name: goal.name,
			progress: Math.round(Math.max(0, Math.min(1, goal.progress)) * GOAL_STEPS) / GOAL_STEPS,
		})),
	};
}

/**
 * The scene's goal track, its sides on the ends their people stand nearest on screen, written only when it changes.
 * `shown.goalsSwapped`: whether its two sides are drawn swapped.
 */
export function patchGoals(world:DemoWorld, hud:HudFrame, view:Renderer, goals:SceneGoals | undefined, shown:{ goalsSwapped:boolean }):void {
	const left = screenX(world, view, goals?.left);
	const right = screenX(world, view, goals?.right);
	if (left !== undefined && right !== undefined) {
		const lead = shown.goalsSwapped ? left - right : right - left;
		if (lead < -SWAP_APART * view.canvas.clientWidth) {
			shown.goalsSwapped = !shown.goalsSwapped;
		}
	}
	const next = goals ? { left: hudSide(goals.left), right: hudSide(goals.right) } : noGoals();
	if (shown.goalsSwapped) {
		[next.left, next.right] = [next.right, next.left];
	}
	if (JSON.stringify(next) !== JSON.stringify(hud.goals)) {
		hud.goals = next;
	}
}

/** How close, m, the player stands to someone for their card to show without pointing at them. */
const INSPECT_NEAR = 2.5;
/** How far off straight ahead, radians, someone close may stand and still be looked at. */
const INSPECT_CONE = Math.PI / 4;
/** How far beside the character's middle the card starts, px. */
const INSPECT_GAP = 34;

/** Someone the card can be about: a living body that is not the player. */
function inspectable(go:GameObject | undefined):go is GameObject {
	return !!go && go.id !== 'Player' && isLiving(go) && !!go.getComponent(HumanBody);
}

/**
 * Where the player looks, as a yaw: their body's facing, or with no body (camera mode) the camera's. Yaw 0 faces −Z.
 */
function lookYaw(world:DemoWorld, player:GameObject):number {
	if (player.getComponent(PlayerInput)?.embodied !== false) {
		return player.transform.yaw;
	}
	let yaw = player.transform.yaw;
	world.forEachComponent(FollowCamera, (cam) => {
		yaw = cam.yaw;
	});
	return yaw;
}

/** Whether `go` stands within the cone straight ahead of `yaw` from `from`. */
function inView(from:GameObject, yaw:number, go:GameObject):boolean {
	const dx = go.transform.position.x - from.transform.position.x;
	const dz = go.transform.position.z - from.transform.position.z;
	const off = Math.atan2(-dx, -dz) - yaw;
	return Math.abs(Math.atan2(Math.sin(off), Math.cos(off))) <= INSPECT_CONE;
}

/** How wide a character stands on screen, as a share of how tall: the box the mouse hovers. */
const HOVER_WIDTH = 0.5;

/**
 * Whom the mouse is over, at any distance: the one whose box on screen (feet to crown) holds the pointer, the nearest
 * the camera when several overlap. With the pointer locked for mouse look, the middle of the screen.
 */
function hovered(world:DemoWorld, view:Renderer):GameObject | undefined {
	const input = world.input;
	const w = view.canvas.clientWidth;
	const h = view.canvas.clientHeight;
	const mx = ((input.pointerLocked ? 0 : input.mouseNdcX) * 0.5 + 0.5) * w;
	const my = (0.5 - (input.pointerLocked ? 0 : input.mouseNdcY) * 0.5) * h;
	let best:GameObject | undefined;
	let bestSize = 0;
	world.forEachComponent(HumanBody, (body, go) => {
		if (!inspectable(go)) {
			return;
		}
		const p = go.transform.position;
		const feet = view.projectToCanvas(p.x, p.y, p.z);
		const crown = view.projectToCanvas(p.x, p.y + (go.getComponent(Appearance)?.height ?? 1.7), p.z);
		const tall = feet.y - crown.y;
		const half = (tall * HOVER_WIDTH) / 2;
		// The biggest on screen is the nearest the camera.
		if (feet.visible && tall > bestSize && my >= crown.y && my <= feet.y && Math.abs(mx - feet.x) <= half) {
			best = go;
			bestSize = tall;
		}
	});
	return best;
}

/** Whom the card is about: whoever the mouse is over, else the nearest one close by whom the player looks at. */
function inspectTarget(world:DemoWorld, view:Renderer):GameObject | undefined {
	const pointed = hovered(world, view);
	if (pointed) {
		return pointed;
	}
	const player = world.findByID('Player');
	if (!player) {
		return undefined;
	}
	const yaw = lookYaw(world, player);
	let best:GameObject | undefined;
	let bestDist = INSPECT_NEAR;
	world.forEachComponent(HumanBody, (body, go) => {
		const d = distanceXZ(player, go);
		if (inspectable(go) && d <= bestDist && inView(player, yaw, go)) {
			best = go;
			bestDist = d;
		}
	});
	return best;
}

/** What they carry, by name and count; the pack they carry it in is no item of note. */
function carriedList(go:GameObject):HudInspect['items'] {
	const counts = new Map<string, number>();
	for (const it of listCarried(go)) {
		if (!isBackpack(it)) {
			counts.set(it.name, (counts.get(it.name) ?? 0) + it.count);
		}
	}
	return [...counts].map(([name, count]) => ({ name, count }));
}

/** The card beside whoever the player points at or stands close to, in scenes that have it. */
export function patchInspect(world:DemoWorld, hud:HudFrame, view:Renderer, host:GameHost, enabled:boolean):void {
	const go = enabled && prefs().characterTooltips ? inspectTarget(world, view) : undefined;
	const p = go?.transform.position;
	const screen = go && p ? view.projectToCanvas(p.x, p.y + (go.getComponent(Appearance)?.height ?? 1.7) * 0.6, p.z) : undefined;
	if (!go || !screen?.visible) {
		hud.inspect = null;
		return;
	}
	const id = idOf(go);
	const left = screen.x < view.canvas.clientWidth / 2;
	const persona = host.arc?.character(id)?.persona;
	const goal = [...(persona?.goals ?? [])].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))[0]?.text ?? '';
	const next:HudInspect = {
		id,
		name: id,
		// A role that only repeats the name says nothing.
		role: persona?.identity.role && persona.identity.role !== id ? persona.identity.role : '',
		traits: persona?.identity.traits ?? [],
		goal,
		gold: coinsOf(go),
		items: carriedList(go),
		x: Math.round(left ? screen.x - INSPECT_GAP : screen.x + INSPECT_GAP),
		y: Math.round(screen.y),
		side: left ? 'left' : 'right',
	};
	if (JSON.stringify(next) !== JSON.stringify(hud.inspect)) {
		hud.inspect = next;
	}
}
