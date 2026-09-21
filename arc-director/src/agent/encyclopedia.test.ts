import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	crowdEncyclopedia,
	encyclopediaPages,
	grepEncyclopedia,
	type EncyclopediaEntry,
} from './encyclopedia.js';

const TREE = crowdEncyclopedia({
	name: 'Tree',
	tag: 'tree',
	inside: ['forest', 'woods', 'grove'],
});

const PAGES:EncyclopediaEntry[] = [
	TREE,
	{
		name: 'Cottage',
		aliases: ['house', 'home', 'cabin'],
		text: 'Building. go_to(Cottage) is still outside. Inside is through CottageDoor.',
	},
];

describe('crowdEncyclopedia', () => {
	it('stringifies a bunch of Tree into leftover trees in all directions', () => {
		assert.equal(TREE.name, 'Tree');
		assert.deepEqual(TREE.aliases, ['trees', 'forest', 'woods', 'grove']);
		assert.match(TREE.text, /Leftover sight for a bunch of Tree: trees/);
		assert.match(TREE.text, /never trees\.nearby\(\)/);
		assert.match(TREE.text, /Tree\.nearby\(\)/);
		assert.match(TREE.text, /Being surrounded by a bunch of Tree is being inside a forest/);
		assert.match(TREE.text, /all directions/);
		assert.match(TREE.text, /2 trees \d+ paces in front of you/);
		assert.match(TREE.text, /behind you/);
		assert.match(TREE.text, /to your left/);
		assert.match(TREE.text, /to your right/);
		assert.equal(TREE.text.includes('wander(until'), false);
		assert.equal(TREE.text.includes('some(Tree.nearby())'), false);
	});
});

describe('grepEncyclopedia', () => {
	it('lists names on an empty query', () => {
		assert.match(grepEncyclopedia(PAGES, ''), /Names: Tree, Cottage/);
		assert.match(grepEncyclopedia(PAGES, '*'), /Query one for the article/);
	});

	it('maps leftover trees and a spoken forest to surrounded-by-Tree', () => {
		assert.match(grepEncyclopedia(PAGES, 'trees'), /^Tree \(trees, forest, woods, grove\)/);
		assert.match(grepEncyclopedia(PAGES, 'forest'), /surrounded/);
		assert.match(grepEncyclopedia(PAGES, 'forest'), /all directions/);
		assert.equal(/wander\(until/.test(grepEncyclopedia(PAGES, 'forest')), false);
		assert.match(grepEncyclopedia(PAGES, 'dungeon'), /No encyclopedia match/);
	});

	it('maps house to Cottage', () => {
		assert.match(grepEncyclopedia(PAGES, 'the house'), /Cottage/);
		assert.match(grepEncyclopedia(PAGES, 'Cottage'), /CottageDoor/);
	});

	it('says so when nothing matches', () => {
		assert.match(grepEncyclopedia(PAGES, 'dungeon'), /No encyclopedia match for "dungeon"/);
		assert.match(grepEncyclopedia(PAGES, 'dungeon'), /Leftover English is not a name/);
	});
});

describe('encyclopediaPages', () => {
	it('resolves a callback with ctx', () => {
		assert.deepEqual(
			encyclopediaPages((ctx:{ n:string }) => [{ name: ctx.n, text: 'x' }], { n: 'Tree' }),
			[{ name: 'Tree', text: 'x' }],
		);
		assert.deepEqual(encyclopediaPages(() => PAGES, undefined), []);
	});
});
