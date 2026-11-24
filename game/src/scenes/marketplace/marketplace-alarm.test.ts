import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SayTone } from 'arc-director';
import { securityWord } from './marketplace-alarm';

describe('securityWord', () => {
	it('hears no cry in help said plainly, or any of its forms', () => {
		for (const text of ['My brother is quite ill with a cough, I hope this tonic helps.', 'Can you help me find the baker?', 'You have been so helpful!', 'She helped me carry it!']) {
			assert.equal(securityWord({ text }), undefined, text);
		}
	});

	it('hears help as a call with a "!", shouted or screamed', () => {
		assert.equal(securityWord({ text: 'Help!' }), 'help');
		assert.equal(securityWord({ text: 'Help me, please', as: SayTone.Shout }), 'help');
		assert.equal(securityWord({ text: 'help me', as: SayTone.Scream }), 'help');
		assert.equal(securityWord({ text: 'help me', as: SayTone.Whisper }), undefined);
	});

	it('hears a theft word however it is said, before help', () => {
		assert.equal(securityWord({ text: 'Someone stole my purse.' }), 'stole');
		assert.equal(securityWord({ text: 'Help, thief!' }), 'thief');
	});
});
