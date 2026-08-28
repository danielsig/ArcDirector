import type { ChunkFile } from '../../world/decodeGlyphChunk';
import { chunkKey } from '../../engine/World';
import { dungeon_0_0 } from './dungeon_0_0';
import { dungeon_1_0 } from './dungeon_1_0';

export const CHUNK_FILES:ChunkFile[] = [dungeon_0_0, dungeon_1_0];

export function chunkFileAt(cx:number, cz:number):ChunkFile | undefined {
	return CHUNK_FILES.find((f) => f.origin.cx === cx && f.origin.cz === cz);
}

export function allChunkKeys():string[] {
	return CHUNK_FILES.map((f) => chunkKey(f.origin.cx, f.origin.cz));
}
