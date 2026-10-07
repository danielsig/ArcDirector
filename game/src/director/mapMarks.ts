import { DEFAULT_YOU_SYMBOL } from 'arc-director';

/** Pictograms for NPC `see_map` stamps. Letters are too similar on a tiny map. */

/** Self mark. Must match `map.you` on the mind. */
export const YOU_SYMBOL = DEFAULT_YOU_SYMBOL;

const NAMED:Record<string, string> = {
	you: YOU_SYMBOL,
	Forager: '🌿',
	BridgeKeeper: '🚧',
	Angler: '🎣',
	Assistant: '🎒',
	Fern: '🌱',
	Sable: '⚗️',
	Lys: '🛡️',
	Baker: '🍞',
	Weaver: '🧵',
	Potter: '🏺',
	Cutler: '🔪',
	Mira: '🎀',
	Tomas: '🧢',
	Nell: '🍎',
	Rook: '🐦',
	Holt: '⚔️',
	Pike: '🪖',
	Brant: '🪵',
	Cass: '🕯️',
};

const KIND:[RegExp, string][] = [
	[/door/i, '🚪'],
	[/chest/i, '🧰'],
	[/bridge/i, '🌉'],
	[/lever/i, '🎚️'],
	[/hearth/i, '🔥'],
	[/gate/i, '⛩️'],
	[/cot/i, '🛏️'],
	[/mushroom/i, '🍄'],
];

const SPARE = [
	'🦊',
	'🐸',
	'🦉',
	'🐺',
	'🐻',
	'🐱',
	'🐰',
	'🐷',
	'🐮',
	'🐵',
	'🐼',
	'🐯',
	'🦁',
	'🐨',
	'🐔',
];

export function markSymbol(label:string):string {
	const named = NAMED[label];
	if (named) {
		return named;
	}
	for (const [re, emoji] of KIND) {
		if (re.test(label)) {
			return emoji;
		}
	}
	let h = 0;
	for (let i = 0; i < label.length; i++) {
		h = (h * 33 + label.charCodeAt(i)) | 0;
	}
	const i = Math.abs(h) % SPARE.length;
	return SPARE[i] ?? '❓';
}
