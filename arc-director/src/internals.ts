import type { ArcRunner, RunnerFields } from './character/arc-runner.js';
import type { Character, CharacterFields } from './character/Character.js';
import type { Collective, CollectiveFields } from './collective/Collective.js';
import type { ArcDirector, DirectorFields } from './director/ArcDirector.js';
import type { Feature, FeatureFields } from './director/Feature.js';
import type { MemoryFields, MemoryStore } from './memory/store.js';
import type { Mind, MindFields } from './mind/mind.js';
import type { MindMemory, MindMemoryFields } from './mind/MindMemory.js';
import type { TalkFeature, TalkFields } from './mind/TalkFeature.js';

/**
 * What each library class's constructor handed the director, and the director its parts: closures over its private
 * state, and nothing else, so that state never shows in JSON or as a field in a debugger. `index.ts` does not export this module, and
 * `package.json`'s `exports` blocks a deep import, so only the library reaches it.
 */
const handed = new WeakMap<object, unknown>();

/** Called in a constructor: `hand(this, { … })`. A subclass's joins what its base class handed. */
export function hand(owner:object, internals:object):void {
	handed.set(owner, { ...handed.get(owner) as object, ...internals });
}

/** What `owner`'s constructor handed over. */
export function internalsOf<TCtx>(owner:Character<TCtx>):CharacterFields<TCtx>;
export function internalsOf<TCtx>(owner:Collective<TCtx>):CollectiveFields<TCtx>;
export function internalsOf<TCtx>(owner:ArcRunner<TCtx>):RunnerFields<TCtx>;
export function internalsOf<TCtx>(owner:Mind<TCtx>):MindFields<TCtx>;
export function internalsOf<TCtx>(owner:TalkFeature<TCtx>):TalkFields<TCtx>;
export function internalsOf<TCtx>(owner:Feature<TCtx>):FeatureFields<TCtx>;
export function internalsOf<TCtx>(owner:ArcDirector<TCtx>):DirectorFields<TCtx>;
export function internalsOf(owner:MemoryStore):MemoryFields;
export function internalsOf<TCtx>(owner:MindMemory<TCtx>):MindMemoryFields;
export function internalsOf(owner:object):unknown {
	const internals = handed.get(owner);
	if (!internals) {
		throw new Error('ArcDirector: not a library-made object');
	}
	return internals;
}
