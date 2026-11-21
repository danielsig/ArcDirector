import type { ArcDirector } from '../director/ArcDirector.js';
import { callEach } from '../director/director-types.js';
import { Feature, type FeatureTick } from '../director/Feature.js';
import type { Mind } from '../mind/mind.js';
import type { Goal } from './character-types.js';

/** What `withGoals` takes. */
export type GoalsOptions<TCtx = unknown> = {
	/** Each goal as it is reached, with the id of the mind whose goal it was: a cheer, a line on the screen. Adds a listener. */
	onReached?:(id:string, goal:Goal<TCtx>)=>void;
};

/**
 * Goals reached: each goal whose `until` is met, asked as often as minds' watches are sampled (a view per character is not
 * cheap), and each a mind finishes by its own word. Every director has it; `withGoals({ onReached })` listens.
 */
export class GoalsFeature<TCtx = unknown> extends Feature<TCtx> {
	private readonly _onReached:((id:string, goal:Goal<TCtx>)=>void)[] = [];

	public override readonly order = 80;

	public configure({ onReached }:GoalsOptions<TCtx>):this {
		if (onReached) {
			this._onReached.push(onReached);
		}
		return this;
	}

	public override goalReached(mind:Mind<TCtx>, goal:Goal<never>):void {
		callEach('onReached', this._onReached, [mind.id, goal as Goal<TCtx>], (entry) => this.director.log(entry));
	}

	public override beforeThinks({ think }:FeatureTick):void {
		if (!think) {
			return;
		}
		for (const mind of this.director.minds()) {
			for (const goal of mind.persona.goals.filter((g) => g.until && this.met(mind.thinkThread(), g.until as NonNullable<Goal<TCtx>['until']>))) {
				mind.finishGoal(goal);
			}
		}
	}

	/** Whether `until` is met for character `id`, as it sees the world. One without a context yet is not asked. */
	private met(id:string, until:NonNullable<Goal<TCtx>['until']>):boolean {
		if (typeof until === 'string') {
			return this.director.isMet(id, until);
		}
		const ctx = this.director.contextOf(id);
		return ctx !== undefined && until(ctx);
	}
}

declare module '../director/ArcDirector.js' {
	interface ArcDirector<TCtx, TEntity> {
		/** {@link GoalsFeature}, which every director has: `withGoals({ onReached: (id, goal) => cheer(id) })`. */
		withGoals(options:GoalsOptions<TCtx>):this;
		getGoals():GoalsFeature<TCtx> | undefined;
	}
}
export function withGoals<TCtx>(this:ArcDirector<TCtx>, options:GoalsOptions<TCtx>):ArcDirector<TCtx> {
	return this.configureFeature(GoalsFeature<TCtx>, () => new GoalsFeature<TCtx>(), (goals) => goals.configure(options));
}
