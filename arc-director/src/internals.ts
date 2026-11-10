import type { Character, CharacterFields } from './character/Character.js';
import type { Collective, CollectiveFields } from './collective/Collective.js';
import type { Mind, MindFields } from './mind/mind.js';

/**
 * What each library class's constructor handed the director: closures over its private state, and nothing else, so
 * that state never shows in JSON or as a field in a debugger. `index.ts` does not export this module, and
 * `package.json`'s `exports` blocks a deep import, so only the library reaches it.
 */
const handed = new WeakMap<object, unknown>();

/** Called once, in a constructor: `hand(this, { … })`. */
export function hand(owner:object, internals:object):void {
	handed.set(owner, internals);
}

/** What `owner`'s constructor handed over. */
export function internalsOf<TCtx>(owner:Character<TCtx>):CharacterFields<TCtx>;
export function internalsOf<TCtx>(owner:Collective<TCtx>):CollectiveFields<TCtx>;
export function internalsOf<TCtx>(owner:Mind<TCtx>):MindFields<TCtx>;
export function internalsOf(owner:object):unknown {
	const internals = handed.get(owner);
	if (!internals) {
		throw new Error('ArcDirector: not a library-made object');
	}
	return internals;
}
