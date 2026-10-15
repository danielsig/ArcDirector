import type { HostWorld, Outcome, Transfer } from './types.js';

/**
 * The deal a move is part of, as `validateTransfer` sees it from that move. The world, this move and `pending` add
 * up to the deal done, so a rule on what someone ends up with counts `receiving` and `leaving` and never counts a move
 * twice.
 */
export class Deal<TEntity> {
	private readonly _moves:readonly Transfer<TEntity>[];
	private readonly _at:number;
	private readonly _dryRun:boolean;
	private _pending:readonly Transfer<TEntity>[] | undefined;
	private readonly _leaving = new Map<TEntity, readonly Transfer<TEntity>[]>();
	private readonly _receiving = new Map<TEntity, readonly Transfer<TEntity>[]>();

	/** `moves[at]` is the move being checked. */
	constructor(moves:readonly Transfer<TEntity>[], at:number, dryRun:boolean) {
		this._moves = moves;
		this._at = at;
		this._dryRun = dryRun;
	}

	/** Only a check: nothing in this deal will move now, as when an offer is posted. `transfer` is not called. */
	public get dryRun():boolean {
		return this._dryRun;
	}

	/** The other moves the world does not hold yet: those after this one, or in a dry run all of them. */
	public get pending():readonly Transfer<TEntity>[] {
		this._pending ??= this._dryRun
			? this._moves.filter((_, i) => i !== this._at)
			: this._moves.slice(this._at + 1);
		return this._pending;
	}

	/** The moves already made, which the world holds now. None in a dry run. */
	public get done():readonly Transfer<TEntity>[] {
		return this._dryRun ? [] : this._moves.slice(0, this._at);
	}

	/** What `holder` still hands away in this deal. */
	public leaving(holder:TEntity):readonly Transfer<TEntity>[] {
		return cached(this._leaving, holder, () => this.pending.filter((move) => move.from === holder));
	}

	/** What `holder` still receives in this deal. */
	public receiving(holder:TEntity):readonly Transfer<TEntity>[] {
		return cached(this._receiving, holder, () => this.pending.filter((move) => move.to === holder));
	}
}

function cached<K, V>(map:Map<K, V>, key:K, make:()=>V):V {
	let value = map.get(key);
	if (value === undefined) {
		value = make();
		map.set(key, value);
	}
	return value;
}

/** Why `moves` could not happen as they stand, or nothing: each one checked against the world now, moving none. */
export function checkDeal<TEntity>(world:HostWorld<TEntity>, moves:readonly Transfer<TEntity>[]):string | undefined {
	for (let i = 0; i < moves.length; i++) {
		const reason = world.validateTransfer?.(moves[i], new Deal(moves, i, true));
		if (reason) {
			return reason;
		}
	}
	return undefined;
}

/**
 * `moves`, whole or not at all: each is checked and then made, so it is checked against the world the moves before
 * it left. A refusal or an error takes back every move made, last first; an error is thrown on after that.
 */
export function settleDeal<TEntity>(world:HostWorld<TEntity>, moves:readonly Transfer<TEntity>[]):Outcome {
	const undo:Array<()=>void> = [];
	const rollBack = ():void => {
		for (const step of undo.reverse()) {
			step();
		}
	};
	try {
		for (let i = 0; i < moves.length; i++) {
			const reason = world.validateTransfer?.(moves[i], new Deal(moves, i, false));
			if (reason) {
				rollBack();
				return { ok: false, reason };
			}
			undo.push(world.transfer!(moves[i]));
		}
	}
	catch (err) {
		rollBack();
		throw err;
	}
	return { ok: true };
}
