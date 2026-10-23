import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { search, searchText, searchTool, type SearchMove } from './search.js';

/** Tic-tac-toe: nine cells `a1`…`c3`, X to move first. */
type Board = { cells:string[]; turn:'X' | 'O' };

const CELLS = ['a1', 'b1', 'c1', 'a2', 'b2', 'c2', 'a3', 'b3', 'c3'];
const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];

function board(rows:string, turn:'X' | 'O'):Board {
	return { cells: rows.replace(/\s/g, '').split('').map((c) => (c === '.' ? '' : c)), turn };
}

function winner(b:Board):string | undefined {
	return LINES.map((l) => l.map((i) => b.cells[i])).find(([p, q, r]) => p && p === q && q === r)?.[0];
}

const TIC_TAC_TOE = {
	toMove: (b:Board) => b.turn,
	moves: (b:Board):SearchMove<Board>[] => (winner(b) ? [] : b.cells.flatMap((c, i) => (c ? [] : [{
		name: CELLS[i],
		next: { cells: b.cells.map((d, j) => (j === i ? b.turn : d)), turn: b.turn === 'X' ? 'O' as const : 'X' as const },
	}]))),
	score: (b:Board, player:string) => {
		const w = winner(b);
		return w === undefined ? 0 : w === player ? 1 : -1;
	},
	playout: 9,
};

/** Nim: take 1 to 3 from the pile; who takes the last wins. Leaving a multiple of 4 wins. */
type Pile = { left:number; turn:'A' | 'B' };

const NIM = {
	toMove: (p:Pile) => p.turn,
	moves: (p:Pile):SearchMove<Pile>[] => [1, 2, 3].filter((n) => n <= p.left).map((n) => ({ name: `take ${n}`, next: { left: p.left - n, turn: p.turn === 'A' ? 'B' as const : 'A' as const } })),
	score: (p:Pile, player:string) => (p.left > 0 ? 0 : p.turn === player ? -1 : 1),
	playout: 20,
};

describe('search', () => {
	it('finds the winning move', () => {
		const result = search(board('XX. OO. ...', 'X'), TIC_TAC_TOE);
		assert.equal(result.candidates[0].move, 'c1');
		assert.ok(result.candidates[0].win > 0.9);
	});

	it('blocks a win it cannot beat', () => {
		const result = search(board('XX. O.. ...', 'O'), TIC_TAC_TOE);
		assert.equal(result.candidates[0].move, 'c1');
	});

	it('plays Nim by its rule: leave a multiple of 4', () => {
		for (const left of [5, 6, 7, 9, 10, 11]) {
			const result = search({ left, turn: 'A' }, { ...NIM, iterations: 3000 });
			assert.equal(result.candidates[0].move, `take ${left % 4}`, `pile ${left}`);
		}
	});

	it('expects a line that alternates you and they, cut where the search saw too little', () => {
		const result = search({ left: 9, turn: 'A' }, { ...NIM, iterations: 3000 });
		const [best] = result.candidates;
		assert.ok(best.line.length > 0 && best.line.length <= 3);
		assert.deepEqual(best.line.map((m) => m.by), ['they', 'you', 'they'].slice(0, best.line.length));
		assert.equal(result.opponent, true);
	});

	it('plans alone when nothing else moves: no you or they, a score not a win', () => {
		// Reach 10 from 0 by +1, +3 or ×2, in as few steps as can be.
		type Count = { at:number; steps:number };
		const result = search<Count>({ at: 0, steps: 0 }, {
			moves: (c) => (c.at >= 10 || c.steps >= 6 ? [] : [['+1', c.at + 1], ['+3', c.at + 3], ['x2', c.at * 2]].map(([name, at]) => ({ name: String(name), next: { at: Number(at), steps: c.steps + 1 } }))),
			score: (c) => (c.at === 10 ? 1 - c.steps / 10 : -1),
			iterations: 4000,
		});
		assert.equal(result.opponent, false);
		assert.equal(result.candidates[0].line.every((m) => m.by === undefined), true);
		assert.match(searchText(result), /^1\. \+3: score \d+%/);
	});

	it('gives the same answer each time', () => {
		const a = search({ left: 10, turn: 'A' }, NIM);
		const b = search({ left: 10, turn: 'A' }, NIM);
		assert.deepEqual(a, b);
	});

	it('answers the model in names and shares', () => {
		const text = searchText(search(board('XX. OO. ...', 'X'), TIC_TAC_TOE));
		assert.match(text, /^1\. c1: win \d+%/);
		assert.equal(text.split('\n').length <= 3, true);
		assert.equal(searchText({ candidates: [], opponent: true }), 'No moves from here.');
	});

	it('is a tool that searches from where its caller stands', () => {
		const tool = searchTool<{ id:string }, Board>({ help: 'Look ahead in tic-tac-toe.', state: () => board('XX. OO. ...', 'X'), ...TIC_TAC_TOE });
		assert.match(tool.description, /^Look ahead in tic-tac-toe\./);
		assert.match(String(tool.handler({ id: 'Ada' }, {})), /^1\. c1: win/);
	});
});
