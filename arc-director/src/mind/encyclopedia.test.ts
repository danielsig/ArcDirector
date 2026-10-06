import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	crowdEncyclopedia,
	encyclopediaPages,
	grepEncyclopedia,
	articlesNamedIn,
	mentionedArticles,
	receivedArticles,
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

describe('receivedArticles', () => {
	it('returns the text when a name or alias matches an id or tag', () => {
		const pages:EncyclopediaEntry[] = [
			{ name: 'FireMushroom', aliases: ['mushroom'], text: 'Worth 10 gold.' },
			{ name: 'Tree', text: 'A tree.' },
		];
		assert.equal(receivedArticles(pages, [{ id: 'FireMushroom', tags: ['item'] }]), 'Worth 10 gold.');
		assert.equal(receivedArticles(pages, [{ id: 'Stick', tags: ['item', 'mushroom'] }]), 'Worth 10 gold.');
		assert.equal(receivedArticles(pages, [{ id: 'Stick', tags: ['item'] }]), '');
		assert.equal(receivedArticles([], [{ id: 'FireMushroom', tags: [] }]), '');
	});
});

describe('articlesNamedIn', () => {
	it('brings the article of every name the text mentions, never an alias', () => {
		const pages:EncyclopediaEntry[] = [
			{ name: 'Bridge', aliases: ['raised'], text: 'BridgeKeeper lowers it.' },
			{ name: 'BridgeLever', text: 'Works the bridge.' },
			{ name: 'Angler', text: 'Sells fish.' },
		];
		assert.equal(
			articlesNamedIn(pages, 'no way to Angler: Bridge is raised — it must be lowered first'),
			'Bridge: BridgeKeeper lowers it.\nAngler: Sells fish.',
		);
		assert.equal(articlesNamedIn(pages, 'the bridge is raised'), '');
	});
});

describe('mentionedArticles', () => {
	it('matches names and alias phrases as whole words, most mentions first, up to the cap', () => {
		const pages:EncyclopediaEntry[] = [
			{ name: 'SilverTrout', aliases: ['fish', '5 gold'], text: 'Worth 5 gold.' },
			{ name: 'FireMushroom', aliases: ['mushrooms', '10 gold'], text: 'Worth 10 gold.' },
			{ name: 'Bridge', text: 'BridgeKeeper lowers it.' },
		];
		const said = 'BridgeKeeper says: "10 gold or items of equal value." You said: "I pick mushrooms and want fish."';
		assert.deepEqual(mentionedArticles(pages, said, 2).map((e) => e.name), ['FireMushroom', 'SilverTrout']);
		assert.deepEqual(mentionedArticles(pages, said, 0), []);
		assert.deepEqual(mentionedArticles(pages, 'fishing for 110 gold', 3), []);
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
