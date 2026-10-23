/** How far a stall vendor may step from the post they spawned on. */
export const STALL_LEASH = 4;

export const CHUNK_SIZE = 16;
/** A map boulder's size range, as a scale on its look: picked by where it stands, mostly small to middling. */
export const BOULDER_SIZE = { min: 0.55, max: 1.6 };
export const CELL_SIZE = 1;
export const TILE_HEIGHT = 0.7;
/** 14 brick courses of 0.175 m: a stair step is one course and TILE_HEIGHT four, so bricks line up. */
export const WALL_HEIGHT = 2.45;
/** Moonlight blue: a moon window's pane, and the light it lets in. */
export const MOON_BLUE = 0xa8ccff;
/** A moon window's opening, cut right through its wall: width along the face, height, and its middle's height above the floor. */
export const MOON_WINDOW = { width: 0.9, height: 0.24, y: 1.95 } as const;
