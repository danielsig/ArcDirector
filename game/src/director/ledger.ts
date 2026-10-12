import { pascalCase } from 'arc-director';
import type { GameHost } from './adapter';

/** "1 Loaf", "3 Scarf". The count is always written, so a later recall can tell one from many. */
export function ledgerQty(count:number, name:string):string {
	const label = pascalCase(name) || name;
	const n = Math.max(1, Math.floor(count));
	return `${n} ${label}`;
}

/** One trade, gift, or payment, remembered by every mind. Recall is how they read this ledger. */
export function noteLedger(host:GameHost, text:string, who:string[], tags:string[], major = false):void {
	host.arc?.pushEvent({
		kind: 'Ledger',
		text,
		who,
		tags: ['ledger', ...tags],
		remember: true,
		major,
	});
}
