import type { ToolSpec } from '../mind/types.js';

/** One move out of a state: its name as the model writes it (`c3-e5`, `Barracks`), and the state it leads to. */
export type SearchMove<TState> = { name:string; next:TState };

/**
 * A game a mind can look ahead in: where it stands, the moves out of any state, and how good a state is. The game
 * computes; the model decides which of the best moves to play and why.
 */
export type SearchSpec<TCtx, TState> = {
	/** What the tool is for, said to the model (`Look ahead in the chess game`). */
	help:string;
	/**
	 * The state the caller is in, made of what it knows only: hidden things are the game's best guess, never the
	 * truth, so the search cannot see what its caller cannot.
	 */
	state:(ctx:TCtx)=>TState;
	/** Every move out of `state`. None: the game is over there. */
	moves:(state:TState)=>readonly SearchMove<TState>[];
	/** How good `state` is for `player`: -1 a sure loss, 0 even, 1 a sure win. Asked of the leaves the search reaches. */
	score:(state:TState, player:string)=>number;
	/** Who moves in `state`. Omit for a game with no opponent (a build order, a puzzle): the caller makes every move. */
	toMove?:(state:TState)=>string;
	/** Random moves played from a leaf before it is scored. Default 0: the leaf is scored as it is. */
	playout?:number;
	/** Most states the search visits. Default 2000. */
	iterations?:number;
	/** Most milliseconds the search runs, when sooner than `iterations`. */
	ms?:number;
	/** Best moves the tool answers with. Default 3. */
	top?:number;
};

/** One of the best moves, with what the search expects after it. */
export type SearchCandidate = {
	move:string;
	/** Its share of wins for the caller, 0 to 1. */
	win:number;
	visits:number;
	/** The moves expected after it, in turn, each with who makes it: `you`, `they`, or no one in a game without an opponent. */
	line:{ move:string; by?:'you' | 'they' }[];
	/** A reply to it nearly as likely as the line's first. */
	also?:string;
};

export type SearchResult = { candidates:SearchCandidate[]; opponent:boolean };

type Node<TState> = {
	state:TState;
	move:string;
	/** Who moves in this state. */
	mover:string;
	children?:Node<TState>[];
	visits:number;
	/** Sum of the root player's wins through here, 0 to 1 each. */
	value:number;
};

const ITERATIONS = 2000;
const TOP = 3;
/** Moves a line shows after its candidate, at most. */
const LINE_PLIES = 3;
/** The least visits a move in a line needs, as a share of its candidate's: below it the search is guessing. */
const LINE_SHARE = 0.1;
const LINE_VISITS = 4;
/** How close a second reply's win share must be to the first's to be named. */
const ALSO_GAP = 0.05;
const SOLO = 'you';

/** Mulberry32: the same moves played out each search, so a result can be made again. */
function seeded(seed:number):()=>number {
	let a = seed;
	return () => {
		a = (a + 0x6D2B79F5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Win share of `node` for whoever moved into it from `parent`. */
function winFor<TState>(node:Node<TState>, mover:string, root:string):number {
	const q = node.value / node.visits;
	return mover === root ? q : 1 - q;
}

/**
 * The best moves from `root`, by Monte Carlo tree search: each candidate with its win share and the line it expects
 * after it, cut where the search saw too little to say.
 */
export function search<TState>(root:TState, spec:Omit<SearchSpec<unknown, TState>, 'help' | 'state'>):SearchResult {
	const who = (state:TState):string => spec.toMove?.(state) ?? SOLO;
	const player = who(root);
	const random = seeded(1);
	const top:Node<TState> = { state: root, move: '', mover: player, visits: 0, value: 0 };
	const evaluate = (state:TState):number => {
		let at = state;
		for (let i = 0; i < (spec.playout ?? 0); i++) {
			const moves = spec.moves(at);
			if (moves.length === 0) {
				break;
			}
			at = moves[Math.floor(random() * moves.length)].next;
		}
		const score = Math.max(-1, Math.min(1, spec.score(at, player)));
		return (score + 1) / 2;
	};
	const deadline = spec.ms === undefined ? Infinity : Date.now() + spec.ms;
	const iterations = spec.iterations ?? ITERATIONS;
	for (let i = 0; i < iterations && (i % 64 !== 0 || Date.now() < deadline); i++) {
		const path = [top];
		let node = top;
		while (node.children && node.children.length > 0) {
			const parent = node;
			const fresh = parent.children!.find((child) => child.visits === 0);
			node = fresh ?? parent.children!.reduce((best, child) => {
				const ucb = (c:Node<TState>):number => winFor(c, parent.mover, player) + Math.SQRT2 * Math.sqrt(Math.log(parent.visits) / c.visits);
				return ucb(child) > ucb(best) ? child : best;
			});
			path.push(node);
			if (fresh) {
				break;
			}
		}
		if (!node.children && node.visits > 0 || node === top && !node.children) {
			node.children = spec.moves(node.state).map((m) => ({ state: m.next, move: m.name, mover: who(m.next), visits: 0, value: 0 }));
		}
		const value = evaluate(node.state);
		for (const step of path) {
			step.visits += 1;
			step.value += value;
		}
	}
	const opponent = spec.toMove !== undefined;
	const ranked = (top.children ?? []).filter((c) => c.visits > 0).sort((a, b) => b.visits - a.visits || b.value / b.visits - a.value / a.visits);
	return {
		opponent,
		candidates: ranked.slice(0, spec.top ?? TOP).map((first) => {
			const least = Math.max(LINE_VISITS, Math.ceil(first.visits * LINE_SHARE));
			const line:SearchCandidate['line'] = [];
			let also:string | undefined;
			let at = first;
			while (line.length < LINE_PLIES && at.children) {
				const replies = at.children.filter((c) => c.visits >= least).sort((a, b) => b.visits - a.visits);
				if (replies.length === 0) {
					break;
				}
				if (line.length === 0 && replies[1] && Math.abs(winFor(replies[0], at.mover, player) - winFor(replies[1], at.mover, player)) <= ALSO_GAP) {
					also = replies[1].move;
				}
				line.push({ move: replies[0].move, ...opponent ? { by: at.mover === player ? 'you' as const : 'they' as const } : {} });
				at = replies[0];
			}
			return { move: first.move, win: first.value / first.visits, visits: first.visits, line, ...also ? { also } : {} };
		}),
	};
}

/** `result` as the model reads it: one line a candidate, best first. */
export function searchText(result:SearchResult):string {
	if (result.candidates.length === 0) {
		return 'No moves from here.';
	}
	const label = result.opponent ? 'win' : 'score';
	return result.candidates.map((c, i) => {
		// The near-equal reply goes by the first one it could replace.
		const then = c.line.map((m, j) => `${m.by ? `${m.by} ${m.move}` : m.move}${j === 0 && c.also ? ` (or ${c.also})` : ''}`).join(', ');
		return `${i + 1}. ${c.move}: ${label} ${Math.round(c.win * 100)}%${then ? `. Then ${then}` : ''}.`;
	}).join('\n');
}

/** `spec` as a mind tool: no args; the answer is the best moves from where the caller stands. */
export function searchTool<TCtx, TState>(spec:SearchSpec<TCtx, TState>):ToolSpec<TCtx> {
	return {
		description: `${spec.help} Answers with the best moves from where you stand, how likely each is to win, and what is expected after it.`,
		parameters: { type: 'object', properties: {} },
		handler: (ctx) => searchText(search(spec.state(ctx), spec)),
	};
}
