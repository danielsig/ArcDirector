/** Whether `text` names `word` as a whole word: `Wool` in "2 Wool.", not in "Woolly". */
export function namesWord(text:string, word:string):boolean {
	return new RegExp(`(?<![A-Za-z0-9_])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_])`).test(text);
}
