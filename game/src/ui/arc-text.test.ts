import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { arcLines, rootVerbs, type ArcLine } from './arc-text.ts';

/** Each piece that is not blank, as `kind:text` (a bracket with its level), the thin spaces it may wrap at left out. */
function kinds(line:ArcLine):string[] {
	return line.pieces
		.filter((piece) => piece.text.trim())
		.map((piece) => `${piece.kind}${piece.level ?? ''}:${piece.text.replace(/​/g, '').trim()}`);
}

describe('arcLines', () => {
	it('tells every part of a line apart', () => {
		const line = 'if (!isHurt(me)) { let foe = others.minBy(u => u.hp); flee(foe, group=Vanguard, until=true, within=10s, step=-2) && say("go") } else { wait(1.5 - 1) }';
		assert.deepEqual(kinds(arcLines(line)[0]!), [
			'keyword:if', 'bracket0:(', 'op:!', 'fn:isHurt', 'bracket1:(', 'var:me', 'bracket1:)', 'bracket0:)', 'bracket0:{',
			'declare:let', 'var:foe', 'op:=', 'var:others', 'plain:.', 'fn:minBy', 'bracket1:(', 'var:u', 'op:=>', 'var:u', 'plain:.', 'var:hp', 'bracket1:)', 'mark:;',
			'verb:flee', 'bracket1:(', 'var:foe', 'plain:,', 'key:group=', 'name:Vanguard', 'plain:,', 'ending:until=', 'bool:true', 'plain:,',
			'ending:within=', 'duration:10s', 'plain:,', 'key:step=', 'number:-2', 'bracket1:)', 'mark:&&',
			'verb:say', 'bracket1:(', 'said:"go"', 'bracket1:)', 'bracket0:}',
			'keyword:else', 'bracket0:{', 'verb:wait', 'bracket1:(', 'number:1.5', 'op:-', 'number:1', 'bracket1:)', 'bracket0:}',
		]);
	});

	it('takes choose for a keyword and its labels for keys', () => {
		assert.deepEqual(kinds(arcLines('choose { fight: attack(Foe) }')[0]!).slice(0, 4), ['keyword:choose', 'bracket0:{', 'key:fight:', 'verb:attack']);
	});

	it('carries bracket depth from line to line, each closer in its opener\'s color', () => {
		const lines = arcLines('command(Knight) {\n\tloop {\n\t\tattack(Foe)\n\t}\n}');
		assert.deepEqual(lines.map((line) => line.pieces.flatMap((piece) => (piece.kind === 'bracket' ? [piece.level] : []))), [
			[0, 0, 0],
			[1],
			[2, 2],
			[1],
			[0],
		]);
	});

	it('marks a closer with no opener of its kind wrong, and leaves the opener open', () => {
		assert.deepEqual(kinds(arcLines('attack(Foe}')[0]!), ['verb:attack', 'bracket0:(', 'name:Foe', 'wrong:}']);
		assert.deepEqual(kinds(arcLines('wait(1)) {')[0]!).slice(-2), ['wrong:)', 'bracket0:{']);
	});

	it('marks a quote never closed wrong only once the Arc is settled', () => {
		const text = 'say("unclosed)';
		assert.deepEqual(kinds(arcLines(text)[0]!).at(-1), 'wrong:"unclosed)');
		assert.deepEqual(kinds(arcLines(text, text.length, text.length - 1)[0]!).filter((piece) => !piece.startsWith('rune')).at(-1), 'said:"unclosed');
		assert.deepEqual(kinds(arcLines(`${text}\nwait(1)`, text.length + 3, text.length + 2)[0]!).at(-1), 'wrong:"unclosed)');
	});

	it('marks the lines that open a block, so a slate can pin them', () => {
		const text = 'command(units) {\n\tloop {\n\t\tif (isHurt(me)) {\n\t\t\tflee(Foe)\n\t\t} else {\n\t\t\tattack(Foe)\n\t\t}\n\t}\n}\nsay(\n\t"hi"\n)';
		assert.deepEqual(arcLines(text).map((line) => line.opens), [true, true, true, false, true, false, false, false, false, true, false, false]);
	});

	it('leaves letters past settled as runes', () => {
		assert.deepEqual(arcLines('wait(1)', 7, 4, () => 'ᚠ')[0]!.pieces.map((piece) => piece.kind), ['var', 'rune', 'rune', 'rune']);
	});
});

describe('rootVerbs', () => {
	it('counts only the verbs in no bracket or block', () => {
		const text = 'command(units.filter("Knight")) {\n\tloop {\n\t\tattack(Foe)\n\t}\n}\ncommand(Archer) {\n\tsome(others)\n}';
		assert.deepEqual(rootVerbs(arcLines(text)), [['command', 2]]);
	});

	it('counts a root loop or choose, keywords that are steps', () => {
		const text = 'loop(until=isHurt(me)) {\n\tattack(Foe)\n}\nchoose {\n\tfight: attack(Foe)\n}\nloop {\n\tif (true) { wait(1) }\n}';
		assert.deepEqual(rootVerbs(arcLines(text)), [['loop', 2], ['choose', 1]]);
	});
});
