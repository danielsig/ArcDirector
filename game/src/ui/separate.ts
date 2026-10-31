/** A rectangle on screen, px: its top left corner and its size. */
export type Box = { x:number; y:number; w:number; h:number };

/** How much room the screen leaves, px. */
export type ScreenRoom = { left:number; top:number; right:number; bottom:number };

/** Passes of pushing apart: enough for a small crowd to settle, and it goes on settling next frame. */
const PASSES = 4;

/** How far `a` has to go to clear `b` with `gap` to spare, along whichever axis is shortest: `a` goes by (x, y). Null if clear already. */
function clearing(a:Box, b:Box, gap:number):{ x:number; y:number } | null {
	const across = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) + gap;
	const down = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) + gap;
	if (across <= 0 || down <= 0) {
		return null;
	}
	return across < down
		? { x: a.x + a.w / 2 < b.x + b.w / 2 ? -across : across, y: 0 }
		: { x: 0, y: a.y + a.h / 2 < b.y + b.h / 2 ? -down : down };
}

/** Moves `box` by (x, y), as far as the screen lets it; how far it really went. */
function move(box:Box, x:number, y:number, room:ScreenRoom):{ x:number; y:number } {
	const fromX = box.x;
	const fromY = box.y;
	box.x = Math.max(room.left, Math.min(room.right - box.w, box.x + x));
	box.y = Math.max(room.top, Math.min(room.bottom - box.h, box.y + y));
	return { x: box.x - fromX, y: box.y - fromY };
}

/**
 * Pushes `boxes` apart, and out of `walls` (which stay put), a few passes of simple 2D physics: two that overlap each
 * move half of what clears them, the shorter way, and whatever one cannot do against the screen's edge falls on the
 * other, as a wall's whole share falls on the box. Moves them in place. Run each frame from where the last left them,
 * and they slide clear rather than jump.
 */
export function separate(boxes:Box[], walls:readonly Box[], room:ScreenRoom, gap = 6):void {
	boxes.forEach((box) => move(box, 0, 0, room));
	for (let pass = 0; pass < PASSES; pass += 1) {
		boxes.forEach((a, i) => {
			for (const b of boxes.slice(i + 1)) {
				const push = clearing(a, b, gap);
				if (push) {
					const went = move(a, push.x / 2, push.y / 2, room);
					const back = move(b, went.x - push.x, went.y - push.y, room);
					move(a, push.x + back.x - went.x, push.y + back.y - went.y, room);
				}
			}
			for (const wall of walls) {
				const push = clearing(a, wall, gap);
				if (push) {
					move(a, push.x, push.y, room);
				}
			}
		});
	}
}
