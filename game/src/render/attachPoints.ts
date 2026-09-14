import type { HumanKind } from '../engine/components';
import { characterHandPoses, type HandPose } from './artCache';
import { flipPairHour, snapWalkHour, type ClockHour, type IdleHour, type WalkHour } from './humanAnims';

export type Px = {
	x:number;
	y:number;
	r?:number;
};

export type Hands = {
	left:Px;
	right:Px;
};

/**
 * Idle-frame pixel coords (origin top-left) for each authored hour.
 * Image-left is `left`, image-right is `right` (player sword hand).
 * FlipX on the character sprite mirrors both with the body.
 * Hour 2 = 1:30 (45° from 12); hour 4 = 4:30 (135° from 12).
 *
 * Player idle/walk points are in fitted-card pixels (`PLAYER_CARD`). Other kinds
 * keep the earlier idle estimates.
 */
export const PLAYER_CARD = { w: 384, h: 512 };
export const IDLE_HANDS:Record<HumanKind, Record<IdleHour, Hands>> = {
	player: {
		12: { left: { x: 28, y: 160 }, right: { x: 148, y: 156 } },
		1: { left: { x: 28, y: 148 }, right: { x: 156, y: 156 } },
		2: { left: { x: 36, y: 142 }, right: { x: 148, y: 154 } },
		3: { left: { x: 56, y: 158 }, right: { x: 140, y: 164 } },
		4: { left: { x: 74, y: 164 }, right: { x: 132, y: 162 } },
		5: { left: { x: 28, y: 170 }, right: { x: 152, y: 164 } },
		6: { left: { x: 30, y: 158 }, right: { x: 152, y: 150 } },
	},
	guard: {
		12: { left: { x: 12, y: 83 }, right: { x: 61, y: 83 } },
		1: { left: { x: 14, y: 79 }, right: { x: 59, y: 86 } },
		2: { left: { x: 14, y: 78 }, right: { x: 59, y: 85 } },
		3: { left: { x: 32, y: 87 }, right: { x: 44, y: 72 } },
		4: { left: { x: 19, y: 84 }, right: { x: 62, y: 79 } },
		5: { left: { x: 17, y: 85 }, right: { x: 61, y: 78 } },
		6: { left: { x: 12, y: 83 }, right: { x: 61, y: 83 } },
	},
	robe: {
		12: { left: { x: 12, y: 89 }, right: { x: 63, y: 89 } },
		1: { left: { x: 16, y: 83 }, right: { x: 60, y: 91 } },
		2: { left: { x: 31, y: 80 }, right: { x: 57, y: 92 } },
		3: { left: { x: 35, y: 93 }, right: { x: 51, y: 86 } },
		4: { left: { x: 16, y: 91 }, right: { x: 63, y: 84 } },
		5: { left: { x: 14, y: 90 }, right: { x: 63, y: 82 } },
		6: { left: { x: 12, y: 88 }, right: { x: 63, y: 88 } },
	},
	merchant: {
		12: { left: { x: 13, y: 70 }, right: { x: 61, y: 71 } },
		1: { left: { x: 13, y: 84 }, right: { x: 60, y: 93 } },
		2: { left: { x: 14, y: 80 }, right: { x: 58, y: 94 } },
		3: { left: { x: 31, y: 91 }, right: { x: 47, y: 80 } },
		4: { left: { x: 14, y: 89 }, right: { x: 52, y: 82 } },
		5: { left: { x: 10, y: 88 }, right: { x: 65, y: 89 } },
		6: { left: { x: 13, y: 72 }, right: { x: 63, y: 70 } },
	},
	princess: {
		12: { left: { x: 10, y: 86 }, right: { x: 58, y: 86 } },
		1: { left: { x: 14, y: 84 }, right: { x: 56, y: 86 } },
		2: { left: { x: 16, y: 84 }, right: { x: 54, y: 86 } },
		3: { left: { x: 15, y: 86 }, right: { x: 56, y: 84 } },
		4: { left: { x: 14, y: 86 }, right: { x: 58, y: 82 } },
		5: { left: { x: 14, y: 84 }, right: { x: 56, y: 82 } },
		6: { left: { x: 15, y: 82 }, right: { x: 53, y: 82 } },
	},
	sorceress: {
		12: { left: { x: 13, y: 86 }, right: { x: 66, y: 86 } },
		1: { left: { x: 18, y: 84 }, right: { x: 62, y: 86 } },
		2: { left: { x: 22, y: 84 }, right: { x: 59, y: 86 } },
		3: { left: { x: 19, y: 85 }, right: { x: 60, y: 84 } },
		4: { left: { x: 16, y: 86 }, right: { x: 61, y: 82 } },
		5: { left: { x: 13, y: 85 }, right: { x: 64, y: 83 } },
		6: { left: { x: 11, y: 84 }, right: { x: 67, y: 84 } },
	},
};

/**
 * Player walk-cycle hands per authored hour (8 frames). Right = sword hand.
 * Missing left fists fall back to that hour's idle left.
 * 2 = 1:30 / 45° from 12; 4 = 4:30 / 135° from 12.
 */
export const PLAYER_WALK_HANDS:Partial<Record<WalkHour, Hands[]>> = {
	12: expandWalkHands([
		{ left: { x: 28, y: 160 }, right: { x: 140, y: 136 } },
		{ left: { x: 22, y: 162 }, right: { x: 136, y: 142 } },
		{ left: { x: 28, y: 160 }, right: { x: 136, y: 140 } },
		{ left: { x: 34, y: 146 }, right: { x: 146, y: 146 } },
	]),
	2: expandWalkHands([
		{ left: { x: 36, y: 142 }, right: { x: 134, y: 164 } },
		{ left: { x: 36, y: 142 }, right: { x: 130, y: 150 } },
		{ left: { x: 36, y: 142 }, right: { x: 132, y: 154 } },
		{ left: { x: 36, y: 142 }, right: { x: 132, y: 166 } },
	]),
	4: expandWalkHands([
		{ left: { x: 54, y: 144 }, right: { x: 130, y: 162 } },
		{ left: { x: 54, y: 144 }, right: { x: 128, y: 150 } },
		{ left: { x: 58, y: 144 }, right: { x: 132, y: 156 } },
		{ left: { x: 48, y: 144 }, right: { x: 128, y: 152 } },
	]),
	3: expandWalkHands([
		{ left: { x: 56, y: 158 }, right: { x: 140, y: 164 } },
		{ left: { x: 52, y: 154 }, right: { x: 136, y: 158 } },
		{ left: { x: 56, y: 158 }, right: { x: 140, y: 160 } },
		{ left: { x: 48, y: 152 }, right: { x: 136, y: 156 } },
	]),
	6: expandWalkHands([
		{ left: { x: 34, y: 150 }, right: { x: 146, y: 136 } },
		{ left: { x: 34, y: 150 }, right: { x: 148, y: 134 } },
		{ left: { x: 40, y: 146 }, right: { x: 144, y: 140 } },
		{ left: { x: 30, y: 156 }, right: { x: 136, y: 130 } },
	]),
};

function lerpPx(a:Px, b:Px, t:number):Px {
	return {
		x: Math.round(a.x + (b.x - a.x) * t),
		y: Math.round(a.y + (b.y - a.y) * t),
	};
}

function expandWalkHands(beats:Hands[]):Hands[] {
	const out:Hands[] = [];
	for (let i = 0; i < beats.length; i++) {
		const a = beats[i];
		const b = beats[(i + 1) % beats.length];
		out.push(a);
		out.push({
			left: lerpPx(a.left, b.left, 0.5),
			right: lerpPx(a.right, b.right, 0.5),
		});
	}
	return out;
}

function mirrorHands(frames:Hands[]):Hands[] {
	const w = PLAYER_CARD.w;
	return frames.map((h) => ({
		left: { x: w - h.left.x, y: h.left.y },
		right: { x: w - h.right.x, y: h.right.y },
	}));
}

PLAYER_WALK_HANDS[8] = mirrorHands(PLAYER_WALK_HANDS[4] ?? []);
PLAYER_WALK_HANDS[9] = mirrorHands(PLAYER_WALK_HANDS[3] ?? []);
PLAYER_WALK_HANDS[10] = mirrorHands(PLAYER_WALK_HANDS[2] ?? []);

/** Near-hand edge of the blade (grip omitted so the fist covers it). */
export const SWORD_HILT:Partial<Record<WalkHour, Px>> = {
	12: { x: 7, y: 30 },
	2: { x: 4, y: 27 },
	3: { x: 6, y: 23 },
	4: { x: 7, y: 19 },
	6: { x: 4, y: 29 },
};

/** Bottom tip of `torchStick` (38×56). Thumb sits on the butt, not the card center. */
export const TORCH_GRIP = { x: 19, y: 54 };

/** Local +Z faces the camera after the character billboard. */
const HELD_DEPTH = 0.03;

/**
 * Far-side fists hide held sprites behind the body. Left is far on the
 * right-flank hours (2 / 3 / 4). Right is far on the left-flank hours
 * (8 / 9 / 10). Both are far on the back (12).
 */
export function heldItemBehind(side:'left' | 'right', hour:number):boolean {
	const h = snapWalkHour(hour);
	if (side === 'left') {
		return h === 12 || h === 2 || h === 3 || h === 4;
	}
	return h === 12 || h === 8 || h === 9 || h === 10;
}

export function heldItemDepth(side:'left' | 'right', hour:number):number {
	return heldItemBehind(side, hour) ? -HELD_DEPTH : HELD_DEPTH;
}

/** Pixel grip on a held item card. Per-yaw art (sword) has its own hilt. */
export function heldItemGrip(meshID:string, hour:ClockHour):Px | undefined {
	if (meshID === 'item_sword') {
		return SWORD_HILT[6] ?? SWORD_HILT[4];
	}
	if (meshID === 'item_torch') {
		return TORCH_GRIP;
	}
	return undefined;
}

function withZeroR(p:Px):HandPose {
	return { x: p.x, y: p.y, r: p.r ?? 0 };
}

function pickPose(frames:HandPose[] | undefined, walking:boolean, walkFrame:number):HandPose | undefined {
	if (!frames?.length) {
		return undefined;
	}
	let i = 0;
	if (walking) {
		i = frames.length >= 9 ? 1 + walkFrame : walkFrame;
	}
	const n = frames.length;
	i = ((i % n) + n) % n;
	return frames[i];
}

export function idleHands(kind:HumanKind, hour:ClockHour):Hands {
	const packed = packedHands(kind, hour, false, 0);
	if (packed) {
		return packed;
	}
	const table = IDLE_HANDS[kind] ?? IDLE_HANDS.player;
	const pair = flipPairHour(hour);
	const raw = table[hour as IdleHour]
		?? table[snapWalkHour(hour) as IdleHour]
		?? table[pair as IdleHour]
		?? table[6];
	return { left: withZeroR(raw.left), right: withZeroR(raw.right) };
}

function packedHands(
	kind:HumanKind,
	hour:ClockHour,
	walking:boolean,
	walkFrame:number,
):Hands | undefined {
	const walkHour = snapWalkHour(hour);
	const keys = walking ? [walkHour, hour] : [hour, walkHour];
	let left:HandPose | undefined;
	let right:HandPose | undefined;
	for (const key of keys) {
		left ??= pickPose(characterHandPoses(kind, 'left', key), walking, walkFrame);
		right ??= pickPose(characterHandPoses(kind, 'right', key), walking, walkFrame);
	}
	if (!left && !right) {
		return undefined;
	}
	const fallback = left ?? right;
	if (!fallback) {
		return undefined;
	}
	return { left: left ?? fallback, right: right ?? fallback };
}

/** Hands for the current pose. Authored `character.json` left/right when present. */
export function handsAt(
	kind:HumanKind,
	hour:ClockHour,
	walking:boolean,
	walkFrame = 0,
):Hands {
	const packed = packedHands(kind, hour, walking, walkFrame);
	if (packed) {
		return packed;
	}
	if (kind === 'player' && walking) {
		const wh = snapWalkHour(hour);
		const frames = PLAYER_WALK_HANDS[wh];
		const idle = idleHands(kind, hour);
		if (frames?.length) {
			const i = ((walkFrame % frames.length) + frames.length) % frames.length;
			const hands = frames[i] ?? idle;
			return {
				left: withZeroR(hands.left ?? idle.left),
				right: withZeroR(hands.right ?? idle.right),
			};
		}
	}
	return idleHands(kind, hour);
}

export function swordClockHour(hour:ClockHour):WalkHour {
	const walk = snapWalkHour(hour);
	if (walk === 2 || walk === 4 || walk === 6 || walk === 12) {
		return walk;
	}
	const pair = flipPairHour(walk);
	if (pair === 2 || pair === 4 || pair === 6 || pair === 12) {
		return pair;
	}
	return 4;
}
