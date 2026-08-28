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
};

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
