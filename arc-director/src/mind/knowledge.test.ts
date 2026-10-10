import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	crowdKnowledge,
	knowledgePages,
	knowledgeFor,
	KNOW_CAP,
	articlesNamedIn,
	mentionedArticles,
	receivedArticles,
	type KnowledgeEntry,
} from './knowledge.js';

const TREE = crowdKnowledge({
	name: 'Tree',
	tag: 'tree',
	inside: ['forest', 'woods', 'grove'],
});

const PAGES:KnowledgeEntry[] = [
	TREE,
	{
		name: 'Cottage',
		aliases: ['house', 'home', 'cabin'],
		text: 'Building. go_to(Cottage) is still outside. Inside is through CottageDoor.',
	},
];

describe('crowdKnowledge', () => {
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

describe('knowledgeFor', () => {
	const know = (query:string):string => knowledgeFor(PAGES, query).join('\n\n');

	it('lists topics on an empty query', () => {
		assert.match(know(''), /Topics: Tree, Cottage/);
		assert.match(know('*'), /Recall one for more/);
		assert.deepEqual(knowledgeFor([], ''), [], 'nothing to know, nothing said');
	});

	it('maps leftover trees and a spoken forest to surrounded-by-Tree', () => {
		assert.match(know('trees'), /^Tree \(trees, forest, woods, grove\)/);
		assert.match(know('forest'), /surrounded/);
		assert.match(know('forest'), /all directions/);
		assert.equal(/wander\(until/.test(know('forest')), false);
	});

	it('maps house to Cottage', () => {
		assert.match(know('the house'), /Cottage/);
		assert.match(know('Cottage'), /CottageDoor/);
	});

	it('says so when nothing matches', () => {
		assert.match(know('dungeon'), /Nothing you know is called "dungeon"/);
		assert.match(know('dungeon'), /A plain word is not a name/);
	});

	it('returns at most KNOW_CAP articles', () => {
		const many = Array.from({ length: 5 }, (_, i) => ({ name: `Stall${i}`, text: 'sells bread' }));
		assert.equal(knowledgeFor(many, 'bread').length, KNOW_CAP);
	});
});

describe('receivedArticles', () => {
	it('names each article whose name or alias matches an id or tag, so a small model can tell what it is about', () => {
		const pages:KnowledgeEntry[] = [
			{ name: 'FireMushroom', aliases: ['mushroom'], text: 'Worth 10 gold.' },
			{ name: 'Tree', text: 'A tree.' },
		];
		assert.equal(receivedArticles(pages, [{ id: 'FireMushroom', tags: ['item'] }]), '- FireMushroom: Worth 10 gold.');
		assert.equal(receivedArticles(pages, [{ id: 'Stick', tags: ['item', 'mushroom'] }]), '- FireMushroom: Worth 10 gold.');
		assert.equal(receivedArticles(pages, [{ id: 'Stick', tags: ['item'] }]), '');
		assert.equal(receivedArticles([], [{ id: 'FireMushroom', tags: [] }]), '');
	});
});

describe('articlesNamedIn', () => {
	it('brings the article of every name the text mentions, never an alias', () => {
		const pages:KnowledgeEntry[] = [
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
		const pages:KnowledgeEntry[] = [
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

describe('knowledgePages', () => {
	it('resolves a callback with ctx', () => {
		assert.deepEqual(
			knowledgePages((ctx:{ n:string }) => [{ name: ctx.n, text: 'x' }], { n: 'Tree' }),
			[{ name: 'Tree', text: 'x' }],
		);
		assert.deepEqual(knowledgePages(() => PAGES, undefined), []);
	});
});
