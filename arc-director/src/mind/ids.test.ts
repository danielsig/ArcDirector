import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseArcText } from '../arc/parse.js';
import { firstStep, type Arc } from '../arc/types.js';
import { VerbRegistry, registerStockVerbs } from '../arc/stock-verbs.js';
import { registerStockCollectiveVerbs } from '../collective/verbs.js';
import { NameBook } from '../character/names.js';
import { idsOf, mapArc, mapExpr, namesOf } from './ids.js';

const verbs = registerStockCollectiveVerbs(registerStockVerbs(new VerbRegistry()));

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
		const say = stored.then!.arc.head;
		assert.equal(say.args.text, 'EnemyWitch2 is near');
		assert.equal(say.args.to, 'Ash');
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

	it('leaves remember tags and prose alone', () => {
		const reply:Arc = { head: { verb: 'remember', args: { content: 'EnemyWitch2 hides by the well', tags: ['EnemyWitch2'] } } };
		assert.deepEqual(mapArc(reply, verbs, idsOf(book())), reply);
	});
});
