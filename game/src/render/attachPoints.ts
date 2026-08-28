import type { HumanKind } from '../engine/components';
import { snapWalkHour, type IdleHour, type WalkHour } from './humanAnims';

export type Px = {
	x:number;
	y:number;
};

export type Hands = {
	left:Px;
	right:Px;
};

/**
 * Idle-frame pixel coords (origin top-left) for each authored hour.
 * Image-left is `left`, image-right is `right` (player sword hand).
 * FlipX on the character sprite mirrors both with the body.
 *
 * Player idle/walk points remeasured from restored art (sword-adjacent skin /
 * crossguard). Other kinds keep the earlier idle estimates.
 */
export const IDLE_HANDS:Record<HumanKind, Record<IdleHour, Hands>> = {
	player: {
		12: { left: { x: 14, y: 80 }, right: { x: 74, y: 78 } },
		1: { left: { x: 14, y: 74 }, right: { x: 78, y: 78 } },
		2: { left: { x: 18, y: 71 }, right: { x: 74, y: 77 } },
		3: { left: { x: 28, y: 79 }, right: { x: 70, y: 82 } },
		4: { left: { x: 37, y: 82 }, right: { x: 66, y: 81 } },
		5: { left: { x: 14, y: 85 }, right: { x: 76, y: 82 } },
		6: { left: { x: 15, y: 79 }, right: { x: 76, y: 75 } },
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
 * Player walk-cycle hands per authored hour (4 frames). Right = sword hand.
 * Missing left fists fall back to that hour's idle left.
 */
export const PLAYER_WALK_HANDS:Record<WalkHour, Hands[]> = {
	12: [
		{ left: { x: 14, y: 80 }, right: { x: 70, y: 68 } },
		{ left: { x: 11, y: 81 }, right: { x: 68, y: 71 } },
		{ left: { x: 14, y: 80 }, right: { x: 68, y: 70 } },
		{ left: { x: 17, y: 73 }, right: { x: 73, y: 73 } },
	],
	2: [
		{ left: { x: 18, y: 71 }, right: { x: 67, y: 82 } },
		{ left: { x: 18, y: 71 }, right: { x: 65, y: 75 } },
		{ left: { x: 18, y: 71 }, right: { x: 66, y: 77 } },
		{ left: { x: 18, y: 71 }, right: { x: 66, y: 83 } },
	],
	4: [
		{ left: { x: 27, y: 72 }, right: { x: 65, y: 81 } },
		{ left: { x: 27, y: 72 }, right: { x: 64, y: 75 } },
		{ left: { x: 29, y: 72 }, right: { x: 66, y: 78 } },
		{ left: { x: 24, y: 72 }, right: { x: 64, y: 76 } },
	],
	6: [
		{ left: { x: 17, y: 75 }, right: { x: 73, y: 68 } },
		{ left: { x: 17, y: 75 }, right: { x: 74, y: 67 } },
		{ left: { x: 20, y: 73 }, right: { x: 72, y: 70 } },
		{ left: { x: 15, y: 78 }, right: { x: 68, y: 65 } },
	],
};

/** Near-hand edge of the blade (grip omitted so the fist covers it). */
export const SWORD_HILT:Record<WalkHour, Px> = {
	12: { x: 7, y: 30 },
	2: { x: 4, y: 27 },
	4: { x: 7, y: 19 },
	6: { x: 4, y: 29 },
};

export function idleHands(kind:HumanKind, hour:IdleHour):Hands {
	return IDLE_HANDS[kind][hour] ?? IDLE_HANDS[kind][snapWalkHour(hour)];
}

/** Hands for the current pose. Player walk uses per-frame points. */
export function handsAt(
	kind:HumanKind,
	hour:IdleHour,
	walking:boolean,
	walkFrame = 0,
):Hands {
	if (kind === 'player' && walking) {
		const wh = snapWalkHour(hour);
		const frames = PLAYER_WALK_HANDS[wh];
		const idle = idleHands(kind, hour);
		if (frames?.length) {
			const i = ((walkFrame % frames.length) + frames.length) % frames.length;
			const hands = frames[i] ?? idle;
			return {
				left: hands.left ?? idle.left,
				right: hands.right ?? idle.right,
			};
		}
	}
	return idleHands(kind, hour);
}

export function swordClockHour(hour:IdleHour):WalkHour {
	return snapWalkHour(hour);
}
