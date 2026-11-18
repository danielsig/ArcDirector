import type { ArcResult } from '../arc/arc-types.js';
import type { VerbDef } from '../arc/stock-verbs.js';
import type { Kit } from '../character/character-types.js';
import type { ArcDirector } from '../director/ArcDirector.js';
import type { VerbArgs, VerbCall } from '../director/director-types.js';
import { Feature } from '../director/Feature.js';
import { internalsOf } from '../internals.js';
import type { WorldVerbTools } from './world-verbs.js';

/** `steal(item, from)`: its args and help. */
export const STEAL_VERB_DEF = { args: { item: 'id', from: 'id' }, help: 'goes to them first', impact: 0.8 } as const satisfies VerbDef;

/** `kit`, granting `steal` too. */
function withSteal(kit:Kit):Kit {
	return kit.verbs.includes('steal') ? kit : { ...kit, verbs: [...kit.verbs, 'steal'] };
}

/**
 * Stealing (`withStealing()`): the stock `steal(item, from)` verb, which the default kit set so far grants too (set
 * by `withRPG` or `withDefaultKit` before it). It runs as `pick_up` does, from a character: it takes `item` if it
 * may (`canPickUp`; by default, what it sees on them, and by default one with `steal` sees what others carry within
 * its `getReach(me, 'steal')`, `Bram (carrying: Purse, Bread)`: `canSeeInventoryOf`) and the game allows the move
 * (`validateTransfer`, which sees `verb: 'steal'`), goes to them, makes the move, and every mind hears of the theft
 * (a `Theft` event, `events.filter("theft")`). Needs the world's `transfers`; a host handler of its own wins.
 */
export class StealingFeature<TCtx = unknown> extends Feature<TCtx> {
	public override install():void {
		const director = this.director.withVerbs((v) => v.add('steal', STEAL_VERB_DEF));
		internalsOf(director).worldVerbs.add('steal', (tools) => (call) => this.steal(call as VerbCall<TCtx, VerbArgs<typeof STEAL_VERB_DEF.args>>, tools));
		const kit = director.defaultKit;
		if (kit) {
			director.withDefaultKit(typeof kit === 'function' ? (ctx) => withSteal(kit(ctx)) : withSteal(kit));
		}
	}

	/** `steal(item, from)`, as `pick_up` from a character, heard of by every mind. */
	private async steal(call:VerbCall<TCtx, VerbArgs<typeof STEAL_VERB_DEF.args>>, { fail, failed, resolveCharacter, take }:WorldVerbTools<TCtx>):Promise<ArcResult> {
		const { item, from } = call.args;
		const found = resolveCharacter(call, from);
		if (failed(found)) {
			return found;
		}
		if (found.target === found.character) {
			return fail('steal', 'cannot steal from yourself');
		}
		const taken = await take(call, item, from, found, (name) => `you see no ${item} on ${name(from)}`);
		if (taken) {
			return taken;
		}
		this.director.pushEvent({ kind: 'Theft', text: (who) => `${who(call.character.id)} stole ${item} from ${who(from)}`, tags: ['theft', item], major: true });
		return { status: 'ok', verb: 'steal', reason: (name) => `stole ${item} from ${name(from)}` };
	}

}

declare module '../director/ArcDirector.js' {
	interface ArcDirector<TCtx, TEntity> {
		/** {@link StealingFeature}: `withRPG(host).withStealing()`. */
		withStealing():this;
		getStealing():StealingFeature<TCtx> | undefined;
	}
}
export function withStealing<TCtx>(this:ArcDirector<TCtx>):ArcDirector<TCtx> {
	return this.configureFeature(StealingFeature<TCtx>, () => new StealingFeature<TCtx>());
}
