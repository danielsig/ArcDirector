import { HUMAN_KINDS } from '../engine/components';
import { loadNpcAnims } from './humanAnims';
import { loadNature } from './nature';
import { loadSpritesheet } from './spritesheet';
import { loadSwordAnims } from './swordAnims';

let pending:Promise<void> | null = null;

/** Warm the shared art cache while the scene picker is up. */
export function preloadArt():Promise<void> {
	if (pending) {
		return pending;
	}
	pending = Promise.all([
		loadSpritesheet(),
		loadNature(),
		loadNpcAnims(HUMAN_KINDS),
		loadSwordAnims(),
	]).then(() => undefined).catch((err:unknown) => {
		pending = null;
		throw err;
	});
	return pending;
}
