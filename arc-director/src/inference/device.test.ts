import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fittingModel, memoryOf } from './device.js';

describe('device', () => {
	it('gives a discrete card its own memory, and its laptop part less', () => {
		assert.deepEqual(memoryOf('ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 (0x00002786) Direct3D11 vs_5_0 ps_5_0, D3D11)', 32), { gb: 12, gpu: 'NVIDIA GeForce RTX 4070', shared: false });
		assert.equal(memoryOf('ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Laptop GPU (0x00002860) Direct3D11 vs_5_0 ps_5_0, D3D11)')?.gb, 8);
		assert.equal(memoryOf('ANGLE (AMD, AMD Radeon RX 7900 XTX (0x0000744C) Direct3D11 vs_5_0 ps_5_0, D3D11)')?.gb, 24);
		assert.equal(memoryOf('ANGLE (AMD, AMD Radeon RX 7900 XT (0x0000744C) Direct3D11 vs_5_0 ps_5_0, D3D11)')?.gb, 20);
	});

	it('lends an integrated GPU half the RAM, and knows nothing without it', () => {
		const amd = 'ANGLE (AMD, AMD Radeon(TM) 860M Graphics (0x00001114) Direct3D11 vs_5_0 ps_5_0, D3D11)';
		assert.deepEqual(memoryOf(amd, 16), { gb: 8, gpu: 'AMD Radeon(TM) 860M Graphics', shared: true });
		assert.equal(memoryOf(amd), null);
		assert.equal(memoryOf('ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00005917) Direct3D11 vs_5_0 ps_5_0, D3D11)', 8)?.gb, 4);
	});

	it("gives a Mac most of its unified memory, at least what its chip ships with", () => {
		assert.equal(memoryOf('ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro, Unspecified Version)', 32)?.gb, 32 * 0.7);
		assert.equal(memoryOf('ANGLE (Apple, ANGLE Metal Renderer: Apple M4, Unspecified Version)')?.gb, 16 * 0.7);
		assert.equal(memoryOf('Apple GPU', 8), null);
	});

	it('picks the biggest model that leaves room to render, or none', () => {
		const models = [{ name: 'small', memoryGB: 5.5 }, { name: 'big', memoryGB: 9.7 }];
		assert.equal(fittingModel(models, { gb: 12, gpu: '', shared: false })?.name, 'big');
		assert.equal(fittingModel(models, { gb: 8, gpu: '', shared: true })?.name, 'small');
		assert.equal(fittingModel(models, { gb: 6, gpu: '', shared: false }), undefined);
		assert.equal(fittingModel(models, null), undefined);
	});
});
