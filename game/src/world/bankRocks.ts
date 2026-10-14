import { hash } from '@arc-director/kindling';
import type { Chunk } from './Chunk';
import { CELL_SIZE, CHUNK_SIZE } from './constants';
import { showsWater } from './water';

/** A rock lining a riverbank: where it stands, its turn, and its size (1 = the rock mesh as built). */
export type BankRock = { x:number; z:number; yaw:number; scale:number };

/** Ground a scale-1 rock blocks: a cylinder this wide. A little under the mesh, so feet can brush it. */
export const BANK_ROCK_WIDTH = 1;

const DIRS = [[0, -1], [0, 1], [-1, 0], [1, 0]] as const;

/**
 * The rocks that make a chunk's riverbanks: one or two per water cell beside grass, each centred just
 * inside the grass edge so it stands out into the water and hides the seam. None at a waterfall, and
 * none at a crossing (a footbridge deck or a drawbridge span, or water beside one) so its way on stays clear.
 * Pure planning: the chunk mesh draws these and `syncDressingColliders` makes them solid.
 */
export function planBankRocks(chunk:Chunk):BankRock[] {
	const at = (def:string) => new Set(chunk.entities.filter((e) => e.def === def).map((e) => `${e.localX},${e.localZ}`));
	const falls = at('waterfall');
	const spans = at('bridge_span');
	const crossing = (lx:number, lz:number) => spans.has(`${lx},${lz}`) || chunk.tile(lx, lz)?.def === 'bridge';
	const nearCrossing = (lx:number, lz:number) => [-1, 0, 1].some((dx) => [-1, 0, 1].some((dz) => crossing(lx + dx, lz + dz)));
	const ox = chunk.worldOriginX();
	const oz = chunk.worldOriginZ();
	const rocks:BankRock[] = [];
	chunk.forEachTile((tile, lx, lz) => {
		if (!showsWater(tile.def) || falls.has(`${lx},${lz}`) || nearCrossing(lx, lz)) {
			return;
		}
		const banks = DIRS.filter(([dx, dz]) => chunk.tile(lx + dx, lz + dz)?.def === 'grass');
		if (banks.length === 0) {
			return;
		}
		const gx = chunk.origin.cx * CHUNK_SIZE + lx;
		const gz = chunk.origin.cz * CHUNK_SIZE + lz;
		const count = 1 + (hash(gx, gz, 5) > 0.45 ? 1 : 0);
		for (let i = 0; i < count; i++) {
			const [dx, dz] = banks[Math.floor(hash(gx, gz, 17 + i * 4) * banks.length) % banks.length]!;
			const along = 0.16 + hash(gx, gz, 23 + i * 7) * 0.68;
			const ontoGrass = 0.07 + hash(gx, gz, 29 + i * 13) * 0.22;
			const u = dx === 0 ? along : (dx > 0 ? ontoGrass : 1 - ontoGrass);
			const v = dz === 0 ? along : (dz > 0 ? ontoGrass : 1 - ontoGrass);
			rocks.push({
				x: ox + (lx + dx + u) * CELL_SIZE,
				z: oz + (lz + dz + v) * CELL_SIZE,
				yaw: hash(gx, gz, 83 + i) * Math.PI * 2,
				scale: 0.68 + hash(gx, gz, 97 + i * 3) * 0.42,
			});
		}
	});
	return rocks;
}
