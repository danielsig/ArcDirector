/**
 * Pixel rects on `public/sprites.jpg` and its `_normal.png` and `_metallic.jpg` (256×241, origin top-left): only the
 * sprites the game cuts out, packed on the magenta key.
 */
export type PxRect = {
	x:number;
	y:number;
	w:number;
	h:number;
};

/** The magenta key around every sprite. */
export const KEY_RGB = [119, 20, 64] as const;

export const TORCH_STICK:PxRect = { x: 0, y: 133, w: 38, h: 56 };

/** Floor-item pickups on `sprites.jpg`. */
export const ITEM_KEY:PxRect = { x: 109, y: 0, w: 50, h: 97 };
export const ITEM_BOMB:PxRect = { x: 167, y: 0, w: 63, h: 94 };
export const ITEM_SWORD:PxRect = { x: 54, y: 0, w: 47, h: 107 };
export const ITEM_TORCH:PxRect = { x: 0, y: 0, w: 46, h: 125 };
export const ITEM_POTION:PxRect = { x: 46, y: 133, w: 56, h: 52 };
/** A left bracer, cut from a character pose: there is no glove sprite of its own. */
export const ITEM_GLOVE:PxRect = { x: 91, y: 197, w: 22, h: 36 };

/** Magenta is for `sprites.jpg`; `chest.jpg` uses near-black. */
export const CHEST_KEY_RGB = [18, 18, 20] as const;

/**
 * Pixel rects on `public/chest.jpg` and its `_normal.png` and `_metallic.jpg` (256×209, origin top-left): only the
 * chest's faces, packed.
 */
export const CHEST_FRONT:PxRect = { x: 88, y: 78, w: 136, h: 69 };
export const CHEST_BACK:PxRect = { x: 0, y: 0, w: 99, h: 76 };
export const CHEST_LEFT:PxRect = { x: 0, y: 150, w: 86, h: 59 };
export const CHEST_RIGHT:PxRect = { x: 88, y: 150, w: 86, h: 59 };
/** Even lid wrap (metal at the ends, wood across — not the lock-strap front). */
export const CHEST_LID:PxRect = { x: 176, y: 150, w: 72, h: 48 };
export const CHEST_LID_END_L:PxRect = { x: 101, y: 0, w: 86, h: 70 };
export const CHEST_LID_END_R:PxRect = { x: 0, y: 78, w: 86, h: 70 };
export const CHEST_BOTTOM:PxRect = CHEST_LEFT;

export const FLAME:PxRect[] = [
	{ x: 110, y: 133, w: 39, h: 44 },
	{ x: 157, y: 133, w: 37, h: 44 },
	{ x: 202, y: 133, w: 38, h: 44 },
	{ x: 0, y: 197, w: 37, h: 44 },
	{ x: 45, y: 197, w: 38, h: 44 },
];
