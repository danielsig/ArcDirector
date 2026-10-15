import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { encodedVocab, prependsSpace, vocabType } from './grammar.js';

describe('grammar', () => {
	it('lists tokens by id, added tokens over the model vocabulary, gaps empty', () => {
		assert.deepEqual(encodedVocab({ model: { vocab: { a: 0, b: 2 } }, added_tokens: [{ id: 3, content: '<eos>' }] }), ['a', '', 'b', '<eos>']);
		assert.deepEqual(encodedVocab({ model: { vocab: [['▁a', -1], ['▁b', -2]] } }), ['▁a', '▁b']);
	});

	it('reads how tokens spell text from the decoder', () => {
		assert.equal(vocabType({ model: { vocab: {} }, decoder: { type: 'ByteLevel' } }), 'byte_level');
		assert.equal(vocabType({ model: { vocab: {} }, decoder: { type: 'Sequence', decoders: [{ type: 'Replace' }, { type: 'ByteFallback' }, { type: 'Fuse' }] } }), 'byte_fallback');
		assert.equal(vocabType({ model: { vocab: {} }, decoder: { type: 'WordPiece' } }), 'raw');
	});

	it('knows a sentencepiece prefix space from one that is not there', () => {
		assert.equal(prependsSpace({ model: { vocab: {} }, normalizer: { type: 'Sequence', normalizers: [{ type: 'Prepend', prepend: '▁' }] } }), true);
		assert.equal(prependsSpace({ model: { vocab: {} }, pre_tokenizer: { type: 'Metaspace', prepend_scheme: 'first' } }), true);
		assert.equal(prependsSpace({ model: { vocab: {} }, normalizer: { type: 'Replace', pattern: { String: ' ' }, content: '▁' } }), false);
	});
});
