import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MemoryStore } from '../memory/store.js';
import { Persona, type PersonaSpec } from './Persona.js';

const identityRows = (persona:Persona):number => persona.memory.pinned().filter((row) => row.category === 'identity').length;

describe('Persona', () => {
	it('setIdentity changes what it is given, keeps the rest, and restamps the identity memory once', () => {
		const persona = new Persona({ identity: { role: 'BridgeKeeper', traits: ['gruff'] } }, new MemoryStore('Odo'));
		assert.equal(persona.setIdentity({ traits: ['gruff', 'proud'] }, 5), true);
		assert.deepEqual(persona.identity, { role: 'BridgeKeeper', traits: ['gruff', 'proud'] });
		assert.equal(identityRows(persona), 1);
		assert.equal(persona.setIdentity({ role: 'Ferryman' }, 6), true);
		assert.deepEqual(persona.identity, { role: 'Ferryman', traits: ['gruff', 'proud'] });
		assert.equal(identityRows(persona), 1, 'restamped, not added');
		assert.equal(persona.setIdentity({ role: ' Ferryman ', traits: ['gruff', ' proud', ''] }, 7), false, 'the same, trimmed');
		assert.equal(persona.setIdentity({ traits: [] }, 8), true);
		assert.deepEqual(persona.identity.traits, []);
	});

	it('takes its interests and disposition from the spec, a loaded one too', () => {
		const spec:PersonaSpec = { interests: ['I love fishing.'], disposition: { afraid: 0.3 } };
		const saved = JSON.parse(JSON.stringify(new Persona(spec, new MemoryStore('Odo')).toJSON()));
		const loaded = Persona.fromJSON(saved, { ...spec, interests: ['Old books are my passion.'] }, new MemoryStore('Odo'));
		assert.deepEqual(loaded.interests, ['Old books are my passion.']);
		assert.deepEqual(loaded.disposition, { afraid: 0.3 });
	});

	it('reads a model\'s set_identity as setIdentity takes it', () => {
		const persona = new Persona({}, new MemoryStore('Odo'));
		assert.equal(persona.applyIdentityPatch({ role: 'Watch', traits: ['stern', 3] }, 1), true);
		assert.deepEqual(persona.identity, { role: 'Watch', traits: ['stern'] });
		assert.equal(persona.applyIdentityPatch('Watch', 2), false);
	});
});
