import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseArcText } from '../arc/arc-parse.js';
import { firstStep, type Arc } from '../arc/arc-types.js';
import { VerbRegistry, STOCK_VERB_DEFS } from '../arc/stock-verbs.js';
import { STOCK_COLLECTIVE_VERB_DEFS } from '../collective/collective-verbs.js';
import { NameBook } from '../character/NameBook.js';
import { idsOf, mapArc, mapExpr, namesOf } from './ids.js';

const verbs = new VerbRegistry().addAll(STOCK_VERB_DEFS).addAll(STOCK_COLLECTIVE_VERB_DEFS);

/** Ash is `EnemyWitch`, Nyx is `EnemyWitch2`. */
function book():NameBook {
	const names = new NameBook();
	names.name('Ash', 'EnemyWitch');
	names.name('Nyx', 'EnemyWitch');
	return names;
}

describe('mind ids', () => {
	it('turns a reply into ids and back into the same names', () => {
		const names = book();
		const reply = parseArcText(
			'law(who=units.filter("Archer"), watch=isNear(me, EnemyWitch2), arc=go_to(EnemyWitch2), name=EnemyWitch2.flee) ; say(text="EnemyWitch2 is near", to=EnemyWitch)',
			verbs,
		);
		const stored = mapArc(reply, verbs, idsOf(names));
		const law = firstStep(stored)!;
		assert.equal(law.args.watch, 'isNear(me, Nyx)');
		assert.equal(firstStep(law.args.arc as never)?.args.target, 'Nyx');
		assert.equal(law.args.name, 'Nyx.flee');
		assert.equal(law.args.who, 'units.filter("Archer")');
		const say = stored[1];
		assert.equal(say.args.text, 'EnemyWitch2 is near');
		assert.equal(say.args.to, 'Ash');
		assert.deepEqual(mapArc(stored, verbs, namesOf(names)), reply);
	});

	it('reads a *starred* name in an id arg as the name', () => {
		const names = book();
		const reply = parseArcText('go_to(target=*SealedDoor*) && say(text="*Hi*", to=*EnemyWitch2*)', verbs);
		const stored = mapArc(reply, verbs, idsOf(names));
		assert.equal(stored[0].args.target, 'SealedDoor');
		assert.equal(stored[1].args.to, 'Nyx');
		assert.equal(stored[1].args.text, '*Hi*');
	});

	it('keeps a group expression in a verb\'s id arg, names rewritten, both ways', () => {
		const names = book();
		for (const to of ['units', 'allUnits', 'units.filter("Archer")', 'others.nearby()']) {
			const reply = parseArcText(`say(text="Hold fast", to=${to})`, verbs);
			assert.equal(reply[0].args.to, to);
			assert.deepEqual(mapArc(mapArc(reply, verbs, idsOf(names)), verbs, namesOf(names)), reply);
		}
		const reply = parseArcText('say(text="Hold fast", to=others.filter(u => u != EnemyWitch2))', verbs);
		const stored = mapArc(reply, verbs, idsOf(names));
		assert.equal(stored[0].args.to, 'others.filter(u => u != Nyx)');
		assert.deepEqual(mapArc(stored, verbs, namesOf(names)), reply);
	});

	it('rewrites names and string literals, never member names or tags', () => {
		const names = book();
		assert.equal(
			mapExpr('others.filter("EnemyWitch2").some(u => u.EnemyWitch2 > 1) && isNear(me, EnemyWitch)', idsOf(names)),
			'others.filter("Nyx").some(u => u.EnemyWitch2 > 1) && isNear(me, Ash)',
		);
		assert.equal(mapExpr('units.filter(\'Archer\')', idsOf(names)), 'units.filter(\'Archer\')');
		assert.equal(mapExpr('isNear(me, Nyx', namesOf(names)), 'isNear(me, EnemyWitch2');
	});

	it('writes an id that is no identifier as a string', () => {
		const names = new NameBook();
		names.name('Old Tom', 'Tom');
		assert.equal(mapExpr('isNear(me, Tom)', idsOf(names)), 'isNear(me, "Old Tom")');
		assert.equal(mapExpr('isNear(me, "Old Tom")', namesOf(names)), 'isNear(me, "Tom")');
	});

	it('labels the vague by kind and letters, A to Z then AA, for arcs only, until made out', () => {
		const names = book();
		const labels = Array.from({ length: 28 }, (unused, n) => names.vague(`Stranger${n}`, 'Figure'));
		assert.deepEqual([labels[0], labels[25], labels[26], labels[27]], ['FigureA', 'FigureZ', 'FigureAA', 'FigureAB']);
		assert.equal(names.vague('Stranger0', 'Figure'), 'FigureA', 'the same while it stays vague');
		names.vague('Ash', 'Figure');
		assert.equal(mapExpr('isNear(me, FigureAC)', idsOf(names)), 'isNear(me, Ash)');
		assert.equal(mapExpr('isNear(me, Ash)', namesOf(names)), 'isNear(me, FigureAC)', 'an arc shows its label, never its name');
		assert.equal(namesOf(names, false)('Ash'), 'EnemyWitch', 'what it knows of Ash keeps its name');
		assert.equal(idsOf(names, false)('FigureAC'), 'FigureAC', 'and never learns who the label is');
		const saved = new NameBook();
		saved.load(JSON.parse(JSON.stringify(names)));
		assert.equal(saved.peek('Ash'), 'FigureAC');
		names.name('Ash', 'EnemyWitch', { seen: true });
		assert.equal(names.peek('Ash'), 'EnemyWitch');
		assert.equal(names.resolve('FigureAC'), 'FigureAC', 'made out, its label names no one');
		assert.equal(names.vague('Nyx', 'Figure'), 'FigureAC', 'and its letters are free again');
	});

	it('leaves remember tags and prose alone', () => {
		const reply:Arc = [{ verb: 'remember', args: { content: 'EnemyWitch2 hides by the well', tags: ['EnemyWitch2'] } }];
		assert.deepEqual(mapArc(reply, verbs, idsOf(book())), reply);
	});
});
