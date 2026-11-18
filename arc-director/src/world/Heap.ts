/** A priority queue: `pop` gives the item that comes `before` all others. Searches keep their open nodes in one. */
export class Heap<T> {
	private readonly _items:T[] = [];
	private readonly _before:(a:T, b:T)=>boolean;

	constructor(before:(a:T, b:T)=>boolean) {
		this._before = before;
	}

	public get size():number {
		return this._items.length;
	}

	public push(item:T):void {
		const h = this._items;
		h.push(item);
		let i = h.length - 1;
		while (i > 0) {
			const up = (i - 1) >> 1;
			if (!this._before(h[i], h[up])) {
				break;
			}
			[h[up], h[i]] = [h[i], h[up]];
			i = up;
		}
	}

	public pop():T {
		const h = this._items;
		const top = h[0];
		const last = h.pop()!;
		if (h.length > 0) {
			h[0] = last;
			let i = 0;
			for (;;) {
				const l = i * 2 + 1;
				const r = l + 1;
				let first = i;
				if (l < h.length && this._before(h[l], h[first])) {
					first = l;
				}
				if (r < h.length && this._before(h[r], h[first])) {
					first = r;
				}
				if (first === i) {
					break;
				}
				[h[first], h[i]] = [h[i], h[first]];
				i = first;
			}
		}
		return top;
	}
}
