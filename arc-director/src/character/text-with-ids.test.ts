import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { displayName, idsIn, listIDs, namedText, namingText, parseTextWithIDs, showNamingText, showTextWithIDs, textSegments, type NamingText } from './text-with-ids.js';
import { keptText, MemoryPool } from '../memory/store.js';
import { NameBook } from './NameBook.js';

/** Two minds that name Helms and Ash each their own way. */
function books():{ ada:NameBook; bo:NameBook } {
	const ada = new NameBook();
	ada.name('Helms', 'OldKnight', { character: true });
	ada.name('Ash', 'EnemyWitch', { character: true });
	const bo = new NameBook();
	bo.name('Helms', 'EnemyKnight', { character: true });
	bo.name('Ash', 'Ash', { seen: true, character: true });
	return { ada, bo };
}

describe('TextWithIDs', () => {
	it('keeps one mind\'s words by id and shows them in another\'s names', () => {
		const { ada, bo } = books();
		const kept = parseTextWithIDs('OldKnight told EnemyWitch to hold the gate.', (word) => ada.idOf(word));
		assert.deepEqual(kept, ['', 'Helms', ' told ', 'Ash', ' to hold the gate.']);
		assert.deepEqual(idsIn(kept), ['Helms', 'Ash']);
		assert.equal(showTextWithIDs(kept, (id) => bo.peek(id) ?? id), 'EnemyKnight told Ash to hold the gate.');
		assert.equal(showTextWithIDs(kept, (id) => ada.peek(id) ?? id), 'OldKnight told EnemyWitch to hold the gate.');
		assert.equal(showTextWithIDs(kept), 'Helms told Ash to hold the gate.', 'searched by id');
	});

	it('keeps a verb\'s reason by the ids it names, shown in each mind\'s own names, with nothing read back', () => {
		const { ada, bo } = books();
		// "EnemyWitch" is plain text here: only what `name` is called with is anyone.
		const reason:NamingText = (name) => `${name('Helms')} blocked ${name('Ash')}, the EnemyWitch`;
		const kept = namedText(reason);
		assert.deepEqual(kept, ['', 'Helms', ' blocked ', 'Ash', ', the EnemyWitch']);
		assert.equal(showNamingText(reason, (id) => ada.peek(id) ?? id), 'OldKnight blocked EnemyWitch, the EnemyWitch');
		assert.equal(showNamingText(reason, (id) => bo.peek(id) ?? id), 'EnemyKnight blocked Ash, the EnemyWitch');
		assert.equal(showNamingText(reason), 'Helms blocked Ash, the EnemyWitch', 'a host reads ids');
		assert.deepEqual(namedText(namingText(kept)), kept, 'handed on as a host\'s text, it keeps its ids');
		const pool = new MemoryPool();
		const memory = pool.view('');
		const record = memory.add({ text: reason });
		assert.equal(record.text, 'Helms blocked Ash, the EnemyWitch');
		assert.deepEqual(record.segments(), [{ text: 'Helms', id: 'Helms' }, { text: ' blocked ' }, { text: 'Ash', id: 'Ash' }, { text: ', the EnemyWitch' }]);
		assert.deepEqual(keptText({ ...record }), kept, 'a copy keeps the ids');
		assert.deepEqual(MemoryPool.fromJSON(JSON.parse(JSON.stringify(pool.toJSON()))).view('').all()[0].segments(), record.segments(), 'a save keeps the ids');
	});

	it('leaves a word that is an id but no name it gave as a word', () => {
		const { ada } = books();
		assert.deepEqual(parseTextWithIDs('Helms gate', (word) => ada.idOf(word)), ['Helms gate']);
		ada.vague('Bo', 'Figure', true);
		assert.deepEqual(parseTextWithIDs('FigureA waits', (word) => ada.idOf(word)), ['FigureA waits'], 'a vague label is never who it is');
	});

	it('builds lines from a host\'s text, lists and pieces', () => {
		assert.deepEqual(namedText((name) => `${name('Ann')} gave {2} to ${name('Bo')}`), ['', 'Ann', ' gave {2} to ', 'Bo', '']);
		assert.deepEqual(listIDs(['Ann', 'Bo']), ['', 'Ann', ', ', 'Bo', '']);
		assert.deepEqual(textSegments(['Hi ', 'Bo', ''], (id) => id.toUpperCase()), [{ text: 'Hi ' }, { text: 'BO', id: 'Bo' }]);
	});

	it('writes a name for a screen: title case for a character, sentence case for anything else', () => {
		assert.equal(displayName('OldBram', true), 'Old Bram');
		assert.equal(displayName('FigureA', true), 'Figure A');
		assert.equal(displayName('Bram2', true), 'Bram 2');
		assert.equal(displayName('CottageBookshelf', false), 'cottage bookshelf');
		assert.equal(displayName('SilverTrout', false), 'silver trout');
		assert.equal(displayName('BookA', false), 'book A');
		assert.equal(displayName('SilverTrout'), 'Silver Trout', 'unknown: only split');
		const { ada } = books();
		ada.name('CottageBookshelf', 'CottageBookshelf', { seen: true });
		assert.equal(ada.display('Helms'), 'Old Knight');
		assert.equal(ada.display('CottageBookshelf'), 'cottage bookshelf');
	});

	it('shows a vague label as it shows any other name', () => {
		const book = new NameBook();
		book.vague('Bo', 'Figure', true);
		book.vague('tome_3', 'Book');
		assert.equal(book.display('Bo'), 'Figure A');
		assert.equal(book.display('tome_3'), 'book A');
		book.name('Bo', 'OldBo', { seen: true, character: true });
		assert.equal(book.display('Bo'), 'Old Bo', 'made out: its name');
	});
});

describe('NameBook learned names', () => {
	it('keeps a name it learned through pruning, even once the policy calls them otherwise', () => {
		const book = new NameBook();
		book.name('Gisele', 'Gisele', { seen: true, character: true });
		book.name('Gisele', 'TallWoman', { seen: true, character: true });
		book.name('Tom', 'Stranger', { seen: true, character: true });
		assert.equal(book.learned('Gisele'), true);
		assert.equal(book.learned('Tom'), false);
		book.prune(new Set());
		assert.deepEqual(book.ids(), ['Gisele'], 'the stranger goes; the one it was told the name of stays');
		assert.equal(book.idOf('Gisele'), 'Gisele', 'its own name still means them');
		const again = new NameBook();
		again.load(book.toJSON());
		again.prune(new Set());
		assert.equal(again.learned('Gisele'), true, 'saved with the book');
		assert.deepEqual(again.ids(), ['Gisele']);
	});
});
