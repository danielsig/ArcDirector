import { loadCharacterModels } from './characterModels';
import { loadNature } from './nature';
import { loadSpritesheet } from './spritesheet';

let pending:Promise<void> | null = null;

/** Warm the shared art cache while the scene picker is up. */
export function preloadArt():Promise<void> {
	if (pending) {
		return pending;
	}
	pending = Promise.all([
		loadSpritesheet(),
		loadNature(),
		loadCharacterModels(),
	]).then(() => undefined).catch((err:unknown) => {
		pending = null;
		throw err;
	});
	return pending;
}
