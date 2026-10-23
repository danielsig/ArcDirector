import type { VerbArgMap } from '../arc/stock-verbs.js';
import type { Arc, ArcResult, CountMap, Step, StepArg } from '../arc/types.js';
import type { Kit } from '../character/types.js';
import type { Character } from '../character/character.js';
import type { Collective } from '../collective/collective.js';
import type { VerbAlias, VerbCall, VerbHandler } from '../director/types.js';
import { poseOf } from '../world/lookup.js';
import type { HostWorld } from '../world/types.js';
import { distance } from '../world/vec.js';
import { dummyEntity } from '../expr/natives.js';
import type { ExprVal } from '../expr/types.js';
import type { KindSpec, RTSHost, WorkDone } from './types.js';
import { STOCK_ECONOMY_VERBS, STOCK_RTS_VERB_DEFS } from './verbs.js';

/** Seconds of game time between two ticks of a unit's work or fight. */
const TICK = 0.25;
const SALVAGE = 0.5;
const CHASE = 6;
/** How far off its spot a holding unit may be pushed before it walks back. */
const HOLD_SLACK = 1.5;
const MOVE_VERBS = ['go_to', 'follow', 'flee', 'wait'];
const BUILDING_VERBS = ['train', 'research', 'cancel', 'rally', 'keep_training', 'wait'];

/** What a side's commander may run: the economy, its side's verbs, and the collective's own. A city builder adds `STOCK_CITY_VERBS`. */
export const RTS_COMMANDER_VERBS = [
	...STOCK_ECONOMY_VERBS, 'tribute',
	'keep_distance', 'pull_back', 'spread_out', 'keep_training', 'supply_ahead', 'share_workers',
	'issue', 'tag', 'untag', 'law', 'unlaw', 'when', 'loop', 'wait', 'say',
] as const;

/** What the RTS reaches in the director: the world, its characters, and how the caller sees. */
export type RTSDeps<TCtx> = {
	host:RTSHost;
	world:()=>HostWorld<unknown> | undefined;
	character:(id:string)=>Character<TCtx> | undefined;
	/** The collective a side is. */
	collective:(side:string)=>Collective<TCtx> | undefined;
	/** The ids `expr` picks, as `call`'s character sees: `units.filter("Archer")` from a commander, `others…` from a unit. */
	pick:(call:VerbCall<TCtx>, expr:string)=>string[] | { error:string };
	/** The ids `call`'s character sees now. */
	seen:(call:VerbCall<TCtx>)=>readonly string[];
	/** Tell the mind that thinks for character `id`. */
	tell:(id:string, text:string)=>void;
	/** Verbs the director has, so a kit names only those. */
	has:(verb:string)=>boolean;
};

/** One thing in a building's queue. */
type Order = {
	kind:string;
	building:string;
	side:string;
	paid:CountMap;
	left:number;
	tech:boolean;
	rally?:string;
};

/** A side's state the game does not keep: queues, rally points, techs done, and what its units are doing. */
type SideState = {
	queues:Map<string, Order[]>;
	rally:Map<string, string>;
	techs:Set<string>;
};

function scaled(bundle:CountMap, n:number):CountMap {
	return Object.fromEntries(Object.entries(bundle).map(([k, v]) => [k, v * n]));
}

function bundleText(bundle:CountMap):string {
	return Object.entries(bundle).map(([k, v]) => `${v} ${k}`).join(', ');
}

function str(v:unknown):string {
	return typeof v === 'string' ? v.trim() : '';
}

function num(v:unknown):number | undefined {
	return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function ok(verb:string, reason?:string):ArcResult {
	return { ok: true, verb, ...reason ? { reason } : {} };
}

function fail(verb:string, reason:string):ArcResult {
	return { ok: false, verb, reason };
}

/**
 * The stock RTS verbs, run on a game's `RTSHost`. A commander's economy verbs hand the work out and finish at once; the
 * same verb in a unit's own program does the work and finishes when it is done.
 */
export class RTS<TCtx> {
	private readonly _deps:RTSDeps<TCtx>;
	private readonly _sides = new Map<string, SideState>();
	/** Who is inside each building or transport. */
	private readonly _inside = new Map<string, Set<string>>();
	/**
	 * What each unit is doing, for its side's roster and `gathering`: `gathering Wood`, `holding Ford`. It belongs to the
	 * verb call that set it, and goes when that call ends, however it ends: a program replaced mid-job leaves nothing behind.
	 */
	private readonly _doing = new Map<string, { text:string; call:VerbCall<TCtx> }>();

	private setDoing(call:VerbCall<TCtx>, text:string):void {
		this._doing.set(call.character.id, { text, call });
		call.character.work = text;
	}

	private clearDoing(call:VerbCall<TCtx>):void {
		if (this._doing.get(call.character.id)?.call === call) {
			this._doing.delete(call.character.id);
			call.character.work = '';
		}
	}

	/** `handler`, with what it said its unit was doing cleared when it ends. */
	private tracked(handler:VerbHandler<TCtx>):VerbHandler<TCtx> {
		return async (call) => {
			try {
				return await handler(call);
			}
			finally {
				this.clearDoing(call);
			}
		};
	}

	constructor(deps:RTSDeps<TCtx>) {
		this._deps = deps;
	}

	private get host():RTSHost {
		return this._deps.host;
	}

	// ── Kinds ──────────────────────────────────────────────────────────

	public spec(kind:string | undefined):KindSpec | undefined {
		return kind === undefined ? undefined : this.host.kinds[kind];
	}

	public kindOf(id:string):string | undefined {
		return this.host.describe(id)?.kind;
	}

	private tagged(kind:string | undefined, tag:string):boolean {
		return this.spec(kind)?.tags?.includes(tag) ?? false;
	}

	/** The unit tags a kind shows in `units.filter`: its name and its tags, not the library's own. */
	public tagsOf(kind:string):string[] {
		return [kind, ...(this.spec(kind)?.tags ?? []).filter((t) => !t.includes(':'))];
	}

	/** The verbs a unit of `kind` runs, from what its kind says it is. Only verbs the director has. */
	public kitOf(kind:string):Kit {
		const spec = this.spec(kind) ?? {};
		const tags = spec.tags ?? [];
		const building = tags.includes('Building');
		const verbs = new Set<string>(building ? BUILDING_VERBS : MOVE_VERBS);
		if (tags.includes('Worker')) {
			// What this game has work for: no wall to lay, no job slot to staff, nothing to haul, no verb for it.
			const kinds = Object.values(this.host.kinds);
			const has = { wall: kinds.some((k) => k.tags?.includes('Wall')), bridge: kinds.some((k) => k.tags?.includes('Bridge')), staff: kinds.some((k) => k.slots), haul: !!this.host.withdraw };
			['gather', 'build', 'repair', 'garrison', ...(['wall', 'bridge', 'staff', 'haul'] as const).filter((v) => has[v])].forEach((v) => verbs.add(v));
		}
		if (!building && (spec.range ?? 0) > 0) {
			['attack', 'attack_move', 'hold', 'patrol', 'garrison', 'spread', 'circle', 'hold_line', 'keep_distance', 'pull_back', 'spread_out'].forEach((v) => verbs.add(v));
		}
		if (spec.holds) {
			verbs.add('unload');
		}
		for (const verb of spec.verbs ?? []) {
			verbs.add(verb);
		}
		return { verbs: [...verbs].map((v) => this.named(v)).filter((v) => this._deps.has(v)) };
	}

	/** `verb` as this game names it. */
	public named(verb:string):string {
		return this.host.verbNames?.[verb as keyof NonNullable<RTSHost['verbNames']>]?.name ?? verb;
	}

	/**
	 * The game's own names for stock verbs, as aliases: each takes the game's arg names and runs its stock verb. A
	 * kit with the alias runs it, though it lacks the stock verb.
	 */
	public renamed():Record<string, { args:VerbArgMap; help?:string } & VerbAlias> {
		const out:Record<string, { args:VerbArgMap; help?:string } & VerbAlias> = {};
		for (const [stock, own] of Object.entries(this.host.verbNames ?? {})) {
			const def = STOCK_RTS_VERB_DEFS[stock as keyof typeof STOCK_RTS_VERB_DEFS];
			if (!own || !def) {
				continue;
			}
			const rename = own.args ?? {};
			const args:VerbArgMap = Object.fromEntries(Object.entries(def.args).map(([key, kind]) => [rename[key] ?? key, kind]));
			const back = Object.fromEntries(Object.entries(rename).map(([key, name]) => [name, key]));
			const value = (v:StepArg):string => (typeof v === 'string' || typeof v === 'number' ? String(v) : JSON.stringify(v));
			out[own.name] = {
				args,
				help: own.help ?? ('help' in def ? def.help : undefined),
				arc: (a) => `${stock}(${Object.entries(a).map(([key, v]) => `${back[key] ?? key}=${value(v)}`).join(', ')})`,
			};
		}
		return out;
	}

	// ── Sides ──────────────────────────────────────────────────────────

	private sideOf(character:Character<TCtx>):string {
		return character.collective?.id ?? character.id;
	}

	private state(side:string):SideState {
		let state = this._sides.get(side);
		if (!state) {
			state = { queues: new Map(), rally: new Map(), techs: new Set() };
			this._sides.set(side, state);
		}
		return state;
	}

	/** A side's units and buildings: its collective's characters, or a lone character itself. */
	private members(side:string):Character<TCtx>[] {
		const collective = this._deps.collective(side);
		if (collective) {
			return [...collective.characters];
		}
		const alone = this._deps.character(side);
		return alone ? [alone] : [];
	}

	private unfinished(character:Character<TCtx>):boolean {
		return character.tags.includes('Unfinished');
	}

	/** Kinds `side` has built (finished), and techs it has. */
	private owned(side:string):Set<string> {
		const kinds = this.members(side).filter((c) => !this.unfinished(c)).map((c) => this.kindOf(c.id)).filter((k):k is string => !!k);
		return new Set([...kinds, ...this.state(side).techs]);
	}

	/** Kinds `side` is building or has queued: what will be there. */
	private coming(side:string):Set<string> {
		const out = new Set<string>();
		for (const c of this.members(side)) {
			if (this.unfinished(c)) {
				const kind = this.kindOf(c.id);
				if (kind) {
					out.add(kind);
				}
			}
		}
		for (const queue of this.state(side).queues.values()) {
			for (const order of queue) {
				out.add(order.kind);
			}
		}
		return out;
	}

	/** The first thing `kind` needs that `side` neither has nor has coming; or `pending` for one that is coming. */
	private needs(side:string, kind:string):{ missing?:string; pending?:string } {
		const owned = this.owned(side);
		const coming = this.coming(side);
		let pending:string | undefined;
		for (const need of this.spec(kind)?.requires ?? []) {
			if (owned.has(need)) {
				continue;
			}
			if (!coming.has(need)) {
				return { missing: need };
			}
			pending ??= need;
		}
		return pending ? { pending } : {};
	}

	/** What `count` of `cost` would leave short, as text; empty when the stock covers it. */
	private short(side:string, cost:CountMap, count = 1):string {
		const stock = this.host.getStock(side);
		return Object.entries(cost)
			.filter(([k, v]) => (stock[k] ?? 0) < v * count)
			.map(([k, v]) => `${v * count - (stock[k] ?? 0)} ${k}`)
			.join(', ');
	}

	/** How many of `cost` the stock pays for. */
	private affordable(side:string, cost:CountMap):number {
		const stock = this.host.getStock(side);
		return Math.min(...Object.entries(cost).map(([k, v]) => (v > 0 ? Math.floor((stock[k] ?? 0) / v) : Infinity)), Infinity);
	}

	/** Whether the game caps its units at all: some kind of it raises the cap. */
	private get capped():boolean {
		return Object.values(this.host.kinds).some((k) => (k.provides ?? 0) > 0);
	}

	/** What the game calls its cap, and the names its watches read it by (`energy`, `energyCap`). */
	private get cap():{ name:string; used:string; most:string } {
		const name = this.host.supplyName ?? 'Supply';
		const used = name[0].toLowerCase() + name.slice(1);
		return { name, used, most: `${used}Cap` };
	}

	/** Supply `side`'s units take, what its queues will take, and its cap from what it has built (none: no cap). */
	public supply(side:string):{ units:number; queued:number; cap:number } {
		let units = 0;
		let cap = 0;
		for (const c of this.members(side)) {
			const spec = this.spec(this.kindOf(c.id));
			if (this.unfinished(c)) {
				continue;
			}
			units += spec?.supply ?? 0;
			cap += spec?.provides ?? 0;
		}
		let queued = 0;
		for (const queue of this.state(side).queues.values()) {
			queued += queue.filter((o) => !o.tech).reduce((sum, o) => sum + (this.spec(o.kind)?.supply ?? 0), 0);
		}
		return { units, queued, cap: this.capped ? Math.min(cap, this.host.maxSupply ?? Infinity) : Infinity };
	}

	// ── Where things are ───────────────────────────────────────────────

	private distance(a:string, b:string):number {
		const world = this._deps.world();
		const pa = world && poseOf(world, a)?.point;
		const pb = world && poseOf(world, b)?.point;
		return pa && pb ? distance(pa, pb) : Infinity;
	}

	private nearest(from:string, ids:readonly string[]):string | undefined {
		let best:string | undefined;
		let gap = Infinity;
		for (const id of ids) {
			const d = this.distance(from, id);
			if (d < gap) {
				gap = d;
				best = id;
			}
		}
		return best ?? ids[0];
	}

	/** Nodes of `resource` `side` knows of. */
	private nodes(side:string, resource:string):string[] {
		return this.host.known(side).filter((id) => this.tagged(this.kindOf(id), `Node:${resource}`));
	}

	/** The resource a node gives. */
	private resourceOf(node:string):string | undefined {
		return this.spec(this.kindOf(node))?.tags?.find((t) => t.startsWith('Node:'))?.slice(5);
	}

	private dropOffs(side:string, resource:string):string[] {
		return this.members(side)
			.filter((c) => !this.unfinished(c) && this.tagged(this.kindOf(c.id), `DropOff:${resource}`))
			.map((c) => c.id);
	}

	// ── The tick ───────────────────────────────────────────────────────

	/** Queues move on by `dt` seconds: what is done comes out, and its next starts. */
	public tick(dt:number):void {
		for (const [side, state] of this._sides) {
			for (const [building, queue] of state.queues) {
				const head = queue[0];
				const at = this._deps.character(building);
				if (!head) {
					continue;
				}
				if (!at) {
					// Its building is gone: everything queued there is paid back.
					state.queues.delete(building);
					queue.forEach((o) => this.host.addStock(side, o.paid));
					continue;
				}
				if (this.unfinished(at) || this.needs(side, head.kind).pending) {
					continue;
				}
				if (!head.tech) {
					const { units, cap } = this.supply(side);
					// At the cap it waits for room.
					if (units + (this.spec(head.kind)?.supply ?? 0) > cap) {
						continue;
					}
				}
				head.left -= dt;
				if (head.left > 0) {
					continue;
				}
				queue.shift();
				this.finish(head);
			}
		}
	}

	private finish(order:Order):void {
		if (order.tech) {
			this.state(order.side).techs.add(order.kind);
			this.host.applyTech(order.side, order.kind);
			this._deps.tell(order.side, `${order.kind} researched.`);
			return;
		}
		const id = this.host.spawn(order.building, order.kind);
		const unit = this.join(order.side, id, order.kind, order.building);
		const rally = order.rally ?? this.state(order.side).rally.get(order.building);
		if (unit && rally) {
			void unit.enact([{ verb: 'go_to', args: { target: rally } }]);
		}
	}

	/** `id` joins `side` as a unit of `kind`, with the tags and verbs its kind gives. */
	private join(side:string, id:string, kind:string, near:string, unfinished = false):Character<TCtx> | undefined {
		const collective = this._deps.collective(side) ?? this._deps.character(near)?.collective;
		if (!collective) {
			return undefined;
		}
		return collective.addCharacter({ id, tags: [...this.tagsOf(kind), ...unfinished ? ['Unfinished'] : []], kit: this.kitOf(kind) });
	}

	// ── Verbs ──────────────────────────────────────────────────────────

	/** Every stock RTS verb's handler. */
	public handlers():Record<string, VerbHandler<TCtx>> {
		const economy = (own:(call:VerbCall<TCtx>)=>ArcResult | Promise<ArcResult>, handOut:(call:VerbCall<TCtx>)=>ArcResult | Promise<ArcResult>):VerbHandler<TCtx> => this.tracked((call) => (
			this.isCommander(call.character) ? handOut(call) : own(call)
		));
		const t = (h:VerbHandler<TCtx>):VerbHandler<TCtx> => this.tracked(h);
		return {
			gather: economy((c) => this.gather(c), (c) => this.handOut(c)),
			build: economy((c) => this.build(c), (c) => this.buildFor(c)),
			wall: economy((c) => this.line(c, 'Wall'), (c) => this.lineFor(c, 'Wall')),
			bridge: economy((c) => this.line(c, 'Bridge'), (c) => this.lineFor(c, 'Bridge')),
			repair: economy((c) => this.repair(c), (c) => this.handOut(c)),
			staff: economy((c) => this.staff(c), (c) => this.staffFor(c)),
			haul: economy((c) => this.haul(c), (c) => this.handOut(c)),
			train: (c) => this.train(c),
			research: (c) => this.research(c),
			cancel: (c) => this.cancel(c),
			rally: (c) => this.rally(c),
			attack: t((c) => this.attack(c)),
			attack_move: t((c) => this.attackMove(c)),
			hold: t((c) => this.hold(c)),
			patrol: t((c) => this.patrol(c)),
			garrison: t((c) => this.garrison(c)),
			unload: (c) => this.unload(c),
			tribute: (c) => this.tribute(c),
			set_policy: (c) => this.setPolicy(c),
		};
	}

	private isCommander(character:Character<TCtx>):boolean {
		return character.collective?.commander === character;
	}

	/** The members `expr` picks, as `call` sees; or why it picks none. */
	private pickMembers(call:VerbCall<TCtx>, expr:string):Character<TCtx>[] | string {
		const picked = this._deps.pick(call, expr);
		if (!Array.isArray(picked)) {
			return `${expr}: ${picked.error}`;
		}
		const side = this.sideOf(call.character);
		const out:Character<TCtx>[] = [];
		for (const id of picked) {
			const c = this._deps.character(id);
			if (!c) {
				continue;
			}
			if (this.sideOf(c) !== side) {
				return `${id} is ${this.host.describe(id)?.owner ?? 'not yours'}'s`;
			}
			out.push(c);
		}
		return out;
	}

	/** Workers for a commander's order: `by` (default idle ones), idle first, nearest `near` first, `workers` of them. */
	private workersFor(call:VerbCall<TCtx>, near:string | undefined, fallback:'idle' | 'any'):Character<TCtx>[] | string {
		const by = str(call.args.by);
		const side = this.sideOf(call.character);
		let pool:Character<TCtx>[];
		if (by) {
			const picked = this.pickMembers(call, by);
			if (typeof picked === 'string') {
				return picked;
			}
			const notWorker = picked.find((c) => !this.tagged(this.kindOf(c.id), 'Worker'));
			if (notWorker) {
				return `not a worker: ${notWorker.id}`;
			}
			pool = picked;
		}
		else {
			// Unnamed, a builder or mender stays at its job (rule 7): only `by` takes one off it.
			pool = this.members(side).filter((c) => c !== call.character && !this.unfinished(c) && this.tagged(this.kindOf(c.id), 'Worker') && !this.atWork(c.id));
			if (fallback === 'idle' && !pool.some((c) => !c.busy)) {
				return 'no idle workers; name some with by';
			}
		}
		const ranked = pool
			.filter((c) => fallback === 'any' || by || !c.busy)
			.sort((a, b) => Number(a.busy) - Number(b.busy) || (near ? this.distance(a.id, near) - this.distance(b.id, near) : 0));
		const want = num(call.args.workers);
		const chosen = want === undefined ? (by || fallback === 'idle' ? ranked : ranked.slice(0, 1)) : ranked.slice(0, Math.max(0, want));
		return chosen.length > 0 ? chosen : 'no workers to send';
	}

	/** Whether `id` is building or mending something now. */
	private atWork(id:string):boolean {
		return /^(building|repairing) /.test(this._doing.get(id)?.text ?? '');
	}

	/** `step` with the commander-only args gone: what each chosen worker runs as its own. */
	private ownStep(call:VerbCall<TCtx>, extra:Record<string, Step['args'][string]> = {}):Step {
		const args = { ...call.args, ...extra } as Step['args'];
		delete args.by;
		delete args.workers;
		return { verb: call.verb, args };
	}

	/** `step` (a stock verb's) as this game names it and its args, so a unit whose kit has only the game's name runs it. */
	private asNamed(step:Step):Step {
		const own = this.host.verbNames?.[step.verb as keyof NonNullable<RTSHost['verbNames']>];
		if (!own) {
			return step;
		}
		const rename = own.args ?? {};
		return { ...step, verb: own.name, args: Object.fromEntries(Object.entries(step.args).map(([key, v]) => [rename[key] ?? key, v])) };
	}

	/** Give each of `workers` `step` as its program; with `resume`, what it was doing comes back after. */
	private assign(workers:readonly Character<TCtx>[], step:(worker:Character<TCtx>)=>Step, resume:boolean):void {
		for (const worker of workers) {
			const before:Arc = resume ? this.rest(worker) : [];
			const own:Step = { ...this.asNamed(step(worker)), ...before.length > 0 ? { then: 'always' as const } : {} };
			worker.collective?.issue([worker], [own, ...before]);
		}
	}

	/**
	 * What is left of `worker`'s program: from the step it was at, so what it already did is not done again. Its whole
	 * program where that step is not one of the program's own (it was inside a group).
	 */
	private rest(worker:Character<TCtx>):Arc {
		const arc = worker.arc ?? [];
		const at = worker.lastStep ? arc.indexOf(worker.lastStep) : -1;
		return at >= 0 ? arc.slice(at) : arc;
	}

	/**
	 * A handed-out order: a bare `ok`, which a mind keeps out of its memory. A law hands work out every time it fires,
	 * and the roster already shows who went where.
	 */
	private sent(verb:string):ArcResult {
		return ok(verb);
	}

	/** A commander's `gather`, `repair` or `haul`: pick the workers and give each the job as its own. */
	private handOut(call:VerbCall<TCtx>):ArcResult {
		const near = str(call.args.from) || str(call.args.target) || undefined;
		const workers = this.workersFor(call, near && this.host.describe(near) ? near : undefined, call.verb === 'repair' ? 'any' : 'idle');
		if (typeof workers === 'string') {
			return fail(call.verb, workers);
		}
		this.assign(workers, () => this.ownStep(call), call.verb === 'repair');
		return this.sent(call.verb);
	}

	/** Walk `call`'s character into reach of `target`; `undefined` once there. */
	private async reach(call:VerbCall<TCtx>, target:string, within?:number):Promise<ArcResult | undefined> {
		const r = await call.goTo(target, within === undefined ? {} : { within });
		return r.ok ? undefined : r;
	}

	/** `seconds` of work, repeated until full, done, stopped, or interrupted. */
	private async workAt(call:VerbCall<TCtx>, target:string, until:(w:WorkDone)=>boolean):Promise<ArcResult | WorkDone> {
		for (;;) {
			if (!this.host.describe(target)) {
				return { stop: `${target} is gone` };
			}
			const done = this.host.work(call.character.id, target, TICK);
			if (done.stop || until(done)) {
				return done;
			}
			const waited = await call.wait(TICK);
			if (waited.interrupted) {
				return waited;
			}
		}
	}

	private async gather(call:VerbCall<TCtx>):Promise<ArcResult> {
		const me = call.character.id;
		const side = this.sideOf(call.character);
		const from = str(call.args.from);
		const named = this.host.describe(from) ? from : undefined;
		const resource = named ? this.resourceOf(named) : from;
		if (!resource) {
			return fail('gather', `nothing to gather from ${from}`);
		}
		if (!this.tagged(this.kindOf(me), 'Worker')) {
			return fail('gather', `not a worker: ${me}`);
		}
		let node = named ?? this.nearest(me, this.nodes(side, resource));
		this.setDoing(call, `gathering ${resource}`);
		/** Nodes it went to through others in the way, so it never goes round in a circle. */
		const through = new Set<string>();
		while (node) {
			const there = await this.reach(call, node);
			if (there) {
				// More of the same in the way (woods before the woods it was sent to): it gathers its way through that first.
				const first = there.blockedBy?.find((id) => id !== node && !through.has(id) && this.resourceOf(id) === resource && !!this.host.describe(id));
				if (!first) {
					return there;
				}
				through.add(first);
				node = first;
				continue;
			}
			const worked = await this.workAt(call, node, (w) => !!w.full);
			if ('ok' in worked) {
				return worked;
			}
			if (worked.stop && !worked.full) {
				// This node is done: the next nearest of its resource.
				node = this.nearest(me, this.nodes(side, resource).filter((n) => n !== node));
				continue;
			}
			const drop = str(call.args.drop_at) || this.nearest(me, this.dropOffs(side, resource));
			if (!drop) {
				return fail('gather', `nowhere takes ${resource} back; build one that does`);
			}
			const back = await this.reach(call, drop);
			if (back) {
				return back;
			}
			this.host.deposit(me, drop);
		}
		this.clearDoing(call);
		return fail('gather', `no ${resource} left`);
	}

	/** A commander's `build`: checks, pays, lays out the sites, and shares them among the builders. */
	private buildFor(call:VerbCall<TCtx>):ArcResult {
		const what = str(call.args.what);
		const side = this.sideOf(call.character);
		const count = Math.max(1, Math.round(num(call.args.count) ?? 1));
		const refused = this.canBuild(side, what, count);
		if (refused) {
			return fail('build', refused);
		}
		const near = str(call.args.near) || undefined;
		const helping = near && this.isSiteOf(near, what) ? near : undefined;
		const workers = this.workersFor(call, near, 'any');
		if (typeof workers === 'string') {
			return fail('build', workers);
		}
		const sites = helping ? [helping] : this.lay(side, what, count, near, workers[0].id);
		if (typeof sites === 'string') {
			return fail('build', sites);
		}
		this.assign(workers, (w) => ({ verb: 'build', args: { what, near: this.nearest(w.id, sites) ?? sites[0] } }), true);
		return this.sent('build');
	}

	/** Whether `id` is an unfinished site of `kind`, or of any wall piece when `kind` is one: a wall is one job. */
	private isSiteOf(id:string, kind:string):boolean {
		const c = this._deps.character(id);
		const piece = (k:string | undefined):boolean => this.tagged(k, 'Wall') || this.tagged(k, 'Gate');
		const theirs = this.kindOf(id);
		return !!c && this.unfinished(c) && (theirs === kind || (piece(kind) && piece(theirs)));
	}

	/** The cheapest kind tagged `tag` that `side` may build now. */
	private cheapest(side:string, tag:string):string | undefined {
		const cost = (k:string):number => Object.values(this.spec(k)?.cost ?? {}).reduce((a, b) => a + b, 0);
		return Object.keys(this.host.kinds).filter((k) => this.tagged(k, tag) && !this.needs(side, k).missing).sort((a, b) => cost(a) - cost(b))[0];
	}

	/**
	 * A line of `tag` pieces from `from` to `to` (a wall, a bridge): the cells on the line between them, each laid out
	 * where the game lets it be (a wall on open ground, a bridge over water; any other cell is left out). A wall may
	 * hold `gates`, spread along it. Paid up front for all of it, or not begun.
	 */
	private layLine(call:VerbCall<TCtx>, builder:string, tag:'Wall' | 'Bridge'):{ sites:string[]; kind:string } | string {
		const noun = tag.toLowerCase();
		const side = this.sideOf(call.character);
		const world = this._deps.world();
		const from = str(call.args.from);
		const to = str(call.args.to);
		const a = world && poseOf(world, from)?.point;
		const b = world && poseOf(world, to)?.point;
		if (!a || !b) {
			return `no way to see where ${a ? to : from} is`;
		}
		const kind = str(call.args.what) || this.cheapest(side, tag);
		if (!kind || !this.tagged(kind, tag)) {
			return kind ? `${kind} is not a ${noun}` : `nothing you can build makes a ${noun}`;
		}
		const gateKind = tag === 'Wall' ? this.cheapest(side, 'Gate') : undefined;
		const steps = Math.max(1, Math.ceil(distance(a, b)));
		const cells = [...new Map(Array.from({ length: steps + 1 }, (_, i) => {
			const p = a.map((v, k) => Math.round(v + ((b[k] - v) * i) / steps));
			return [p.join(), p] as const;
		})).values()];
		const gates = Math.min(cells.length, Math.max(0, Math.round(num(call.args.gates) ?? 0)));
		if (gates > 0 && !gateKind) {
			return 'nothing you can build makes a gate';
		}
		const gateAt = new Set(Array.from({ length: gates }, (_, g) => Math.min(cells.length - 1, Math.round(((g + 1) * cells.length) / (gates + 1)))));
		const plan = cells.map((at, i) => ({ at, kind: gateAt.has(i) ? gateKind! : kind }));
		const total:CountMap = {};
		for (const { kind: k } of plan) {
			for (const [res, n] of Object.entries(this.spec(k)?.cost ?? {})) {
				total[res] = (total[res] ?? 0) + n;
			}
		}
		const short = this.short(side, total);
		if (short) {
			return `short ${short} for a ${noun} of ${plan.length}`;
		}
		const sites:string[] = [];
		for (const { at, kind: k } of plan) {
			const placed = this.host.placeSite(k, undefined, builder, at);
			if (typeof placed === 'string') {
				this.host.addStock(side, scaled(this.spec(k)?.cost ?? {}, -1));
				this.join(side, placed, k, builder, true);
				sites.push(placed);
			}
		}
		return sites.length > 0 ? { sites, kind } : `no room for a ${noun} from ${from} to ${to}`;
	}

	/** A commander's `wall` or `bridge`: lay the line out and share it among the builders, nearest piece first. */
	private lineFor(call:VerbCall<TCtx>, tag:'Wall' | 'Bridge'):ArcResult {
		const workers = this.workersFor(call, str(call.args.from) || undefined, 'any');
		if (typeof workers === 'string') {
			return fail(call.verb, workers);
		}
		const laid = this.layLine(call, workers[0].id, tag);
		if (typeof laid === 'string') {
			return fail(call.verb, laid);
		}
		this.assign(workers, (w) => ({ verb: 'build', args: { what: laid.kind, near: this.nearest(w.id, laid.sites) ?? laid.sites[0] } }), true);
		return this.sent(call.verb);
	}

	/** A worker's own `wall` or `bridge`: lay it out and build it, piece after piece, from the nearest. */
	private async line(call:VerbCall<TCtx>, tag:'Wall' | 'Bridge'):Promise<ArcResult> {
		const laid = this.layLine(call, call.character.id, tag);
		if (typeof laid === 'string') {
			return fail(call.verb, laid);
		}
		const built = await this.build({ ...call, args: { what: laid.kind, near: this.nearest(call.character.id, laid.sites) ?? laid.sites[0] } });
		return built.ok ? ok(call.verb, `${tag.toLowerCase()} from ${str(call.args.from)} to ${str(call.args.to)} built`) : built;
	}

	/** Why `side` cannot build `count` of `what` now; empty when it can. */
	private canBuild(side:string, what:string, count:number):string {
		const spec = this.spec(what);
		if (!spec || !spec.tags?.includes('Building')) {
			return `${what} is not something you can build`;
		}
		const { missing } = this.needs(side, what);
		if (missing) {
			return `needs ${missing} first`;
		}
		const short = this.short(side, spec.cost ?? {}, count);
		return short ? `short ${short}` : '';
	}

	/** Pay for and lay out `count` sites of `what`: their ids, or why none. Sites a game refuses are paid back. */
	private lay(side:string, what:string, count:number, near:string | undefined, builder:string):string[] | string {
		const cost = this.spec(what)?.cost ?? {};
		const sites:string[] = [];
		let reason = '';
		for (let i = 0; i < count; i++) {
			const placed = this.host.placeSite(what, near, builder);
			if (typeof placed !== 'string') {
				reason = placed.reason;
				continue;
			}
			this.host.addStock(side, scaled(cost, -1));
			this.join(side, placed, what, builder, true);
			sites.push(placed);
		}
		return sites.length > 0 ? sites : reason || `no room for ${what}`;
	}

	/** A worker's own `build`: lay out a site (or help with the unfinished one it is near) and build until done. */
	private async build(call:VerbCall<TCtx>):Promise<ArcResult> {
		const me = call.character.id;
		const side = this.sideOf(call.character);
		const what = str(call.args.what);
		const near = str(call.args.near) || undefined;
		let site = near && this.isSiteOf(near, what) ? near : undefined;
		if (!site) {
			const refused = this.canBuild(side, what, 1);
			if (refused) {
				return fail('build', refused);
			}
			const laid = this.lay(side, what, 1, near, me);
			if (typeof laid === 'string') {
				return fail('build', laid);
			}
			site = laid[0];
		}
		const sites = ():string[] => this.members(side).filter((c) => this.isSiteOf(c.id, what)).map((c) => c.id);
		// Sites out of reach for now, as a bridge's far end is until the pieces before it stand.
		const blocked = new Set<string>();
		while (site) {
			this.setDoing(call, `building ${what}`);
			const there = await this.reach(call, site);
			if (there) {
				blocked.add(site);
				const next = there.unreachable ? this.nearest(me, sites().filter((id) => !blocked.has(id))) : undefined;
				if (!next) {
					return there;
				}
				site = next;
				continue;
			}
			const worked = await this.workAt(call, site, (w) => !!w.done);
			if ('ok' in worked) {
				return worked;
			}
			if (worked.stop) {
				this.clearDoing(call);
				return fail('build', worked.stop);
			}
			const built = this._deps.character(site);
			if (built) {
				built.tags = built.tags.filter((t) => t !== 'Unfinished');
			}
			// Help with the nearest other one of the same still standing unfinished; one now finished may open a way.
			blocked.clear();
			site = this.nearest(me, sites());
		}
		this.clearDoing(call);
		return ok('build', `${what} built`);
	}

	private async repair(call:VerbCall<TCtx>):Promise<ArcResult> {
		const me = call.character.id;
		const target = str(call.args.target);
		this.setDoing(call, `repairing ${target}`);
		const there = await this.reach(call, target);
		if (there) {
			return there;
		}
		const worked = await this.workAt(call, target, (w) => !!w.done);
		this.clearDoing(call);
		if ('ok' in worked) {
			return worked;
		}
		return worked.stop ? fail('repair', worked.stop) : ok('repair', `${target} repaired`);
	}

	/** Buildings that make `kind`, as `call` picks them (`at`) or every one `side` has. */
	private producers(call:VerbCall<TCtx>, kind:string):Character<TCtx>[] | string {
		const side = this.sideOf(call.character);
		const makers = this.spec(kind)?.madeAt ?? [];
		const at = str(call.args.at);
		if (!at && !this.isCommander(call.character) && call.character.tags.includes('Building')) {
			// A building's own program: it makes it there.
			return makers.includes(this.kindOf(call.character.id) ?? '') ? [call.character] : `${call.character.id} can't make ${kind}`;
		}
		if (at) {
			const picked = this.pickMembers(call, at);
			if (typeof picked === 'string') {
				return picked;
			}
			const can = picked.filter((c) => makers.includes(this.kindOf(c.id) ?? ''));
			if (can.length === 0) {
				const first = picked[0];
				const theirs = first && this.madeAt(this.kindOf(first.id));
				return first ? `${first.id} can't make ${kind}; it makes ${theirs || 'nothing'}` : `${at} picks no building`;
			}
			return can;
		}
		const all = this.members(side).filter((c) => makers.includes(this.kindOf(c.id) ?? ''));
		return all.length > 0 ? all : `nothing you own makes ${kind}; ${makers.length > 0 ? `${makers.join(' or ')} does` : 'nothing does'}`;
	}

	/** Whether what is queued will not fit under the supply cap. */
	private atCap(side:string):boolean {
		const { units, queued, cap } = this.supply(side);
		return units + queued > cap;
	}

	/** What a building kind makes, as text. */
	private madeAt(building:string | undefined):string {
		return Object.entries(this.host.kinds).filter(([, s]) => building && s.madeAt?.includes(building)).map(([k]) => k).join(', ');
	}

	/** Seconds until `building`'s queue is empty. */
	private queued(side:string, building:string):number {
		return (this.state(side).queues.get(building) ?? []).reduce((sum, o) => sum + o.left, 0);
	}

	private enqueue(side:string, building:string, order:Order):void {
		const queues = this.state(side).queues;
		queues.set(building, [...queues.get(building) ?? [], order]);
	}

	private train(call:VerbCall<TCtx>):ArcResult {
		const what = str(call.args.what);
		const spec = this.spec(what);
		const side = this.sideOf(call.character);
		if (!spec || spec.tags?.includes('Building') || spec.tags?.includes('Tech')) {
			return fail('train', `${what} is not a unit you can train`);
		}
		const makers = this.producers(call, what);
		if (typeof makers === 'string') {
			return fail('train', makers);
		}
		const { missing, pending } = this.needs(side, what);
		if (missing) {
			return fail('train', `needs ${missing}`);
		}
		const want = Math.max(1, Math.round(num(call.args.count) ?? 1));
		const count = Math.min(want, this.affordable(side, spec.cost ?? {}));
		if (count === 0) {
			return fail('train', `short ${this.short(side, spec.cost ?? {})}`);
		}
		const placed = new Map<string, number>();
		for (let i = 0; i < count; i++) {
			// The building whose queue would finish it soonest.
			const at = makers.reduce((best, b) => (this.queued(side, b.id) < this.queued(side, best.id) ? b : best));
			this.host.addStock(side, scaled(spec.cost ?? {}, -1));
			this.enqueue(side, at.id, { kind: what, building: at.id, side, paid: spec.cost ?? {}, left: spec.seconds ?? 0, tech: false, rally: str(call.args.rally) || undefined });
			placed.set(at.id, (placed.get(at.id) ?? 0) + 1);
		}
		// What was queued and where, so the line says it alone: `Archer ×2 at Archery2, Archer ×1 at Archery1`.
		const where = [...placed].map(([b, n]) => `${what} ×${n} at ${b}`).join(', ');
		const waits = [
			...pending ? [`waiting for ${pending}`] : [],
			...makers.some((b) => this.unfinished(b)) ? ['waiting for its building to be finished'] : [],
			...this.atCap(side) ? [`waiting for ${this.cap.used} ${this.supply(side).units}/${this.supply(side).cap}`] : [],
			...count < want ? [`short ${this.short(side, spec.cost ?? {}, want - count)} for the rest`] : [],
		];
		return ok('train', [where, ...waits].join('; '));
	}

	private research(call:VerbCall<TCtx>):ArcResult {
		const what = str(call.args.what);
		const spec = this.spec(what);
		const side = this.sideOf(call.character);
		if (!spec || !spec.tags?.includes('Tech')) {
			return fail('research', `${what} is not something to research`);
		}
		if (this.state(side).techs.has(what)) {
			return fail('research', `${what} is already researched`);
		}
		const queuedAt = [...this.state(side).queues].find(([, q]) => q.some((o) => o.kind === what))?.[0];
		if (queuedAt) {
			return fail('research', `${what} is already queued at ${queuedAt}`);
		}
		const makers = this.producers(call, what);
		if (typeof makers === 'string') {
			return fail('research', makers);
		}
		const { missing, pending } = this.needs(side, what);
		if (missing) {
			return fail('research', `needs ${missing}`);
		}
		const short = this.short(side, spec.cost ?? {});
		if (short) {
			return fail('research', `short ${short}`);
		}
		const at = makers.reduce((best, b) => (this.queued(side, b.id) < this.queued(side, best.id) ? b : best));
		this.host.addStock(side, scaled(spec.cost ?? {}, -1));
		this.enqueue(side, at.id, { kind: what, building: at.id, side, paid: spec.cost ?? {}, left: spec.seconds ?? 0, tech: true });
		return ok('research', `${what} at ${at.id}${pending ? `; waiting for ${pending}` : ''}`);
	}

	private cancel(call:VerbCall<TCtx>):ArcResult {
		const side = this.sideOf(call.character);
		const what = str(call.args.what);
		const at = str(call.args.at);
		let where:Character<TCtx>[];
		if (at) {
			const picked = this.pickMembers(call, at);
			if (typeof picked === 'string') {
				return fail('cancel', picked);
			}
			where = picked;
		}
		else {
			where = this.isCommander(call.character) ? this.members(side) : [call.character];
		}
		const queues = this.state(side).queues;
		// Newest first: the last thing queued is the first taken back.
		for (const building of [...where].reverse()) {
			const queue = queues.get(building.id) ?? [];
			const i = queue.map((o) => !what || o.kind === what).lastIndexOf(true);
			if (i >= 0) {
				const [order] = queue.splice(i, 1);
				this.host.addStock(side, order.paid);
				return ok('cancel', `${order.kind} at ${building.id}; got ${bundleText(order.paid) || 'nothing'} back`);
			}
		}
		const site = where.find((c) => this.unfinished(c) && (!what || this.kindOf(c.id) === what));
		if (site && this.host.removeSite) {
			const back = Object.fromEntries(Object.entries(this.spec(this.kindOf(site.id))?.cost ?? {}).map(([k, v]) => [k, Math.floor(v * (this.host.salvage ?? SALVAGE))]));
			this.host.removeSite(site.id);
			this.host.addStock(side, back);
			site.collective?.removeCharacter(site.id);
			return ok('cancel', `${site.id} taken down; got ${bundleText(back) || 'nothing'} back`);
		}
		return fail('cancel', `nothing${what ? ` ${what}` : ''} queued${at ? ` at ${at}` : ''}`);
	}

	private rally(call:VerbCall<TCtx>):ArcResult {
		const side = this.sideOf(call.character);
		const to = str(call.args.to);
		if (!this.host.describe(to) && !this._deps.world()?.find(to)) {
			return fail('rally', `no ${to}`);
		}
		const at = str(call.args.at);
		let buildings:Character<TCtx>[];
		if (at) {
			const picked = this.pickMembers(call, at);
			if (typeof picked === 'string') {
				return fail('rally', picked);
			}
			buildings = picked;
		}
		else if (!this.isCommander(call.character)) {
			buildings = [call.character];
		}
		else {
			const makers = new Set(Object.values(this.host.kinds).flatMap((s) => s.madeAt ?? []));
			buildings = this.members(side).filter((c) => makers.has(this.kindOf(c.id) ?? ''));
		}
		for (const b of buildings) {
			this.state(side).rally.set(b.id, to);
		}
		return ok('rally', `${buildings.map((b) => b.id).join(', ')} → ${to}`);
	}

	// ── Fighting ───────────────────────────────────────────────────────

	private range(id:string):number {
		return this.spec(this.kindOf(id))?.range ?? 1;
	}

	private isFoe(side:string, id:string):boolean {
		const owner = this.host.describe(id)?.owner;
		return owner !== undefined && owner !== side && !(this.host.areAllies?.(side, owner) ?? false);
	}

	/** The foe to hit now: the first of `focus` within `within`, else the nearest seen foe within it. */
	/** `out`: foes it found no way to reach this time (a bridge piece over the water): left for others. */
	private acquire(call:VerbCall<TCtx>, within:number, focus:string[], out?:ReadonlySet<string>):string | undefined {
		const me = call.character.id;
		const side = this.sideOf(call.character);
		const seen = this._deps.seen(call).filter((id) => this.isFoe(side, id) && this.distance(me, id) <= within && !out?.has(id));
		return focus.find((id) => seen.includes(id)) ?? this.nearest(me, seen);
	}

	private focusOf(call:VerbCall<TCtx>):string[] {
		const expr = str(call.args.focus);
		if (!expr) {
			return [];
		}
		const picked = this._deps.pick(call, expr);
		return Array.isArray(picked) ? picked : [];
	}

	/** The first foe's piece that stood in the way of a failed move, still standing: what to break through. */
	private inTheWay(call:VerbCall<TCtx>, failed:ArcResult):string | undefined {
		const side = this.sideOf(call.character);
		return failed.blockedBy?.find((id) => this.isFoe(side, id) && !!this.host.describe(id));
	}

	/** Hit `target` until it is gone, chasing it, or until `leave` says stop. */
	private async fight(call:VerbCall<TCtx>, target:string, leave?:()=>boolean):Promise<ArcResult | undefined> {
		const me = call.character.id;
		while (this.host.describe(target) && !leave?.()) {
			if (!this.host.attack(me, target, TICK)) {
				const there = await call.goTo(target, { within: this.range(me), check: () => (leave?.() ? 'left' : undefined) });
				if (!there.ok) {
					const wall = this.inTheWay(call, there);
					const broke = wall && await this.fight(call, wall);
					if (!wall || broke) {
						return broke || there;
					}
				}
			}
			const waited = await call.wait(TICK);
			if (waited.interrupted) {
				return waited;
			}
		}
		return undefined;
	}

	private async attack(call:VerbCall<TCtx>):Promise<ArcResult> {
		const picked = this._deps.pick(call, str(call.args.target));
		if (!Array.isArray(picked)) {
			return fail('attack', picked.error);
		}
		const side = this.sideOf(call.character);
		const targets = picked.filter((id) => this.isFoe(side, id));
		if (targets.length === 0) {
			return fail('attack', 'no such foe');
		}
		this.setDoing(call, `attacking ${targets[0]}`);
		for (const target of targets) {
			const out = await this.fight(call, target);
			if (out) {
				return out;
			}
		}
		this.clearDoing(call);
		return ok('attack', `${targets.join(', ')} down`);
	}

	private async attackMove(call:VerbCall<TCtx>):Promise<ArcResult> {
		const me = call.character.id;
		const to = str(call.args.to);
		const focus = this.focusOf(call);
		const chase = this.range(me) + (this.host.chase ?? CHASE);
		this.setDoing(call, `attacking toward ${to}`);
		const unreached = new Set<string>();
		for (;;) {
			const foe = this.acquire(call, chase, focus, unreached);
			if (foe) {
				const out = await this.fight(call, foe, () => this.distance(me, foe) > chase);
				if (out?.unreachable === foe) {
					unreached.add(foe);
					continue;
				}
				if (out) {
					return out;
				}
				continue;
			}
			const went = await call.goTo(to, { check: () => (this.acquire(call, chase, focus, unreached) ? 'foe' : undefined) });
			if (!went.ok) {
				// A foe's wall in the way: through it, and on.
				const wall = this.inTheWay(call, went);
				const broke = wall && await this.fight(call, wall);
				if (!wall || broke) {
					return broke || went;
				}
				continue;
			}
			if (went.reason !== 'foe' && !this.acquire(call, chase, focus, unreached)) {
				this.clearDoing(call);
				return ok('attack_move', `at ${to}`);
			}
		}
	}

	private async hold(call:VerbCall<TCtx>):Promise<ArcResult> {
		const me = call.character.id;
		const at = str(call.args.at);
		if (at) {
			const there = await this.reach(call, at);
			if (there) {
				return there;
			}
		}
		const world = this._deps.world();
		const spot = world && poseOf(world, me)?.point;
		const within = num(call.args.fire_within) ?? this.range(me);
		const focus = this.focusOf(call);
		this.setDoing(call, `holding${at ? ` ${at}` : ''}`);
		for (;;) {
			const foe = this.acquire(call, Math.min(within, this.range(me)), focus);
			if (foe) {
				this.host.attack(me, foe, TICK);
			}
			const now = world && poseOf(world, me)?.point;
			if (spot && now && distance(spot, now) > HOLD_SLACK) {
				const back = await call.goToPoint(spot);
				if (!back.ok) {
					return back;
				}
			}
			const waited = await call.wait(TICK);
			if (waited.interrupted) {
				return waited;
			}
		}
	}

	private async patrol(call:VerbCall<TCtx>):Promise<ArcResult> {
		const me = call.character.id;
		const to = str(call.args.to);
		const world = this._deps.world();
		const home = world && poseOf(world, me)?.point;
		const focus = this.focusOf(call);
		const chase = this.range(me) + (this.host.chase ?? CHASE);
		const unreached = new Set<string>();
		const check = ():string | undefined => (this.acquire(call, chase, focus, unreached) ? 'foe' : undefined);
		this.setDoing(call, `patrolling to ${to}`);
		for (let out = true; ; ) {
			const foe = this.acquire(call, chase, focus, unreached);
			if (foe) {
				const fought = await this.fight(call, foe, () => this.distance(me, foe) > chase);
				if (fought?.unreachable === foe) {
					unreached.add(foe);
					continue;
				}
				if (fought) {
					return fought;
				}
				continue;
			}
			const went = out || !home ? await call.goTo(to, { check }) : await call.goToPoint(home, { check });
			if (!went.ok) {
				return went;
			}
			if (went.reason !== 'foe') {
				out = !out;
			}
		}
	}

	private async garrison(call:VerbCall<TCtx>):Promise<ArcResult> {
		const me = call.character.id;
		const container = str(call.args.in);
		const holds = this.spec(this.kindOf(container))?.holds;
		if (!holds) {
			return fail('garrison', `${container} holds no one`);
		}
		const inside = this._inside.get(container) ?? new Set<string>();
		const kind = this.kindOf(me) ?? '';
		if (holds.kinds && !holds.kinds.includes(kind)) {
			return fail('garrison', `${container} doesn't take ${kind}`);
		}
		if (inside.size >= holds.capacity) {
			return fail('garrison', `${container} is full (${inside.size}/${holds.capacity})`);
		}
		const there = await this.reach(call, container);
		if (there) {
			return there;
		}
		this.host.enter(me, container);
		inside.add(me);
		this._inside.set(container, inside);
		this.setDoing(call, `inside ${container}`);
		// Inside until let out; a new order lets it out first.
		for (;;) {
			const waited = await call.wait(TICK);
			if (!inside.has(me)) {
				this.clearDoing(call);
				return ok('garrison', `out of ${container}`);
			}
			if (waited.interrupted) {
				inside.delete(me);
				this.host.exit(me, container);
				this.clearDoing(call);
				return waited;
			}
		}
	}

	private async unload(call:VerbCall<TCtx>):Promise<ArcResult> {
		const me = call.character.id;
		const inside = this._inside.get(me);
		if (!inside || inside.size === 0) {
			return fail('unload', 'nobody inside');
		}
		const at = str(call.args.at);
		if (at && !call.character.tags.includes('Building')) {
			const there = await this.reach(call, at);
			if (there) {
				return there;
			}
		}
		const out = [...inside];
		for (const unit of out) {
			inside.delete(unit);
			this.host.exit(unit, me);
		}
		return ok('unload', `${out.join(', ')} out`);
	}

	/** Who is inside `container`. */
	public occupants(container:string):readonly string[] {
		return [...this._inside.get(container) ?? []];
	}

	// ── Side verbs ─────────────────────────────────────────────────────

	private tribute(call:VerbCall<TCtx>):ArcResult {
		const side = this.sideOf(call.character);
		const to = str(call.args.to);
		const them = this._deps.character(to)?.collective?.id ?? this.host.describe(to)?.owner ?? to;
		if (them === side || !(this.host.areAllies?.(side, them) ?? false)) {
			return fail('tribute', `${to} is not your ally`);
		}
		const give = (call.args.give ?? {}) as CountMap;
		const stock = this.host.getStock(side);
		const lacking = Object.entries(give).find(([k, v]) => (stock[k] ?? 0) < v);
		if (lacking) {
			return fail('tribute', `you have ${stock[lacking[0]] ?? 0} ${lacking[0]}`);
		}
		const share = this.host.tributeShare ?? 1;
		const arrived = Object.fromEntries(Object.entries(give).map(([k, v]) => [k, Math.floor(v * share)]));
		this.host.addStock(side, scaled(give, -1));
		this.host.addStock(them, arrived);
		this._deps.tell(them, `${side} sent you ${bundleText(arrived)}.`);
		return ok('tribute', `${bundleText(arrived)} arrived`);
	}

	private setPolicy(call:VerbCall<TCtx>):ArcResult {
		const side = this.sideOf(call.character);
		const name = str(call.args.name);
		const to = str(call.args.to);
		const policy = this.host.policies?.[name];
		if (!policy || !this.host.setPolicy) {
			const known = Object.keys(this.host.policies ?? {});
			return fail('set_policy', `no policy ${name}${known.length > 0 ? `; there are ${known.join(', ')}` : ''}`);
		}
		if (!policy.options.includes(to)) {
			return fail('set_policy', `${name} can be: ${policy.options.join(', ')}`);
		}
		const missing = (policy.requires ?? []).find((r) => !this.owned(side).has(r));
		if (missing) {
			return fail('set_policy', `needs ${missing}`);
		}
		this.host.setPolicy(side, name, to);
		return ok('set_policy', `${name}: ${to}`);
	}

	// ── City ───────────────────────────────────────────────────────────

	/** A commander's `staff`: fill each building's free jobs, or free them with `workers=0`. */
	private staffFor(call:VerbCall<TCtx>):ArcResult {
		const picked = this.pickMembers(call, str(call.args.at));
		if (typeof picked === 'string') {
			return fail('staff', picked);
		}
		const want = num(call.args.workers);
		const lines:string[] = [];
		for (const building of picked) {
			const slots = this.spec(this.kindOf(building.id))?.slots ?? 0;
			const on = this.staffOf(building.id);
			if (want === 0) {
				on.forEach((w) => w.replaceProgram());
				lines.push(`${building.id} emptied`);
				continue;
			}
			const free = Math.min(slots - on.length, want ?? Infinity);
			if (free <= 0) {
				lines.push(`${building.id} has no free jobs (${on.length}/${slots})`);
				continue;
			}
			const workers = this.workersFor({ ...call, args: { ...call.args, workers: free } }, building.id, 'idle');
			if (typeof workers === 'string') {
				return fail('staff', lines.length > 0 ? `${lines.join('; ')}; ${workers}` : workers);
			}
			this.assign(workers, () => ({ verb: 'staff', args: { at: building.id } }), false);
			lines.push(`${building.id}: ${workers.map((w) => w.id).join(', ')}`);
		}
		return ok('staff', lines.join('; '));
	}

	private staffOf(building:string):Character<TCtx>[] {
		return [...this._doing].filter(([, doing]) => doing.text === `working at ${building}`).map(([id]) => this._deps.character(id)).filter((c):c is Character<TCtx> => !!c);
	}

	private async staff(call:VerbCall<TCtx>):Promise<ArcResult> {
		const me = call.character.id;
		const at = str(call.args.at);
		const there = await this.reach(call, at);
		if (there) {
			return there;
		}
		this.setDoing(call, `working at ${at}`);
		const worked = await this.workAt(call, at, () => false);
		this.clearDoing(call);
		if ('ok' in worked) {
			return worked;
		}
		return fail('staff', worked.stop ?? `${at} has no work`);
	}

	private async haul(call:VerbCall<TCtx>):Promise<ArcResult> {
		const me = call.character.id;
		const what = str(call.args.what);
		const from = str(call.args.from);
		const to = str(call.args.to);
		const keep = num(call.args.keep);
		if (!this.host.withdraw) {
			return fail('haul', 'nothing here is hauled');
		}
		this.setDoing(call, `hauling ${what} to ${to}`);
		for (;;) {
			if (keep !== undefined && (this.host.holding?.(to, what) ?? 0) >= keep) {
				this.clearDoing(call);
				return ok('haul', `${to} holds ${keep} ${what}`);
			}
			const there = await this.reach(call, from);
			if (there) {
				return there;
			}
			if (this.host.withdraw(me, from, what) <= 0) {
				// Nothing there yet: wait for some.
				const waited = await call.wait(TICK * 4);
				if (waited.interrupted) {
					return waited;
				}
				continue;
			}
			const back = await this.reach(call, to);
			if (back) {
				return back;
			}
			this.host.deposit(me, to);
		}
	}

	// ── Perception ─────────────────────────────────────────────────────

	/** What watches read of `side`: `supply`, `supplyCap` (by the game's name for its cap), `stock.Gold`, `gathering.Wood` (workers on it). */
	public bindings(side:string):Record<string, ExprVal> {
		const { units, cap } = this.supply(side);
		const counts = (row:CountMap):Record<string, ExprVal> => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, { kind: 'number', value: v }]));
		const gathering:CountMap = {};
		const ours = new Set(this.members(side).map((c) => c.id));
		for (const [id, { text }] of this._doing) {
			const resource = ours.has(id) ? /^gathering (.+)$/.exec(text)?.[1] : undefined;
			if (resource) {
				gathering[resource] = (gathering[resource] ?? 0) + 1;
			}
		}
		// Every resource reads 0 until there is some, so `gathering.Wood < 4` holds with no one on it.
		const resources = Object.values(this.host.kinds).flatMap((s) => s.tags ?? []).filter((t) => t.startsWith('Node:')).map((t) => t.slice(5));
		const zero = Object.fromEntries(resources.map((r) => [r, 0]));
		return {
			...this.capped ? { [this.cap.used]: { kind: 'number', value: units }, [this.cap.most]: { kind: 'number', value: cap } } as Record<string, ExprVal> : {},
			stock: { kind: 'entity', value: dummyEntity('Stock', { fields: counts({ ...zero, ...this.host.getStock(side) }) }) },
			gathering: { kind: 'entity', value: dummyEntity('Gathering', { fields: counts({ ...zero, ...gathering }) }) },
		};
	}

	/**
	 * The stock tactics, as alias verbs. A unit's (`keep_distance`, `pull_back`, `spread_out`) and a building's
	 * (`keep_training`) run on it; its side's (`supply_ahead`, `share_workers`) run on the commander, handing work out.
	 * Each brings the watch (and who) it needs as a law's whole arc: `law(name=archers, arc=keep_distance(keep=4), who=…)`.
	 */
	public aliases():Record<string, { args:VerbArgMap; help:string } & VerbAlias> {
		const n = (v:unknown, d:number):number => num(v) ?? d;
		const from = (a:Readonly<Record<string, StepArg>>):string => `(${str(a.from) || 'others.filter(u => u.foe)'})`;
		const supplyKind = (a:Readonly<Record<string, StepArg>>):string => str(a.what) || this.cheapestSupply();
		const cap = this.cap;
		return {
			keep_distance: {
				help: 'steps back from the nearest of from (default: foes); as a law: whenever one is nearer than keep',
				args: { from: 'expr?', keep: 'number?' },
				watch: (a) => `${from(a)}.some(u => distance(me, u) < ${n(a.keep, 3)})`,
				arc: (a) => `flee(from=${from(a)}.minBy(u => distance(me, u)), distance=${n(a.keep, 3) + 2})`,
			},
			pull_back: {
				help: 'goes to to (default: nearest own building) until healed; as a law: whenever below hp %',
				args: { below: 'number?', to: 'id?' },
				watch: (a) => `me.hp * 100 < me.maxHP * ${n(a.below, 35)}`,
				arc: (a) => `go_to(${str(a.to) || 'units.filter("Building").minBy(u => distance(me, u))'}) && wait(until=me.hp >= me.maxHP, seconds=120)`,
			},
			// It holds once spread: a law runs its arc again while its watch holds, so a bare spread would walk to its
			// slot over and over and never fight.
			spread_out: {
				help: 'spreads apart and holds there, fighting what comes in range; as a law: whenever a foe that hits many at once (Splash) is seen',
				args: { paces: 'number?' },
				watch: () => 'others.filter("Splash").some(u => u.foe)',
				arc: (a) => `spread(paces=${n(a.paces, 4)}) && hold()`,
			},
			keep_training: {
				help: 'a building trains one what and waits for it; as a law: while there are fewer than until',
				args: { what: 'string', until: 'number?' },
				watch: (a) => `count(units.filter("${str(a.what)}")) < ${n(a.until, 999)}`,
				who: (a) => `units.filter("${this.spec(str(a.what))?.madeAt?.[0] ?? 'Building'}")`,
				arc: (a) => `train(what=${str(a.what)}) ; wait(seconds=${Math.max(1, this.spec(str(a.what))?.seconds ?? 1)})`,
			},
			...this.capped ? {
				supply_ahead: {
					help: `builds what (default: the cheapest building that raises ${cap.used}); as a law: when ${cap.used} is within margin of its cap`,
					args: { what: 'string?', margin: 'number?' },
					watch: (a:Readonly<Record<string, StepArg>>) => `${cap.most} - ${cap.used} <= ${n(a.margin, 2)} && count(units.filter("${supplyKind(a)}").filter("Unfinished")) == 0`,
					who: () => 'me',
					arc: (a:Readonly<Record<string, StepArg>>) => `build(what=${supplyKind(a)})`,
				},
			} : {},
			share_workers: {
				help: 'sends one idle worker to gather on; as a law: while fewer than of gather it',
				args: { on: 'string', of: 'number?' },
				watch: (a) => `gathering.${str(a.on)} < ${n(a.of, 1)} && count(units.filter("Worker").filter(u => !u.busy)) > 0`,
				who: () => 'me',
				arc: (a) => `gather(from=${str(a.on)}, workers=1)`,
			},
		};
	}

	/** The cheapest building that adds supply: what `supply_ahead` builds by default. */
	private cheapestSupply():string {
		const cost = (s:KindSpec):number => Object.values(s.cost ?? {}).reduce((a, b) => a + b, 0);
		return Object.entries(this.host.kinds)
			.filter(([, s]) => (s.provides ?? 0) > 0 && s.tags?.includes('Building'))
			.sort(([, a], [, b]) => cost(a) - cost(b))[0]?.[0] ?? 'House';
	}

	/** `side` as its commander reads it: stock, supply, queues, and its units grouped by kind and what they do. */
	public status(side:string):string {
		const stock = this.host.getStock(side);
		const { units, queued, cap } = this.supply(side);
		const lines = [`Stock: ${bundleText(stock) || 'nothing'}`];
		if (this.capped) {
			lines.push(`${this.cap.name}: ${units}/${cap}${queued > 0 ? ` (${queued} more queued)` : ''}`);
		}
		const queues = [...this.state(side).queues]
			.filter(([, q]) => q.length > 0)
			.map(([b, q]) => {
				const runs = new Map<string, number>();
				q.forEach((o) => runs.set(o.kind, (runs.get(o.kind) ?? 0) + 1));
				const building = this._deps.character(b);
				const wait = building && this.unfinished(building) ? `, waiting for ${b} to be finished` : '';
				return `${b} ${[...runs].map(([k, n]) => (n > 1 ? `${k} ×${n}` : k)).join(', ')} (${Math.ceil(q[0].left)} s${wait})`;
			});
		if (queues.length > 0) {
			lines.push(`Queues: ${queues.join('; ')}`);
		}
		const techs = [...this.state(side).techs];
		if (techs.length > 0) {
			lines.push(`Researched: ${techs.join(', ')}`);
		}
		const commander = this._deps.collective(side)?.commander;
		const groups = new Map<string, Map<string, number>>();
		for (const c of this.members(side)) {
			if (c === commander) {
				continue;
			}
			const kind = this.kindOf(c.id) ?? c.tags[0] ?? 'Unit';
			const doing = this.unfinished(c) ? 'unfinished' : this._doing.get(c.id)?.text ?? (c.busy ? c.verb || 'busy' : this.spec(kind)?.tags?.includes('Building') ? '' : 'idle');
			const counts = groups.get(kind) ?? new Map<string, number>();
			counts.set(doing, (counts.get(doing) ?? 0) + 1);
			groups.set(kind, counts);
		}
		if (groups.size > 0) {
			const roster = [...groups].map(([kind, counts]) => {
				const total = [...counts.values()].reduce((a, b) => a + b, 0);
				const parts = [...counts].filter(([d]) => d).map(([d, n]) => `${n} ${d}`);
				return `${kind} ×${total}${parts.length > 0 ? ` (${parts.join(', ')})` : ''}`;
			});
			lines.push(`Units: ${roster.join('; ')}`);
		}
		return lines.join('\n');
	}
}
