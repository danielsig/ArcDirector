import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	asModelList,
	isThinkingModel,
	isVisionModel,
	MODEL_TIERS,
	pickSingleChatModel,
	PREFERRED_MODELS,
	type ModelInfo,
} from './models.js';

function model(id:string, extra:Partial<ModelInfo> = {}):ModelInfo {
	return { id, ...extra };
}

const first = PREFERRED_MODELS[0];
const later = PREFERRED_MODELS[2];
const laterShort = PREFERRED_MODELS[3];
const embed = 'embed-test';

describe('pickSingleChatModel', () => {
	it('stays on a loaded preferred id instead of another catalog id', () => {
		const picked = pickSingleChatModel([
			model(later),
			model(first, { state: 'loaded' }),
			model(embed, { type: 'embeddings' }),
		]);
		assert.equal(picked, first);
	});

	it('does not JIT-load a preferred id over a model that is already in VRAM', () => {
		const picked = pickSingleChatModel([
			model(later, { state: 'loaded' }),
			model(first),
		]);
		assert.equal(picked, later);
	});

	it('ranks preferred ids when the server does not report load state', () => {
		const picked = pickSingleChatModel([
			model(later),
			model(first),
		]);
		assert.equal(picked, first);
	});

	it('treats loaded:true as in VRAM', () => {
		const picked = pickSingleChatModel([
			model(first, { loaded: true }),
			model(later),
		]);
		assert.equal(picked, first);
	});

	it('honors an explicit request even if another model is in VRAM', () => {
		const picked = pickSingleChatModel([
			model(first, { state: 'loaded' }),
			model(later),
		], undefined, laterShort);
		assert.equal(picked, later);
	});
});

describe('isThinkingModel', () => {
	it('follows thinking flags on the preferred tier list', () => {
		const thinking = MODEL_TIERS.find((t) => t.thinking)?.id;
		const plain = MODEL_TIERS.find((t) => !t.thinking)?.id;
		assert.ok(thinking);
		assert.ok(plain);
		assert.equal(isThinkingModel(thinking), true);
		assert.equal(isThinkingModel(plain), false);
	});

	it('does not list qwen on the preferred roster', () => {
		assert.equal(PREFERRED_MODELS.some((id) => /qwen/i.test(id)), false);
		assert.equal(MODEL_TIERS.some((t) => /qwen/i.test(t.id)), false);
	});
});

describe('isVisionModel', () => {
	it('honors catalog vision and vlm type', () => {
		assert.equal(isVisionModel(model('local-chat')), false);
		assert.equal(isVisionModel(model('local-chat', { vision: true })), true);
		assert.equal(isVisionModel(model('qwen2.5-vl-7b', { vision: false })), false);
		assert.equal(isVisionModel(model('anything', { type: 'vlm' })), true);
		assert.equal(isVisionModel('llava-v1.6'), true);
	});

	it('reads vision from the catalog payload', () => {
		const list = asModelList({
			data: [
				{ id: 'a', type: 'vlm' },
				{ id: 'b', vision: false },
				{ id: 'c', capabilities: { vision: true } },
			],
		});
		assert.equal(list[0]?.vision, true);
		assert.equal(list[1]?.vision, false);
		assert.equal(list[2]?.vision, true);
	});
});
