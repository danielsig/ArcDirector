/** Pixel rects on `public/spritesheet.jpg` (1792×1008, origin top-left). */
export type PxRect = {
	x:number;
	y:number;
	w:number;
	h:number;
};

export const SHEET_W = 1792;
export const SHEET_H = 1008;

/** Magenta key sampled from (0,0). */
export const KEY_RGB = [119, 20, 64] as const;

export const WALK:PxRect[] = [
	{ x: 378, y: 39, w: 83, h: 134 },
	{ x: 482, y: 41, w: 78, h: 132 },
	{ x: 577, y: 42, w: 77, h: 131 },
	{ x: 680, y: 42, w: 81, h: 131 },
	{ x: 783, y: 48, w: 84, h: 126 },
	{ x: 894, y: 49, w: 84, h: 124 },
	{ x: 1010, y: 45, w: 78, h: 128 },
];

export const IDLE_FRONT:PxRect = { x: 48, y: 200, w: 84, h: 130 };
export const IDLE_SIDE:PxRect = { x: 161, y: 200, w: 95, h: 130 };
export const WALK_BACK:PxRect = { x: 1124, y: 45, w: 107, h: 128 };

/** Pixel rects on `public/spritesheet_forward_walk.jpg` (641×239). */
export const FWD_SHEET_W = 641;
export const FWD_SHEET_H = 239;
export const FWD_KEY_RGB = [103, 17, 52] as const;

export const WALK_FWD:PxRect[] = [
	{ x: 28, y: 47, w: 121, h: 152 },
	{ x: 184, y: 47, w: 122, h: 154 },
	{ x: 337, y: 47, w: 120, h: 155 },
	{ x: 493, y: 47, w: 123, h: 154 },
];
/** Planted-feet pose (second frame). */
export const IDLE_FWD:PxRect = WALK_FWD[1];

export const TORCH_STICK:PxRect = { x: 1508, y: 568, w: 38, h: 56 };

/** Floor-item pickups on `spritesheet.jpg`. */
export const ITEM_KEY:PxRect = { x: 811, y: 832, w: 50, h: 97 };
export const ITEM_BOMB:PxRect = { x: 1298, y: 677, w: 63, h: 94 };
export const ITEM_SWORD:PxRect = { x: 742, y: 222, w: 47, h: 107 };
export const ITEM_TORCH:PxRect = { x: 1504, y: 503, w: 46, h: 125 };
export const ITEM_POTION:PxRect = { x: 1183, y: 821, w: 56, h: 52 };
/** Left bracer on the front idle pose — no standalone glove sprite. */
export const ITEM_GLOVE:PxRect = { x: 50, y: 268, w: 22, h: 36 };

/** Magenta is for `spritesheet.jpg`; `chests.jpg` uses near-black. */
export const CHEST_KEY_RGB = [18, 18, 20] as const;

/** Pixel rects on `public/chests.jpg` (1792×1008, origin top-left). */
export const CHEST_FRONT:PxRect = { x: 85, y: 131, w: 136, h: 69 };
export const CHEST_BACK:PxRect = { x: 1012, y: 318, w: 99, h: 76 };
export const CHEST_LEFT:PxRect = { x: 710, y: 144, w: 86, h: 59 };
export const CHEST_RIGHT:PxRect = { x: 854, y: 144, w: 86, h: 59 };
/** Even lid wrap (metal at the ends, wood across — not the lock-strap front). */
export const CHEST_LID:PxRect = { x: 872, y: 255, w: 72, h: 48 };
export const CHEST_LID_END_L:PxRect = { x: 710, y: 74, w: 86, h: 70 };
export const CHEST_LID_END_R:PxRect = { x: 854, y: 74, w: 86, h: 70 };
export const CHEST_BOTTOM:PxRect = { x: 710, y: 144, w: 86, h: 59 };

export const FLAME:PxRect[] = [
	{ x: 128, y: 848, w: 39, h: 44 },
	{ x: 235, y: 848, w: 37, h: 44 },
	{ x: 329, y: 848, w: 38, h: 44 },
	{ x: 444, y: 848, w: 37, h: 44 },
	{ x: 573, y: 848, w: 38, h: 44 },
];
