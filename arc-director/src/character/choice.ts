import { evaluate } from '../expr/eval.js';
import { entityName, type Catalog, type ExprEntity } from '../expr/types.js';
import { argBase, type VerbRegistry } from '../arc/stock-verbs.js';
import { formatArc } from '../arc/parse.js';
import { eachStep, firstStep, isArc, isCountMap, verbsInside, type Arc, type Step } from '../arc/types.js';
import type { LastChoice } from '../arc/run.js';

/** What a System One model reads before it picks: who is choosing, what it is doing, and who is nearest. */
export type ChoiceStateInput = {
	id:string;
	/** The verb running before this `choose`, or `''`. */
	verb:string;
	last?:LastChoice;
	catalog?:Catalog;
	/** The characters, things and places the choices name: the nearest body gets its own line only if not one. */
	names:string[];
};

export type ChoicePromptInput = Omit<ChoiceStateInput, 'names'> & {
	choices:Record<string, Arc>;
	verbs:VerbRegistry;
};

/** What a System One is asked: the {@link choiceState} and each shown choice's arc beside whom it is about. */
export type ChoicePrompt = { state:string; criteria:Record<string, string> };

/**
 * The System One question for `choices`, exactly as the director asks it. Each choice reads as whom it is about now
 * ({@link withTargets}), with their health and distance beside it ({@link targetNotes}). A choice whose target
 * expression picks no one, or whose first verb is cooling down ({@link isReady}), is left out, and one that would do the same as an earlier choice is folded into it.
 * Undefined when no choice can run now.
 */
export function choicePrompt({ choices, verbs, ...input }:ChoicePromptInput):ChoicePrompt | undefined {
	const { catalog } = input;
	const all = Object.entries(choices);
	const able = all.flatMap(([name, arc]):[string, Arc][] => {
		const aimed = catalog ? isReady(arc, catalog) && withTargets(arc, verbs, catalog) : arc;
		return aimed ? [[name, aimed]] : [];
	});
	if (catalog && able.length === 0) {
		return undefined;
	}
	const doing = new Set<string>();
	const shown = (able.length > 0 ? able : all).filter(([, arc]) => {
		const text = formatArc(arc, verbs);
		return !doing.has(text) && !!doing.add(text);
	});
	const arcs = shown.map(([, arc]) => arc);
	const notes = catalog ? targetNotes(arcs, verbs, catalog) : [];
	return {
		state: choiceState({ ...input, names: namesIn(arcs, verbs) }),
		criteria: Object.fromEntries(shown.map(([name, arc], i) => [name, `${formatArc(arc, verbs)}${notes[i] ? ` — ${notes[i]}` : ''}`])),
	};
}

/**
 * A few short lines, not a sight paragraph: the runner's own health, what it is doing, how its last choice went,
 * and the nearest other body when no choice names it. What each choice is about rides on that choice
 * ({@link targetNotes}), so a fast model reads a target's hp beside the choice that hits it.
 */
export function choiceState({ id, verb, last, catalog, names }:ChoiceStateInput):string {
	const health = catalog ? healthOf(catalog.me) : '';
	const lines = [`You are ${id}${health ? `, ${health}` : ''}.`];
	if (verb) {
		lines.push(`Doing: ${verb}.`);
	}
	if (last) {
		const how = last.result.ok ? 'ok' : last.result.interrupted ? 'interrupted' : 'failed';
		lines.push(`Last choice: ${last.name}, ${how}${last.result.reason ? ` (${last.result.reason})` : ''}.`);
	}
	const nearest = catalog && nearestOf('others', catalog);
	if (catalog && nearest && !names.includes(entityName(nearest))) {
		const place = placeOf(nearest, catalog);
		lines.push(`Nearest: ${entityName(nearest)}, ${place ? describe(place) : 'not here'}.`);
	}
	return lines.join('\n');
}

/**
 * Whom each of `arcs` is about now, one note per arc: `EnemyHealer 2/12 hp (lowest), 8 away, ahead`, `HealingPotion
 * carried`, or `Keep not in sight`. Among all the arcs' targets the lowest hp (as a share of max hp, so a full
 * healer never reads lowest beside a full knight) and the nearest are marked, so a small model that matches words
 * instead of comparing numbers still reads which is which. Everyone is called what the runner's mind calls them.
 * `''` for an arc that names no one.
 */
export function targetNotes(arcs:Arc[], verbs:VerbRegistry, catalog:Catalog):string[] {
	const self = entityName(catalog.me);
	const named = arcs.map((arc) => namesIn([arc], verbs).filter((name) => name !== self));
	const places = new Map([...new Set(named.flat())].map((name) => [name, placeOf(nearestOf(name, catalog), catalog)]));
	const found = [...places.values()].filter((place) => place !== undefined);
	const lowest = loneMin(found, (place) => place.hp && place.hp[0] / place.hp[1]);
	const nearest = loneMin(found, (place) => place.distance);
	return named.map((names) => names.map((name) => {
		const place = places.get(name);
		return `${name} ${place ? describe(place, place === lowest, place === nearest) : unseen(name, catalog)}`;
	}).join('; '));
}

/**
 * `arc` with each `id` arg written as an expression (`others.filter("enemy").minBy(u => u.hp)`) replaced by the
 * one it picks now, under the runner's name for them, so a System One reads whom each choice is about. Undefined
 * when its first step's expression picks no one: that choice cannot run now. A later step's stays as written.
 */
export function withTargets(arc:Arc, verbs:VerbRegistry, catalog:Catalog, first = true):Arc | undefined {
	const aimed:Arc = [];
	for (const [i, step] of arc.entries()) {
		const next = aimStep(step, verbs, catalog, first && i === 0);
		if (!next) {
			return undefined;
		}
		aimed.push(next);
	}
	return aimed;
}

function aimStep(step:Step, verbs:VerbRegistry, catalog:Catalog, first:boolean):Step | undefined {
	const kinds = verbs.get(step.verb)?.args ?? {};
	const args = { ...step.args };
	for (const [key, value] of Object.entries(args)) {
		if (isArc(value)) {
			const inner = withTargets(value, verbsInside(step, verbs), catalog, first);
			if (!inner) {
				return undefined;
			}
			args[key] = inner;
		}
		else if (argBase(kinds[key]) === 'id' && typeof value === 'string' && /[(.]/.test(value)) {
			const target = nearestOf(value, catalog);
			if (!target && first) {
				return undefined;
			}
			args[key] = target ? entityName(target) : value;
		}
	}
	return { ...step, args };
}

/** Whether `arc`'s first verb is off cooldown by the host's `isReady`; ready when the host tracks none. */
function isReady(arc:Arc, catalog:Catalog):boolean {
	const verb = firstStep(arc)?.verb;
	if (!verb || !catalog.fns.has('isReady')) {
		return true;
	}
	const r = evaluate(`isReady(me, ${JSON.stringify(verb)})`, catalog);
	return r.error !== undefined || r.value.kind !== 'bool' || r.value.value;
}

/** Every `id` arg in `arcs`, nested arcs too, in the order written. */
export function namesIn(arcs:Arc[], verbs:VerbRegistry):string[] {
	const out = new Set<string>();
	for (const arc of arcs) {
		eachStep(arc, verbs, (step, registry) => {
			const kinds = registry.get(step.verb)?.args ?? {};
			for (const [key, value] of Object.entries(step.args)) {
				if (argBase(kinds[key]) === 'id' && typeof value === 'string' && /^[A-Za-z_]\w*$/.test(value)) {
					out.add(value);
				}
				if (argBase(kinds[key]) === 'bundle' && isCountMap(value)) {
					for (const name of Object.keys(value)) {
						out.add(name);
					}
				}
			}
		});
	}
	return [...out];
}

/** The one `expr` names, or the nearest of the many it names (`Faye`, `others`). */
function nearestOf(expr:string, catalog:Catalog):ExprEntity | undefined {
	const r = evaluate(expr, catalog);
	if (r.error) {
		return undefined;
	}
	if (r.value.kind === 'entity') {
		return r.value.value;
	}
	const nearest = r.value.kind === 'list' ? evaluate(`${expr}.minBy(o => distance(me, o))`, catalog) : undefined;
	return nearest && !nearest.error && nearest.value.kind === 'entity' ? nearest.value.value : undefined;
}

/** `carried` when the runner carries `name`, else `not in sight`: an item for sale or a far place is not "not here". */
function unseen(name:string, catalog:Catalog):string {
	const r = evaluate(`isCarrying("${name}")`, catalog);
	return !r.error && r.value.kind === 'bool' && r.value.value ? 'carried' : 'not in sight';
}

/** Where `entity` is from the runner, and its health when the host reports it; undefined when not here. */
function placeOf(entity:ExprEntity | undefined, catalog:Catalog):Place | undefined {
	if (!entity) {
		return undefined;
	}
	const names = new Map(catalog.names).set('it', { kind: 'entity', value: entity });
	const at:Catalog = { ...catalog, names };
	const distance = evaluate('distance(me, it)', at);
	if (distance.error || distance.value.kind !== 'number') {
		return undefined;
	}
	const holds = (expr:string):boolean => {
		const r = evaluate(expr, at);
		return !r.error && r.value.kind === 'bool' && r.value.value;
	};
	const side = holds('isBehind(me, it)') ? 'behind' : holds('isLeft(me, it)') ? 'left' : holds('isRight(me, it)') ? 'right' : 'ahead';
	return { distance: distance.value.value, side, hp: hpOf(entity) };
}

type Place = { distance:number; side:string; hp?:[number, number] };

/** `9/12 hp, 4 away, left`, with `(lowest)` after the hp and `(nearest)` after the distance when marked. */
function describe(place:Place, lowest = false, nearest = false):string {
	const health = place.hp ? `${healthText(place.hp, lowest ? ['lowest'] : [])}, ` : '';
	return `${health}${Math.round(place.distance)} away${nearest ? ' (nearest)' : ''}, ${place.side}`;
}

/**
 * `3/12 hp (badly hurt, lowest)`: the numbers with what they mean, since a model that scores one token does not
 * read `3/28` as nearly dead. Badly hurt is a third or less.
 */
function healthText([hp, maxHP]:[number, number], marks:string[] = []):string {
	const all = [...(hp <= maxHP / 3 ? ['badly hurt'] : []), ...marks];
	return `${hp}/${maxHP} hp${all.length > 0 ? ` (${all.join(', ')})` : ''}`;
}

/** The one with the lowest `value` among two or more, or undefined on a tie or when fewer have one. */
function loneMin<T>(items:T[], value:(item:T)=>number | undefined):T | undefined {
	const scored = items.flatMap((item) => {
		const v = value(item);
		return v === undefined ? [] : [{ item, v }];
	}).sort((a, b) => a.v - b.v);
	return scored.length >= 2 && scored[0].v < scored[1].v ? scored[0].item : undefined;
}

/** `[hp, maxHP]`, or undefined when the host reports none. */
function hpOf(entity:ExprEntity):[number, number] | undefined {
	const hp = entity.fields?.hp;
	const maxHP = entity.fields?.maxHP;
	return hp?.kind === 'number' && maxHP?.kind === 'number' ? [hp.value, maxHP.value] : undefined;
}

/** `9/12 hp`, or `''` when the host reports none. */
function healthOf(entity:ExprEntity):string {
	const hp = hpOf(entity);
	return hp ? healthText(hp) : '';
}
