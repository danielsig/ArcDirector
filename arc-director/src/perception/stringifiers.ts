import { RESERVED_TAGS } from '../world/types.js';
import type { SeenObject, RelationshipHit, RelationshipStringifier, StringifyCtx } from './types.js';

function isBareToken(text:string):boolean {
	const body = text.replace(/^what seems to be /, '').trimStart();
	return body.startsWith('*') || /^[A-Z]/.test(body);
}

function indefinite(text:string):string {
	const body = text.replace(/^what seems to be /, '');
	if (/^(a|an|the|\*)\b/i.test(body) || isBareToken(text)) {
		return text;
	}
	const article = /^[aeiou]/i.test(body) ? 'an ' : 'a ';
	if (text.startsWith('what seems to be ')) {
		return `what seems to be ${article}${body}`;
	}
	return `${article}${text}`;
}

function attachPhrase(ground:string, figure:string, mode:SeenObject['attachMode']):string {
	switch (mode) {
		case 'worn':
			return `${ground} wearing ${figure}`;
		case 'held':
			return `${ground} holding ${figure}`;
		case 'in':
			return `${figure} in ${ground}`;
		default:
			return `${figure} on ${ground}`;
	}
}

/** `A`, `A and B`, `A, B and C`. */
function listed(names:string[]):string {
	return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0] ?? '';
}

/**
 * Everything attached to one ground the same way, as one phrase: `Forager and Angler on Bridge`, `Bread and Key in
 * Chest`, `Guard wearing Helmet and Cloak`. The ground is the one with the nearest figure; its note stays on it.
 */
export const attachmentStringifier:RelationshipStringifier = {
	id: 'attachment',
	tier: 90,
	stringify(objects, ctx) {
		const byID = new Map(objects.map((o) => [o.id, o]));
		let bestFigure:SeenObject | null = null;
		let bestGround:SeenObject | null = null;
		let bestSpan = Infinity;
		for (const fig of objects) {
			if (!fig.attachedTo) {
				continue;
			}
			const ground = byID.get(fig.attachedTo);
			if (!ground) {
				continue;
			}
			const span = ctx.distance(fig, ground);
			if (Number.isFinite(span) && span < bestSpan) {
				bestSpan = span;
				bestFigure = fig;
				bestGround = ground;
			}
		}
		if (!bestFigure || !bestGround) {
			return null;
		}
		const ground = bestGround;
		const mode = bestFigure.attachMode;
		const figures = objects.filter((o) => o.attachedTo === ground.id && o.attachMode === mode);
		const text = attachPhrase(ctx.noun(ground), listed(figures.map((o) => ctx.noun(o))), mode);
		const unused = objects.filter((o) => o !== ground && !figures.includes(o));
		return { text, unused, mode: 'reduce', reduceTo: { ...ground, label: text } };
	},
};

function pluralStem(word:string):string {
	if (word.length > 3 && /us$/i.test(word)) {
		return word.replace(/us$/i, (m) => m[0] === 'U' ? 'I' : 'i');
	}
	if (/[^aeiou]y$/i.test(word)) {
		return word.replace(/y$/i, (m) => m === 'Y' ? 'IES' : 'ies');
	}
	if (/(?:s|x|z|ch|sh)$/i.test(word)) {
		return `${word}es`;
	}
	return `${word}s`;
}

function possessiveMark(plural:string, mark:string):string {
	return /s$/i.test(plural) ? `${plural}${mark}` : `${plural}${mark}s`;
}

export function basicPluralize(word:string):string {
	if (/s['’]$/i.test(word)) {
		return word;
	}
	const poss = word.match(/['’]s$/i);
	if (poss) {
		return possessiveMark(pluralStem(word.slice(0, -2)), poss[0][0]);
	}
	return pluralStem(word);
}

export const tagCrowdStringifier:RelationshipStringifier = {
	id: 'tagCrowd',
	tier: 40,
	excludeTags: Object.values(RESERVED_TAGS),
	stringify(objects, ctx) {
		const counts = new Map<string, SeenObject[]>();
		for (const obj of objects) {
			for (const tag of obj.tags) {
				const list = counts.get(tag) ?? [];
				list.push(obj);
				counts.set(tag, list);
			}
		}
		let bestTag = '';
		let bestList:SeenObject[] = [];
		for (const [tag, list] of counts) {
			const unique = uniqueByID(list);
			if (unique.length < 3) {
				continue;
			}
			if (unique.length > bestList.length) {
				bestTag = tag;
				bestList = unique;
			}
		}
		if (bestList.length < 3) {
			return null;
		}
		const claimed = new Set(bestList.map((o) => o.id));
		const unused = objects.filter((o) => !claimed.has(o.id));
		return {
			text: ctx.pluralize(bestTag),
			unused,
			mode: 'utter',
		};
	},
};

function uniqueByID(list:SeenObject[]):SeenObject[] {
	const seen = new Set<string>();
	const out:SeenObject[] = [];
	for (const o of list) {
		if (seen.has(o.id)) {
			continue;
		}
		seen.add(o.id);
		out.push(o);
	}
	return out;
}

function pairPhrase(figure:string, ground:string):string {
	const fig = isBareToken(figure) ? figure : indefinite(figure);
	const grd = isBareToken(ground) ? ground : indefinite(ground);
	return `${fig} next to ${grd}`;
}

export const proximityPairStringifier:RelationshipStringifier = {
	id: 'proximityPair',
	tier: 10,
	stringify(objects, ctx) {
		if (ctx.clusterFactor <= 0 || objects.length < 2) {
			return null;
		}
		let bestA:SeenObject | null = null;
		let bestB:SeenObject | null = null;
		let bestD = ctx.clusterFactor;
		for (let i = 0; i < objects.length; i++) {
			for (let j = i + 1; j < objects.length; j++) {
				const a = objects[i];
				const b = objects[j];
				if (ctx.noun(a) === ctx.noun(b)) {
					continue;
				}
				const d = ctx.distance(a, b);
				if (Number.isFinite(d) && d <= bestD) {
					bestD = d;
					bestA = a;
					bestB = b;
				}
			}
		}
		if (!bestA || !bestB) {
			return null;
		}
		const { ground, figure } = ctx.groundAndFigure(bestA, bestB);
		const text = pairPhrase(ctx.noun(figure), ctx.noun(ground));
		const unused = objects.filter((o) => o !== bestA && o !== bestB);
		return { text, unused, mode: 'utter' };
	},
};

export function builtinStringifiers():RelationshipStringifier[] {
	return [attachmentStringifier, tagCrowdStringifier, proximityPairStringifier];
}

export function claimedOf(objects:SeenObject[], hit:RelationshipHit):SeenObject[] {
	const unused = new Set(hit.unused);
	return objects.filter((o) => !unused.has(o));
}
