import type { LodLayer } from './perception-types.js';
import { pascalCase } from '../text.js';

/** What sight and talk put before a name: the far-off hedge, then an article. */
const DECORATION = /^(?:what seems to be\s+)?(?:(?:a|an|the)\s+)?/i;

/** `name` as the world knows it, without the words sight wraps it in (`what seems to be a Lantern` is `Lantern`). */
export function bareName(name:string):string {
	return name.trim().replace(DECORATION, '');
}

export function builtinLodLayers():LodLayer[] {
	return [
		{
			id: 'uncertain_far',
			when: (obj, ctx) => (obj.interesting ?? 0) > 0 && !obj.interactable && ctx.distance > ctx.farDistance,
			wrap: (text) => {
				if (text.startsWith('what seems to be ')) {
					return text;
				}
				return `what seems to be ${text}`;
			},
		},
		{
			id: 'interactable_case',
			when: (obj) => !!obj.interactable,
			wrap: (text, obj) => {
				const id = pascalCase(obj.id);
				if (text.includes(`*${id}*`)) {
					return text;
				}
				if (text.includes(obj.id) && obj.id !== id) {
					return text.replace(obj.id, id);
				}
				if (text.includes(id)) {
					return text;
				}
				return id;
			},
		},
		{
			id: 'unmovable_mark',
			when: (obj) => obj.movable === false,
			wrap: (text, obj) => {
				const id = pascalCase(obj.id);
				if (text.includes(`*${id}*`) || text.includes(`*${obj.id}*`)) {
					return text;
				}
				if (text.includes(id)) {
					return text.replace(id, `*${id}*`);
				}
				if (text.includes(obj.id)) {
					return text.replace(obj.id, `*${obj.id}*`);
				}
				return `*${text}*`;
			},
		},
	];
}
