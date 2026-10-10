import type { ArcResult } from '../arc/types.js';

/** How many of the latest step results and picks a record keeps. */
const KEPT = 12;

/**
 * How a runner's current program is going: its latest step results and `choose` picks, cleared when a new program
 * starts. A commander reads it before it reprograms a unit, so it fixes what fails instead of guessing.
 */
export class ArcRecord {
	private readonly _results:ArcResult[] = [];
	private readonly _picks:string[] = [];

	public get empty():boolean {
		return this._results.length === 0 && this._picks.length === 0;
	}

	public clear():void {
		this._results.length = 0;
		this._picks.length = 0;
	}

	public note(result:ArcResult):void {
		keep(this._results, result);
	}

	public picked(choice:string):void {
		keep(this._picks, choice);
	}

	/** `shoot 2 ok, 5 failed (no line of sight ×5); picked finish ×3, nearest ×4`, or `''` while empty. */
	public toString():string {
		const verbs = new Map<string, { ok:number; failed:number; why:Map<string, number> }>();
		for (const result of this._results) {
			const verb = result.verb ?? 'step';
			const row = verbs.get(verb) ?? { ok: 0, failed: 0, why: new Map() };
			verbs.set(verb, row);
			if (result.ok) {
				row.ok += 1;
				continue;
			}
			row.failed += 1;
			const why = result.reason ?? 'failed';
			row.why.set(why, (row.why.get(why) ?? 0) + 1);
		}
		const parts = [...verbs].map(([verb, { ok, failed, why }]) => {
			const reasons = [...why].map(([reason, n]) => (n > 1 ? `${reason} ×${n}` : reason)).join('; ');
			return `${verb} ${ok} ok${failed ? `, ${failed} failed (${reasons})` : ''}`;
		});
		if (this._picks.length > 0) {
			parts.push(`picked ${tally(this._picks)}`);
		}
		return parts.join(', ');
	}
}

function keep<T>(list:T[], item:T):void {
	list.push(item);
	if (list.length > KEPT) {
		list.shift();
	}
}

/** `finish ×3, nearest`: most picked first. */
function tally(names:string[]):string {
	const counts = new Map<string, number>();
	for (const name of names) {
		counts.set(name, (counts.get(name) ?? 0) + 1);
	}
	return [...counts].sort((a, b) => b[1] - a[1]).map(([name, n]) => (n > 1 ? `${name} ×${n}` : name)).join(', ');
}
