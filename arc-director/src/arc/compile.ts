import { endlessProblem, exprArgs, misplacedThink, onlyLast, validateArc } from './validate.js';
import type { ArgPath } from './constraints.js';
import { CHOOSE_VERB, isFree, type VerbRegistry } from './stock-verbs.js';
import { ArcError, eachStep, firstStep, mapArgs, sameProgram, type Arc, type Step } from './arc-types.js';
import { choicesOf } from './choose.js';
import { finishedSteps, finishedText, parseArc } from './wire.js';
import type { ArcFormat } from '../mind/mind-types.js';
import { catalogEntities, unboundCalls } from '../expr/eval.js';
import type { Catalog } from '../expr/expr-types.js';
import { plainTagTests } from '../expr/tag-tests.js';
import { extractJson, isRecord } from '../json.js';
import { mapArc, type WordMap } from '../mind/ids.js';

/**
 * A part of a reply that did not stand: its steps (none for what is left of a reply that does not read), why, the text
 * at fault and the arg that holds it.
 */
export type Rejected = { steps:readonly Pick<Step, 'verb' | 'args'>[]; reason:string; at?:string; arg?:ArgPath };

/** `part` as the repair turn names it: `law named Gate`, `go_to then say`, or `the rest of your reply`. */
export function partLabel(part:Rejected):string {
	const labelOf = (step:Pick<Step, 'verb' | 'args'>):string => {
		const name = typeof step.args.name === 'string' ? ` named ${step.args.name}` : typeof step.args.who === 'string' ? ` for ${step.args.who}` : '';
		return `${step.verb}${name}`;
	};
	return part.steps.length > 0 ? part.steps.map(labelOf).join(' then ') : 'the rest of your reply';
}

/** What is left of a reply `err` refused, as a part: no steps, its reason, and the text and arg at fault. */
export function restOfReply(err:Error):Rejected {
	return err instanceof ArcError ? { steps: [], reason: err.message, at: err.at, arg: err.arg } : { steps: [], reason: err.message };
}

/** Each of `parts` by its label and why: `law named Gate: no such verb; the rest of your reply: …`. */
export function partsText(parts:readonly Rejected[]):string {
	return parts.map((part) => `${partLabel(part)}: ${part.reason}`).join('; ');
}

/** The parts of a reply still refused when no repair is left. */
export class RejectedParts extends ArcError {
	constructor(public readonly parts:readonly Rejected[]) {
		super(partsText(parts));
	}

	/**
	 * What did not run, by verb and the arg at fault (`its wait(until) could not be read`), never by what is written in
	 * them: a model shown its mistake in the next think writes it again.
	 */
	public get note():string {
		return this.parts.map((part) => {
			const [verb, key] = part.arg?.split('.') ?? [];
			const which = key ? `${verb}(${key})` : part.steps.map((step) => step.verb).join(' then ');
			return `${which ? `its ${which}` : 'the rest of your reply'} could not be read`;
		}).join('; ');
	}
}

/** What a reply is read against: the verbs it may use, the world its watches ask, and whom its names mean. */
export type ReplyContext = {
	verbs:VerbRegistry;
	/** The watch language's view of the world as the writer sees it: what a tag test and a watch function mean. */
	catalog?:()=>Catalog | undefined;
	/** The writer's names to ids. */
	ids:WordMap;
	/** Fewest choices a `choose` is worth asking about. */
	minChoices:number;
	/** The arcs an explicit `think` may be written directly in (`if.arc`). */
	explicitThinkAllowedInside:readonly ArgPath[];
	/** Whether a bad reply goes back to be written again; without, it runs as written and its verbs say what went wrong. */
	repairs:boolean;
	/** The host's further check of a well-formed arc, in ids: the world ruling a step out. */
	problem?:(arc:Arc)=>ArcError | undefined;
};

/**
 * Reads a model's replies into arcs in ids, ready to run: its names mapped, tag tests in the language's own form, and
 * every check made that could send it back.
 */
export class ReplyReader {
	constructor(private readonly _ctx:ReplyContext) {}

	/** The reply as an arc in ids. Throws on a watch that calls a function the watch language does not have: it could never be true. */
	public read(content:string):Arc {
		const arc = this.inIDs(parseArc(content, this._ctx.verbs));
		const problem = this.problemIn(arc);
		if (problem) {
			throw problem;
		}
		return arc;
	}

	/**
	 * The root steps of the reply written to their end so far, in ids and unchecked; none while it has none. They stop
	 * short of one that never ends ({@link onlyLast}): valid only last, it gains nothing by starting before the reply is
	 * whole, and once started, a rest written after it could never run.
	 */
	public soFar(content:string, format:ArcFormat):Arc {
		const done = format === 'text' ? finishedText(content) : finishedSteps(content);
		try {
			const steps = done ? this.inIDs(parseArc(done, this._ctx.verbs)) : [];
			const endless = steps.findIndex((step) => onlyLast(step, this._ctx.verbs));
			return endless < 0 ? steps : steps.slice(0, endless);
		}
		catch {
			return [];
		}
	}

	/** Why `arc`, part of a reply, could never work as written, by the checks a whole reply gets. */
	public problem(arc:Arc):ArcError | undefined {
		return this.problemIn(arc);
	}

	/** The reply as an arc, or null when it is empty or does not read. */
	public tryRead(content:string):Arc | null {
		try {
			const arc = content.trim() ? this.read(content) : undefined;
			return arc && firstStep(arc)?.verb ? arc : null;
		}
		catch {
			return null;
		}
	}

	/**
	 * What a reply comes to when its steps are judged apart, given those already `kept`. A step that needs no body, and is
	 * not joined to one that does, stands alone: it can fail while others run. The rest are one chain that stands or falls
	 * together. A step it restates from `kept` is not judged again.
	 */
	public judge(content:string, kept:Arc):{ good:Arc; bad:Rejected[] } {
		const { verbs } = this._ctx;
		const { steps: read, unread } = this.readRoots(content);
		const steps = read.filter((step) => !kept.some((had) => sameProgram([had], [step])));
		const free = (step:Step | undefined):boolean => !!step && isFree(verbs, step.verb);
		const alone = (step:Step, i:number):boolean => free(step)
			&& (i === 0 || free(steps[i - 1]) || steps[i - 1].then === 'always')
			&& (i === steps.length - 1 || free(steps[i + 1]) || step.then === 'always');
		const good:Arc = [];
		const bad = [...unread];
		const chain = steps.filter((step, i) => !alone(step, i));
		steps.forEach((step) => {
			if (chain.includes(step)) {
				return;
			}
			const problem = this.problemIn([...kept, ...good, step]);
			if (problem) {
				bad.push({ steps: [step], reason: problem.message, at: problem.at, arg: problem.arg });
			}
			else {
				good.push(step);
			}
		});
		if (chain.length > 0) {
			const problem = this.problemIn([...kept, ...good, ...chain]);
			if (problem) {
				bad.push({ steps: chain, reason: problem.message, at: problem.at, arg: problem.arg });
			}
			else {
				good.push(...chain);
			}
		}
		// Judged apart, they still run in the order the reply wrote them.
		return { good: steps.filter((step) => good.includes(step)), bad };
	}

	/** An arc as a reply wrote it, as it is kept: in ids, with its tests of what things are in the language's own form. */
	private inIDs(arc:Arc):Arc {
		const { verbs } = this._ctx;
		const catalog = this._ctx.catalog?.();
		const hasField = (name:string):boolean => !!catalog && catalogEntities(catalog).some((entity) => entity.fields?.[name] !== undefined);
		const plain = mapArgs(arc, verbs, (text, kind) => (['watch', 'expr', 'id'].includes(kind) ? plainTagTests(text, hasField) : text));
		return mapArc(plain, verbs, this._ctx.ids);
	}

	/** Why `arc`, in ids, could never work as written, if it could not. */
	private problemIn(arc:Arc):ArcError | undefined {
		const { verbs } = this._ctx;
		const catalog = this._ctx.catalog?.();
		const unbound = catalog ? exprArgs(arc, verbs).flatMap(({ expr, arg }) => unboundCalls(expr, catalog).map((name) => ({ name, arg }))) : [];
		// The observe tool takes a watch, so a model wraps its watches in it.
		const observe = unbound.find(({ name }) => name === 'observe');
		if (observe) {
			return new ArcError('observe is a tool, not a function: write the expression itself, e.g. until=isNear(me, Well, 3)', 'observe', observe.arg);
		}
		if (unbound.length > 0) {
			return new ArcError(`${unbound.map(({ name }) => `${name}()`).join(', ')} is not a watch function`, unbound[0].name, unbound[0].arg);
		}
		// Steps kept from earlier turns and those of a later one are judged as one program: none may follow one that never ends.
		return endlessProblem(arc, verbs) ?? misplacedThink(arc, this._ctx.explicitThinkAllowedInside) ?? (this._ctx.repairs ? this.fewChoices(arc) ?? this._ctx.problem?.(arc) : undefined);
	}

	/** Why a `choose` in `arc` has too few choices to be worth asking about, if one has. */
	private fewChoices(arc:Arc):ArcError | undefined {
		const least = this._ctx.minChoices;
		let found:number | undefined;
		eachStep(arc, this._ctx.verbs, (step) => {
			const count = Object.keys(choicesOf(step)).length;
			if (step.verb === CHOOSE_VERB && count < least) {
				found ??= count;
			}
		});
		return found === undefined ? undefined : new ArcError(`choose needs at least ${least} choices, one for each way things may go: this one has ${found}`);
	}

	/**
	 * The reply's root steps in ids, each read on its own where the whole does not read; `reason` on those that do not.
	 * Throws when the reply gives no steps to read, as when its JSON is broken, or when those that read do not stand as one arc.
	 */
	private readRoots(content:string):{ steps:Arc; unread:Rejected[] } {
		const { verbs } = this._ctx;
		try {
			return { steps: this.inIDs(parseArc(content, verbs)), unread: [] };
		}
		catch (err) {
			let raw:unknown;
			try {
				raw = extractJson(content);
			}
			catch {
				throw err;
			}
			if (!isRecord(raw) || !Array.isArray(raw.steps)) {
				throw err;
			}
			const steps:Arc = [];
			const unread:Rejected[] = [];
			for (const step of raw.steps) {
				try {
					steps.push(...parseArc(JSON.stringify({ steps: [step] }), verbs));
				}
				catch (bad) {
					unread.push({ steps: isRecord(step) && typeof step.verb === 'string' ? [{ verb: step.verb, args: {} }] : [], reason: bad instanceof Error ? bad.message : String(bad), at: bad instanceof ArcError ? bad.at : undefined, arg: bad instanceof ArcError ? bad.arg : undefined });
				}
			}
			// Read one by one, the steps that read are still one arc, checked as Arc text is (`follow` then more never runs).
			if (steps.length > 0) {
				validateArc(steps, verbs);
			}
			return { steps: this.inIDs(steps), unread };
		}
	}
}
