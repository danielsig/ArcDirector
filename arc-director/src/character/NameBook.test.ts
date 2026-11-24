import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Knows, NameBook } from './NameBook.js';

describe('NameBook.prune', () => {
	it('drops names nothing uses, keeps learned names and an unsuffixed name while its suffixed sibling stays', () => {
		const book = new NameBook();
		book.name('Ash', 'EnemyWitch', { character: true });
		book.name('Nyx', 'EnemyWitch', { character: true });
		book.name('Helms', 'EnemyKnight', { character: true });
		book.name('Rook', 'EnemyKnight', { character: true });
		book.name('Bram', 'Bram', { seen: true, character: true });
		book.name('Tom', 'Stranger', { character: true });
		book.prune(new Set(['Nyx', 'Helms']));
		assert.equal(book.peek('Nyx'), 'EnemyWitch2', 'used');
		assert.equal(book.peek('Ash'), 'EnemyWitch', 'unused, but its sibling EnemyWitch2 stays');
		assert.equal(book.peek('Helms'), 'EnemyKnight', 'used');
		assert.equal(book.peek('Rook'), undefined, 'a suffixed name nothing uses goes');
		assert.equal(book.peek('Bram'), 'Bram', 'learned: made out under its own id');
		assert.equal(book.peek('Tom'), undefined, 'unused');
		assert.equal(book.resolve('Stranger'), 'Stranger', 'its name resolves no more');
		assert.equal(book.isCharacter('Tom'), undefined);
		assert.equal(book.name('Zed', 'EnemyKnight'), 'EnemyKnight2', 'a pruned suffix is free again');
	});

	it('drops the vague labels of ids nothing uses, and frees their letters', () => {
		const book = new NameBook();
		book.vague('Ivo', 'Figure', true);
		book.vague('Eda', 'Figure', true);
		book.prune(new Set(['Eda']));
		assert.equal(book.peek('Ivo'), undefined, 'a passer-by never made out');
		assert.equal(book.resolve('FigureA'), 'FigureA', 'its label resolves no more');
		assert.equal(book.isCharacter('Ivo'), undefined);
		assert.equal(book.peek('Eda'), 'FigureB', 'used');
		assert.equal(book.vague('Cy', 'Figure'), 'FigureA', 'its letters are free again');
	});

	it('keeps whether each is a character through a save', () => {
		const book = new NameBook();
		book.name('Ash', 'EnemyWitch', { character: true });
		book.vague('Tome', 'Book');
		const loaded = new NameBook();
		loaded.load(JSON.parse(JSON.stringify(book.toJSON())));
		assert.equal(loaded.isCharacter('Ash'), true);
		assert.equal(loaded.isCharacter('Tome'), false);
		assert.equal(loaded.display('Ash'), 'Enemy Witch');
	});
});

describe('NameBook.inCode', () => {
	it('shows code a name its mind knows, a vague label only for one it does not or that it wrote by that label', () => {
		const book = new NameBook();
		const king = book.vague('HollowKing', 'Figure', true);
		assert.equal(book.inCode('HollowKing'), king, 'a host\'s law names one it only sees vaguely by its label');
		book.name('HollowKing', 'HollowKing', { seen: true, character: true });
		book.vague('HollowKing', 'Figure', true);
		assert.equal(book.inCode('HollowKing'), 'HollowKing', 'once made out, by its name, vague again or not');
		const chest = book.vague('OssuaryChest', 'Something');
		assert.equal(book.read('OssuaryChest'), 'OssuaryChest', 'named in its goal, written by name');
		assert.equal(book.inCode('OssuaryChest'), 'OssuaryChest', 'so its program shows the name, never SomethingA');
		assert.equal(book.read(chest), 'OssuaryChest', 'written by its label');
		assert.equal(book.inCode('OssuaryChest'), chest, 'shows that label, telling nothing of who it is');
		assert.equal(book.read(king), 'HollowKing');
		assert.equal(book.inCode('HollowKing'), king, 'even of one it knows by name: it does not know the two are one');
		const loaded = new NameBook();
		loaded.load(JSON.parse(JSON.stringify(book.toJSON())));
		assert.equal(loaded.inCode('OssuaryChest'), chest, 'through a save');
		book.read('OssuaryChest');
		assert.equal(book.inCode('OssuaryChest'), 'OssuaryChest', 'the word it wrote last counts');
	});
});

describe('NameBook voices', () => {
	it('names a voice it cannot place apart from the face, acts on it as the person, and once seen speaking reads it as them', () => {
		const book = new NameBook();
		book.name('Wynn', 'Woman', { seen: true, character: true });
		book.hear('Wynn');
		assert.equal(book.peek('voice:Wynn'), 'VoiceA', 'heard, not seen: its own label');
		assert.equal(book.peek('Wynn'), 'Woman', 'the face keeps its name');
		assert.equal(book.resolve('VoiceA'), 'Wynn', 'acted on, the person');
		assert.equal(book.idOf('VoiceA'), 'voice:Wynn', 'kept in notes, the voice');
		assert.equal(book.peek('voice:Wynn'), 'VoiceA');
		book.read('VoiceA');
		assert.equal(book.inCode('Wynn'), 'VoiceA', 'code shows what the mind wrote');
		assert.equal(book.peek('Wynn'), 'VoiceA', 'last named by voice');
		const saved = new NameBook();
		saved.load(JSON.parse(JSON.stringify(book.toJSON())));
		assert.equal(saved.peek('voice:Wynn'), 'VoiceA', 'saved');
		book.hear('Wynn', { face: true });
		assert.equal(book.peek('voice:Wynn'), 'Woman', 'seen speaking: the voice is the face');
		assert.equal(book.resolve('VoiceA'), 'Wynn');
		book.hear('Wynn');
		assert.equal(book.peek('voice:Wynn'), 'Woman', 'a voice it knows stays known');
		assert.equal(book.resolve('VoiceA'), 'Wynn', 'the old label still resolves');
	});

	it('gives each voice it cannot place its own letters, apart from figure labels', () => {
		const book = new NameBook();
		book.vague('Ann', 'Figure', true);
		book.hear('Ann');
		book.hear('Bob');
		assert.deepEqual([book.peek('Ann'), book.peek('voice:Ann'), book.peek('voice:Bob')], ['FigureA', 'VoiceA', 'VoiceB']);
	});

	it('knows the voices its persona\'s spec says from the start, tied to the look and name everyone knows', () => {
		const book = new NameBook();
		book.knowsBySpec = (id) => (id === 'Wynn' ? [Knows.Voice] : []);
		book.name('Wynn', 'Wynn', { seen: true, character: true });
		book.hear('Wynn');
		book.hear('Ann');
		assert.deepEqual([book.peek('voice:Wynn'), book.peek('voice:Ann')], ['Wynn', 'VoiceA']);
	});
});
