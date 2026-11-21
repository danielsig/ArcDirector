import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { showInPerson, writerToID } from './person.js';

/** `text` as `reader` reads it, everyone by id: a note of `writer`'s, or with none, any other text. */
const readBy = (text:string[], reader:string, writer?:string):string => showInPerson(text, (id) => id === reader, (id) => id, writer);

describe('one person', () => {
	it('keeps a note\'s words for its writer as the writer\'s id, outside quotes and backticks, its verbs said to "you"', () => {
		assert.deepEqual(writerToID(['I lent Odo my cart.'], 'Cy'), ['', 'Cy', ' lent Odo ', 'Cy', '\'s cart.']);
		assert.deepEqual(writerToID(['I said "I will come" to you.'], 'Cy'), ['', 'Cy', ' said "I will come" to ', 'Cy', '.']);
		assert.deepEqual(writerToID(['I\'m tired; i.e. the US is far.'], 'Cy'), ['', 'Cy', ' are tired; i.e. the US is far.'], 'lowercase i and US stay');
		assert.deepEqual(writerToID(['I’m the last of us, I was told.'], 'Cy'), ['', 'Cy', ' are the last of us, ', 'Cy', ' were told.'], 'a curly apostrophe is one');
		assert.deepEqual(writerToID(['We hold our bridge, I said.'], 'Mira', 'Party'), ['', 'Party', ' hold ', 'Party', '\'s bridge, ', 'Mira', ' said.']);
		assert.deepEqual(writerToID(['We meet at dawn.'], 'Cy'), ['We meet at dawn.'], 'no group: "we" is not its writer alone');
		assert.deepEqual(writerToID(['Help me, `isHurt(me)` too, in the old mine.'], 'Cy'), ['Help ', 'Cy', ', `isHurt(me)` too, in the old mine.'], 'code and a mine stay');
	});

	it('shows a note to its writer as kept, and the writer\'s verb to anyone else of the writer', () => {
		const note = writerToID(['I am Valerius, a knight past my prime. I swore I would, and the cart is my own.'], 'Valerius');
		assert.equal(readBy(note, 'Valerius', 'Valerius'), 'You are Valerius, a knight past your prime. You swore you would, and the cart is your own.');
		assert.equal(readBy(note, 'Ann', 'Valerius'), 'Valerius is Valerius, a knight past Valerius\'s prime. Valerius swore Valerius would, and the cart is Valerius\'s own.');
		const dusk = writerToID(['I am Dusk, and I am the villain; once I was kind.'], 'Dusk');
		assert.equal(readBy(dusk, 'Dusk', 'Dusk'), 'You are Dusk, and you are the villain; once you were kind.');
		assert.equal(readBy(dusk, 'Ann', 'Dusk'), 'Dusk is Dusk, and Dusk is the villain; once Dusk was kind.');
		const robbed = writerToID(['The man who robbed me was tall, and I hurt myself.'], 'Cy');
		assert.equal(readBy(robbed, 'Cy', 'Cy'), 'The man who robbed you was tall, and you hurt yourself.', 'an object touches no verb');
		assert.equal(readBy(robbed, 'Ann', 'Cy'), 'The man who robbed Cy was tall, and Cy hurt Cy.');
	});

	it('shows other text of whom it names: its reader "you", its verb agreeing where it starts a clause', () => {
		assert.equal(readBy(['', 'Dee', ' has no shot at ', 'Joe', ''], 'Dee'), 'You have no shot at Joe');
		assert.equal(readBy(['', 'Joe', ' cleaved ', 'Dee', ''], 'Dee'), 'Joe cleaved you');
		assert.equal(readBy(['', 'Bob', ' and ', 'Ann', ' are here.'], 'Ann'), 'Bob and you are here.');
		assert.equal(readBy(['', 'Bob', ', ', 'Ann', ' are here.'], 'Cy'), 'Bob, Ann are here.', 'anyone else\'s verbs stay');
		assert.equal(readBy(['', 'Bob', ' is Bob. Role: Cobbler.'], 'Bob'), 'You are Bob. Role: Cobbler.');
	});

	it('names everyone inside quotes', () => {
		assert.equal(readBy(['', 'Joe', ' says to ', 'Bob', ': "', 'Bob', ', come here."'], 'Bob'), 'Joe says to you: "Bob, come here."');
	});
});
