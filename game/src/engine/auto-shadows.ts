import type { GPUMemory } from 'arc-director';
import type { ShadowTier } from '../prefs';

/** Gigabytes a GPU needs for each tier above Simple, best first. */
const TIERS:readonly [ShadowTier, number][] = [['high', 12], ['low', 6]];
/** A GPU that shares the system RAM (integrated, Apple) draws slower than its memory says. */
const SHARED_FACTOR = 0.5;

/**
 * The `auto` shadow quality, from the estimate that also picks which model to suggest (`gpuMemory()`): the GPU's
 * memory, which tracks how fast it draws. Unknown (a browser that hides the GPU's name) is Low. It never picks Off.
 */
export function autoShadowTier(memory:GPUMemory | null):ShadowTier {
	if (!memory) {
		return 'low';
	}
	const gb = memory.shared ? memory.gb * SHARED_FACTOR : memory.gb;
	return TIERS.find(([, need]) => gb >= need)?.[0] ?? 'simple';
}
