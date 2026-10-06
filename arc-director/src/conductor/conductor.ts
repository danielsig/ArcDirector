import { Agent, type AgentDeps, type AgentJSON, type AgentOptions } from '../agent/agent.js';
import type { Actor } from '../agent/actor.js';
import type { Arc, ArcResult, Step } from '../arc/types.js';
import { firstStep } from '../arc/types.js';
import { formatArc } from '../arc/parse.js';
import { MemoryStore } from '../memory/store.js';
import {
	createArcSession,
	runArc,
	type ArcHandler,
	type ArcSession,
	type ArcSessionOpts,
} from '../agent/run.js';
import { Crowd } from './crowd.js';
import { CrowdUnit, type CrowdUnitSpec } from './unit.js';
import { squadTag, isSquadTag, shortTag } from './tags.js';
import {
	type CrowdLaw,
	type CrowdLawSpec,
} from './laws.js';
import { isFormationVerb } from './conductor-verbs.js';

export type CrowdConductorJSON = AgentJSON & {
	crowd?:{ id:string; tags:string[] }[];
	commanderID?:string | null;
};

export type CrowdConductorOptions<TAgentCtx = unknown> = AgentOptions<TAgentCtx> & {
	units?:CrowdUnitSpec[];
	laws?:CrowdLawSpec[];
	maxLaws?:number;
	commander?:string;
	onCommanderVacant?:(unitID:string)=>void;
};

export function isCrowdConductor<TAgentCtx>(
	actor:Actor<TAgentCtx> | null | undefined,
):actor is CrowdConductor<TAgentCtx> {
	return actor instanceof CrowdConductor;
}

export class CrowdConductor<TAgentCtx = unknown> extends Agent<TAgentCtx> {
	readonly crowd = new Crowd();
	commanderID:string | null = null;
	onCommanderVacant?:(unitID:string)=>void;

	constructor(opts:CrowdConductorOptions<TAgentCtx>) {
		super({ ...opts, defaultLawWho: opts.defaultLawWho ?? 'units' });
		for (const spec of opts.units ?? []) {
			this.addUnit(spec);
		}
		for (const spec of opts.laws ?? []) {
			this.addCrowdLaw(spec, spec.pinned);
		}
		if (opts.commander) {
			this.setCommander(opts.commander);
		}
		if (opts.onCommanderVacant) {
			this.onCommanderVacant = opts.onCommanderVacant;
		}
	}

	protected override crowdLawWho():boolean {
		return true;
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
		if (this.commanderID === id) {
			this.vacateCommander(id);
		}
		return this.crowd.remove(id);
	}

	override thinkThread():string {
		return this.commanderID ?? super.thinkThread();
	}


	setCommander(id:string | null):void {
		if (id === null) {
			const prev = this.commanderID;
			if (prev) {
				this.vacateCommander(prev);
			}
			return;
		}
		if (!this.crowd.get(id)) {
			throw new Error(`ArcDirector: no unit '${id}' to command`);
		}
		this.commanderID = id;
	}

	private vacateCommander(unitID:string):void {
		this.abortThink();
		this.commanderID = null;
		this.onCommanderVacant?.(unitID);
	}

	addCrowdLaw(spec:CrowdLawSpec, pinned = false):CrowdLaw | undefined {
		return this.addLaw(spec, pinned);
	}

	removeCrowdLaw(name:string):void {
		this.removeLaw(name);
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

	issueUnits(units:CrowdUnit[], arc:Arc):void {
		const troops = this.commanderID
			? units.filter((u) => u.id !== this.commanderID)
			: units;
		for (const unit of troops) {
			unit.interrupt();
			void this.spawnUnitArc(unit, arc);
		}
	}

	async enactUnit(unit:CrowdUnit, arc:Arc):Promise<ArcResult> {
		unit.interrupt();
		return this.spawnUnitArc(unit, arc);
	}

	beginHandler(unit:CrowdUnit, handler:ArcHandler, sessionOpts?:ArcSessionOpts):void {
		if (unit.inflight && unit.session) {
			unit.session.pending = { kind: 'preempt', handler };
			unit.session.token += 1;
			this.abortArc?.(unit.id);
			return;
		}
		void this.spawnUnitArc(unit, handler.arc, handler, sessionOpts);
	}

	private spawnUnitArc(
		unit:CrowdUnit,
		arc:Arc,
		handler?:ArcHandler,
		sessionOpts?:ArcSessionOpts,
	):Promise<ArcResult> {
		unit.arc = arc;
		unit.lawName = handler?.key.startsWith('law:') ? handler.key.slice(4) : null;
		unit.verb = firstStep(arc)?.verb ?? '';
		const session = createArcSession({
			...sessionOpts,
			now: sessionOpts?.now ?? (() => this.now),
			abortHost: sessionOpts?.abortHost ?? (() => this.abortArc?.(unit.id)),
		});
		unit.session = session;
		unit.stepToken = session.token;
		const gen = unit.generation;
		const run = this.runUnitArc(unit, arc, gen, session, handler);
		unit.inflight = run.then(() => undefined).finally(() => {
			if (unit.generation === gen) {
				unit.inflight = null;
				if (session.parked) {
					return;
				}
				if (unit.arc === arc) {
					unit.arc = null;
					unit.verb = '';
					unit.lawName = null;
				}
				if (unit.session === session) {
					unit.session = null;
				}
			}
		});
		return run;
	}

	private async runUnitArc(
		unit:CrowdUnit,
		arc:Arc,
		gen:number,
		session:ArcSession,
		handler?:ArcHandler,
	):Promise<ArcResult> {
		return runArc(arc, async (step) => {
			if (unit.generation !== gen) {
				return { ok: false, interrupted: true, verb: step.verb };
			}
			if (unit.stepToken !== session.token) {
				return { ok: false, preempted: true, verb: step.verb };
			}
			unit.verb = step.verb;
			const result = await this.performUnitStep(unit, step);
			if (unit.generation !== gen) {
				return { ok: false, interrupted: true, verb: step.verb, reason: result.reason };
			}
			if (unit.stepToken !== session.token || (result.interrupted && session.pending)) {
				return { ok: false, preempted: true, interrupted: false, verb: step.verb, reason: result.reason };
			}
			return result;
		}, { session, asHandler: handler });
	}

	private async performUnitStep(unit:CrowdUnit, step:Step):Promise<ArcResult> {
		if (isFormationVerb(step.verb)) {
			return { ok: false, verb: step.verb, reason: 'formation must be issue arc head' };
		}
		if (!this.execute) {
			return { ok: false, verb: step.verb, reason: `host has no executor for ${step.verb}` };
		}
		if (step.verb === 'remember') {
			const content = String(step.args.content ?? '');
			const tags = Array.isArray(step.args.tags)
				? step.args.tags.filter((x):x is string => typeof x === 'string')
				: [];
			await this.remember(content, [...tags, `unit:${unit.id}`], this.lastTacticalTimestamp);
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
		const parts:string[] = [];
		const roster = this.crowd.list();
		if (roster.length > 0) {
			const lines = roster.map((unit) => {
				const tags = unit.tags.map((t) => this.shortOf(t)).filter((t) => t.length > 0);
				const you = unit.id === this.commanderID ? ' (you)' : '';
				return tags.length > 0
					? `- ${this.nameOf(unit.id)}: ${tags.join(', ')}${you}`
					: `- ${this.nameOf(unit.id)}${you}`;
			});
			parts.push(
				`Units (issue who=units.filter("Tag") is this roster; allUnits is every troop, one program):\n${lines.join('\n')}`,
			);
		}
		if (this.laws.length > 0) {
			const lines = this.laws.map((law) => (
				`- ${law.name}: who=${law.who} watch=${law.watch} → ${formatArc(law.arc, this.verbs.nested())}`
			));
			parts.push(`Laws (emergencies, list order; unlaw to drop):\n${lines.join('\n')}`);
		}
		const groups = new Map<string, string[]>();
		for (const unit of this.crowd.list()) {
			if (unit.id === this.commanderID || !unit.busy || !unit.arc) {
				continue;
			}
			const key = formatArc(unit.arc, this.verbs.nested());
			const ids = groups.get(key) ?? [];
			ids.push(this.nameOf(unit.id));
			groups.set(key, ids);
		}
		if (groups.size > 0) {
			const lines = [...groups].map(([arc, ids]) => `- ${ids.join(', ')}: ${arc}`);
			parts.push(`Unit programs:\n${lines.join('\n')}`);
		}
		return parts.join('\n');
	}

	override toJSON():CrowdConductorJSON {
		return {
			...super.toJSON(),
			crowd: this.crowd.toJSON(),
			commanderID: this.commanderID,
		};
	}

	static override fromJSON<TAgentCtx>(json:CrowdConductorJSON, deps:AgentDeps<TAgentCtx>):CrowdConductor<TAgentCtx> {
		const conductor = new CrowdConductor<TAgentCtx>({
			...deps,
			id: json.id,
			identity: json.identity,
			goals: json.goals,
			memory: MemoryStore.fromJSON(json.memories),
			maxLaws: json.maxLaws,
			cooldown: json.cooldown ?? deps.cooldown,
			defaultLawWho: 'units',
		});
		conductor.loadJSON(json, deps);
		if (json.crowd) {
			for (const row of json.crowd) {
				conductor.crowd.add(CrowdUnit.fromJSON(row));
			}
		}
		if (json.commanderID) {
			conductor.commanderID = json.commanderID;
		}
		return conductor;
	}
}
