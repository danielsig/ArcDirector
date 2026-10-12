import { CHUNK_SIZE } from './constants';
import { Chunk, type ChunkEntity, type Tile } from './Chunk';

export type TerrainLegend = {
	def:string;
	height:number;
	blocked?:boolean;
	flow?:{ x:number; z:number };
};

export type EntityLegend = {
	kind:'entity';
	def:string;
	axis?:'x' | 'z';
	over?:string;
	keyID?:string;
	locked?:boolean;
	open?:boolean;
	exit?:boolean;
	/** Radians. Turns a prop glyph; otherwise it faces off a wall it stands against. */
	yaw?:number;
	/** What reading or examining it says (an inscription). */
	text?:string;
	/** What a chest holds. */
	contents?:LootSpec[];
};

/** Items made fresh into a chest or a pack: the def, the name everyone calls it by, and how many. */
export type LootSpec = { defID:string; name:string; count?:number };

export type ChunkFile = {
	id:string;
	origin:{ cx:number; cz:number };
	legend:Record<string, TerrainLegend | EntityLegend>;
	tiles:string[];
	names?:Record<string, string>;
};

function isEntity(spec:TerrainLegend | EntityLegend):spec is EntityLegend {
	return 'kind' in spec && spec.kind === 'entity';
}

const impliedFloor:Tile = {
	def: 'floor',
	height: 0,
	blocked: false,
};

export type DecodedChunk = {
	chunk:Chunk;
	playerStart:{ x:number; z:number } | null;
};

export function decodeGlyphChunk(file:ChunkFile):DecodedChunk {
	if (file.tiles.length !== CHUNK_SIZE) {
		throw new Error(`chunk ${file.id}: expected ${CHUNK_SIZE} rows, got ${file.tiles.length}`);
	}

	const tiles:Tile[] = [];
	const entities:ChunkEntity[] = [];
	let playerStart:{ x:number; z:number } | null = null;
	const chunk = new Chunk(file.id, file.origin, tiles, entities);

	for (let localZ = 0; localZ < CHUNK_SIZE; localZ++) {
		const row = file.tiles[localZ];
		if (row.length !== CHUNK_SIZE) {
			throw new Error(
				`chunk ${file.id}: row ${localZ} length ${row.length}, expected ${CHUNK_SIZE}`,
			);
		}
		for (let localX = 0; localX < CHUNK_SIZE; localX++) {
			const glyph = row[localX];
			const spec = file.legend[glyph];
			if (!spec) {
				throw new Error(`chunk ${file.id}: unknown glyph '${glyph}' at ${localX},${localZ}`);
			}
			if (isEntity(spec)) {
				const overGlyph = spec.over ?? '.';
				const overSpec = file.legend[overGlyph];
				if (overSpec && !isEntity(overSpec)) {
					tiles.push({
						def: overSpec.def,
						height: overSpec.height,
						blocked: overSpec.blocked ?? overSpec.def === 'wall',
						flow: overSpec.flow,
					});
				}
				else {
					tiles.push({ ...impliedFloor });
				}
				if (spec.def === 'player_start') {
					playerStart = chunk.worldCellCenter(localX, localZ);
				}
				else {
					entities.push({
						def: spec.def,
						localX,
						localZ,
						glyph,
						axis: spec.axis,
						name: file.names?.[glyph],
						keyID: spec.keyID,
						locked: spec.locked,
						open: spec.open,
						exit: spec.exit,
						yaw: spec.yaw,
						text: spec.text,
						contents: spec.contents,
					});
				}
			}
			else {
				tiles.push({
					def: spec.def,
					height: spec.height,
					blocked: spec.blocked ?? spec.def === 'wall',
					flow: spec.flow,
				});
			}
		}
	}

	return { chunk, playerStart };
}

/**
 * Cut one map, `CHUNK_SIZE` cells to a chunk on both axes, into chunk files `${prefix}_${cx}_${cz}`. `names` are
 * shared by every chunk, so a named glyph must be unique across the whole map.
 */
export function splitGlyphMap(
	prefix:string,
	legend:ChunkFile['legend'],
	rows:string[],
	names:Record<string, string> = {},
):ChunkFile[] {
	const width = rows[0]?.length ?? 0;
	if (rows.length % CHUNK_SIZE !== 0 || width % CHUNK_SIZE !== 0 || rows.some((row) => row.length !== width)) {
		throw new Error(`${prefix} map must be whole chunks: ${width} × ${rows.length}`);
	}
	const files:ChunkFile[] = [];
	for (let cz = 0; cz < rows.length / CHUNK_SIZE; cz++) {
		for (let cx = 0; cx < width / CHUNK_SIZE; cx++) {
			files.push({
				id: chunkName(prefix, cx, cz),
				origin: { cx, cz },
				legend,
				tiles: rows.slice(cz * CHUNK_SIZE, (cz + 1) * CHUNK_SIZE).map((row) => row.slice(cx * CHUNK_SIZE, (cx + 1) * CHUNK_SIZE)),
				names,
			});
		}
	}
	return files;
}

function chunkName(prefix:string, cx:number, cz:number):string {
	return `${prefix}_${cx}_${cz}`;
}

/** Where map cell `x`, `z` of a {@link splitGlyphMap} map lands: for an NPC spawn. */
export function mapCell(prefix:string, x:number, z:number):{ chunkID:string; localX:number; localZ:number } {
	return {
		chunkID: chunkName(prefix, Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE)),
		localX: x % CHUNK_SIZE,
		localZ: z % CHUNK_SIZE,
	};
}
