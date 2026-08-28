import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { insertAfterChunk } from './shader.js';

describe('insertAfterChunk', () => {
	it('inserts GLSL after a documented include', () => {
		const src = '#include <common>\nvoid main() {}\n';
		const out = insertAfterChunk(src, 'common', 'uniform float uTime;');
		assert.equal(out, '#include <common>\nuniform float uTime;\nvoid main() {}\n');
	});

	it('throws when the chunk token is missing', () => {
		assert.throws(
			() => insertAfterChunk('void main() {}', 'color_fragment', '/* x */'),
			/Missing shader chunk: color_fragment/,
		);
	});
});
