import { Agent, type AgentDeps, type AgentJSON, type AgentOptions } from '../agent/agent.js';
import type { ActionPlan, ActionResult, Step } from '../action/types.js';
import { firstStep } from '../action/types.js';
import { formatPlan } from '../action/parse.js';
import { MemoryStore } from '../memory/store.js';
import {
	createPlanSession,
	runPlan,
	type PlanHandler,
	type PlanSession,
	type PlanSessionOpts,
} from '../agent/run.js';
import { Crowd } from './crowd.js';
import { CrowdUnit, type CrowdUnitSpec } from './unit.js';
import { squadTag, isSquadTag, shortTag } from './tags.js';
import {
	DEFAULT_MAX_LAWS,
	dropLaw,
	lawFromSpec,
	upsertLaw,
	type CrowdLaw,
	type CrowdLawSpec,
} from './laws.js';
import { FORMATION_VERBS } from './verbs.js';

export type CrowdConductorJSON = AgentJSON & {
	crowd?:{ id:string; tags:string[] }[];
	laws?:CrowdLaw[];
	maxLaws?:number;
	cooldown?:number;
};

export type CrowdConductorOptions<HostCtx = unknown> = AgentOptions<HostCtx> & {
	units?:CrowdUnitSpec[];
	laws?:CrowdLawSpec[];
	maxLaws?:number;
};

export function isCrowdConductor<HostCtx>(
	agent:Agent<HostCtx> | null | undefined,
):agent is CrowdConductor<HostCtx> {
	return agent instanceof CrowdConductor;
}

export class CrowdConductor<HostCtx = unknown> extends Agent<HostCtx> {
	readonly crowd = new Crowd();
	laws:CrowdLaw[] = [];
	maxLaws:number;

	constructor(opts:CrowdConductorOptions<HostCtx>) {
		super(opts);
		this.maxLaws = opts.maxLaws ?? DEFAULT_MAX_LAWS;
		for (const spec of opts.units ?? []) {
			this.addUnit(spec);
		}
		for (const spec of opts.laws ?? []) {
			this.addCrowdLaw(spec, spec.pinned);
		}
	}

	addUnit(spec:CrowdUnitSpec):CrowdUnit {
		const existing = this.crowd.get(spec.id);
		if (existing) {
			if (spec.tags) {
				existing.tags = spec.tags.map((t) => t.includes(':') ? t : squadTag(this.id, t));
			}
			return existing;
		}
		const tags = (spec.tags ?? []).map((t) => t.includes(':') ? t : squadTag(this.id, t));
		return this.crowd.add(new CrowdUnit(spec.id, tags));
	}

	removeUnit(id:string):CrowdUnit | undefined {
		return this.crowd.remove(id);
	}

	addCrowdLaw(spec:CrowdLawSpec, pinned = false):CrowdLaw | undefined {
		const law = lawFromSpec({ ...spec, pinned: pinned || spec.pinned }, this.verbs, spec.name ?? `law_${this.laws.length + 1}`);
		if (!law) {
			return undefined;
		}
		this.laws = upsertLaw(this.laws, law, this.maxLaws);
		return this.laws.find((s) => s.name === law.name);
	}

	removeCrowdLaw(name:string):void {
		this.laws = dropLaw(this.laws, name);
	}

	lawHandlers(unit:CrowdUnit, matches:(law:CrowdLaw)=>boolean):PlanHandler[] {
		const out:PlanHandler[] = [];
		this.laws.forEach((law, i) => {
			if (!matches(law)) {
				return;
			}
			out.push({
				key: `law:${law.name}`,
				watch: law.watch,
				plan: law.plan,
				rank: i,
			});
		});
		return out;
	}

	tagUnits(units:CrowdUnit[], short:string):void {
		const stored = squadTag(this.id, short);
		for (const unit of units) {
			if (!unit.tags.includes(stored)) {
				unit.tags = [...unit.tags, stored];
			}
		}
	}

	untagUnits(units:CrowdUnit[], short:string):void {
		const stored = squadTag(this.id, short);
		for (const unit of units) {
			unit.tags = unit.tags.filter((t) => t !== stored);
		}
	}

	ownsTag(stored:string):boolean {
		return isSquadTag(this.id, stored);
	}

	shortOf(stored:string):string {
		return shortTag(this.id, stored);
	}

	assignPlan(units:CrowdUnit[], plan:ActionPlan):void {
		for (const unit of units) {
			unit.interrupt();
			this.spawnUnitPlan(unit, plan);
		}
	}

	beginHandler(unit:CrowdUnit, handler:PlanHandler, sessionOpts?:PlanSessionOpts):void {
		if (unit.inflight && unit.session) {
			unit.session.pending = { kind: 'preempt', handler };
			unit.session.token += 1;
			this.abortPlan?.(unit.id);
			return;
		}
		this.spawnUnitPlan(unit, handler.plan, handler, sessionOpts);
	}

	private spawnUnitPlan(
		unit:CrowdUnit,
		plan:ActionPlan,
		handler?:PlanHandler,
		sessionOpts?:PlanSessionOpts,
	):void {
		unit.plan = plan;
		unit.lawName = handler?.key.startsWith('law:') ? handler.key.slice(4) : null;
		unit.verb = firstStep(plan)?.verb ?? '';
		const session = createPlanSession({
			...sessionOpts,
			cooldown: sessionOpts?.cooldown ?? this.cooldown,
			coolUntil: unit.coolUntil,
			now: sessionOpts?.now ?? (() => this.now),
			abortHost: sessionOpts?.abortHost ?? (() => this.abortPlan?.(unit.id)),
		});
		unit.session = session;
		unit.stepToken = session.token;
		const gen = unit.generation;
		const run = this.runUnitPlan(unit, plan, gen, session, handler);
		unit.inflight = run.finally(() => {
			if (unit.generation === gen) {
				unit.inflight = null;
				if (unit.plan === plan) {
					unit.plan = null;
					unit.verb = '';
					unit.lawName = null;
				}
				if (unit.session === session) {
					unit.session = null;
				}
			}
		});
	}

	private async runUnitPlan(
		unit:CrowdUnit,
		plan:ActionPlan,
		gen:number,
		session:PlanSession,
		handler?:PlanHandler,
	):Promise<void> {
		await runPlan(plan, async (step) => {
			if (unit.generation !== gen) {
				return { ok: false, interrupted: true, verb: step.verb };
			}
			if (unit.stepToken !== session.token) {
				return { ok: false, preempted: true, verb: step.verb };
			}
			unit.verb = step.verb;
			const result = await this.performUnitStep(unit, step);
			if (unit.generation !== gen) {
				return { ok: false, interrupted: true, verb: step.verb };
			}
			if (unit.stepToken !== session.token || (result.interrupted && session.pending)) {
				return { ok: false, preempted: true, interrupted: false, verb: step.verb, reason: result.reason };
			}
			return result;
		}, { session, asHandler: handler });
	}

	private async performUnitStep(unit:CrowdUnit, step:Step):Promise<ActionResult> {
		if (FORMATION_VERBS.has(step.verb)) {
			return { ok: false, verb: step.verb, reason: 'formation must be when plan head' };
		}
		if (!this.execute) {
			return { ok: false, verb: step.verb, reason: `host has no executor for ${step.verb}` };
		}
		if (step.verb === 'remember') {
			const content = String(step.args.content ?? '');
			const tags = Array.isArray(step.args.tags)
				? step.args.tags.filter((x):x is string => typeof x === 'string')
				: [];
			await this.remember(content, [...tags, `unit:${unit.id}`], this.lastTacticalAt);
			return { ok: true, verb: 'remember' };
		}
		if (step.verb === 'set_goal') {
			const goal = String(step.args.goal ?? '');
			const priority = typeof step.args.priority === 'number' ? step.args.priority : 0;
			this.goals.push({ text: `[${unit.id}] ${goal}`, priority });
			this.trimGoals();
			return { ok: true, verb: 'set_goal' };
		}
		if (step.verb === 'say' && this.talk) {
			const text = String(step.args.text ?? '');
			const to = this.sayToOf(step.args);
			return this.talk.say(unit.id, text, to, this.now);
		}
		return this.execute(step, this.context(), unit.id);
	}

	protected override extraVolatile():string {
		if (this.laws.length === 0) {
			return '';
		}
		const lines = this.laws.map((law) => (
			`- ${law.name}: who=${law.who} watch=${law.watch} → ${formatPlan(law.plan)}`
		));
		return `Laws (emergencies, list order; unlaw to drop):\n${lines.join('\n')}`;
	}

	override toJSON():CrowdConductorJSON {
		return {
			...super.toJSON(),
			crowd: this.crowd.toJSON(),
			laws: this.laws.map((s) => ({ ...s, plan: s.plan })),
			maxLaws: this.maxLaws,
			cooldown: this.cooldown,
		};
	}

	static override fromJSON<HostCtx>(json:CrowdConductorJSON, deps:AgentDeps<HostCtx>):CrowdConductor<HostCtx> {
		const conductor = new CrowdConductor<HostCtx>({
			...deps,
			id: json.id,
			identity: json.identity,
			goals: json.goals,
			memory: MemoryStore.fromJSON(json.memories),
			maxLaws: json.maxLaws,
			cooldown: json.cooldown ?? deps.cooldown,
		});
		conductor.loadJSON(json, deps);
		if (json.crowd) {
			for (const row of json.crowd) {
				conductor.crowd.add(CrowdUnit.fromJSON(row));
			}
		}
		if (json.laws) {
			conductor.laws = json.laws.map((s) => ({ ...s }));
		}
		return conductor;
	}
}
