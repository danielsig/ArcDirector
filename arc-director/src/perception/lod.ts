import type { LodLayer } from './types.js';

export function pascalCase(name:string):string {
	return name
		.split(/[\s_-]+/)
		.filter(Boolean)
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join('');
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
