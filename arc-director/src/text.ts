/** Whether `text` names `word` as a whole word: `Wool` in "2 Wool.", not in "Woolly". */
export function namesWord(text:string, word:string):boolean {
	return new RegExp(`(?<![A-Za-z0-9_])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_])`).test(text);
}

/** `iron gate`, `iron_gate` or `iron-gate` as `IronGate`. */
export function pascalCase(name:string):string {
	return name
		.split(/[\s_-]+/)
		.filter(Boolean)
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join('');
}
