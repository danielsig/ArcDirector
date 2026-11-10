/** A tile of the grid. Tile `(tx, tz)` spans `[tx * tileSize, (tx + 1) * tileSize)` on each axis. Not a point: `tileCenter` makes one. */
export type TileCoord = { tx:number; tz:number };

/** A chunk of the grid, `chunkSize` tiles a side. */
export type ChunkCoord = { cx:number; cz:number };

/** A tile inside its chunk, from its north-west corner. */
export type LocalCoord = { localX:number; localZ:number };
