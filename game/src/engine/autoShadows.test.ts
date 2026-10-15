import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { memoryOf } from 'arc-director';
import { autoShadowTier } from './autoShadows';

const tierOf = (gpu:string, ramGB?:number) => autoShadowTier(memoryOf(gpu, ramGB));

describe('autoShadowTier', () => {
	it('gives a big card High, a mid one Low, and a small one Simple', () => {
		assert.equal(tierOf('ANGLE (NVIDIA, NVIDIA GeForce RTX 5090 (0x00002B85) Direct3D11 vs_5_0 ps_5_0, D3D11)'), 'high');
		assert.equal(tierOf('NVIDIA GeForce RTX 4060'), 'low');
		assert.equal(tierOf('NVIDIA GeForce GTX 1650'), 'simple');
	});

	it('takes a GPU that shares the system RAM a tier lower than its memory says', () => {
		assert.equal(tierOf('Apple M3 Max', 32), 'low');
		assert.equal(tierOf('Intel(R) Iris(R) Xe Graphics', 16), 'simple');
	});

	it('picks Low when the browser hides the GPU', () => {
		assert.equal(autoShadowTier(null), 'low');
	});
});
