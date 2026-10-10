import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { backquoteGlyph } from './bindings.ts';

describe('backquoteGlyph', () => {
	it('names the US key by its tilde', () => {
		assert.equal(backquoteGlyph('`'), '~');
	});

	it('names the German key by its degree mark', () => {
		assert.equal(backquoteGlyph('^'), '°');
	});

	it('keeps any other layout character', () => {
		assert.equal(backquoteGlyph('§'), '§');
		assert.equal(backquoteGlyph('²'), '²');
	});

	it('falls back when the layout map has no character', () => {
		assert.equal(backquoteGlyph(undefined), '~');
		assert.equal(backquoteGlyph('Dead'), '~');
	});
});
