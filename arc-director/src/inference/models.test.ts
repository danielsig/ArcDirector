import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	asModelList,
	isThinkingModel,
	isVisionModel,
	MODEL_TIERS,
	pickReasoningOption,
	modelGrade,
	pickSingleChatModel,
	PREFERRED_MODELS,
	recommendedSampling,
	trainedOnArcDirector,
	type ModelInfo,
} from './models.js';

function model(id:string, extra:Partial<ModelInfo> = {}):ModelInfo {
	return { id, ...extra };
}

const embed = 'embed-test';

describe('trainedOnArcDirector', () => {
	it('knows a Skaldic model by its id, wherever it is served from', () => {
		assert.equal(trainedOnArcDirector('skaldic-gemma-4-e4b-v9'), true);
		assert.equal(trainedOnArcDirector('http://localhost:8090/skaldic-qwen3-4b-thinking-v2-Q4_K_M-00001-of-00005.gguf'), true);
		assert.equal(trainedOnArcDirector('google/gemma-4-e4b'), false);
	});
});

describe('recommendedSampling', () => {
	it("gives each family its makers' sampling, Qwen3 by whether it reasons, and nothing for one it does not know", () => {
		assert.deepEqual(recommendedSampling('google/gemma-4-e4b'), { temperature: 1, topP: 0.95, topK: 64 });
		assert.deepEqual(recommendedSampling('skaldic-gemma-4-e4b-v7'), { temperature: 1, topP: 0.95, topK: 64 }, "a fine-tune keeps its base's");
		assert.deepEqual(recommendedSampling('qwen/qwen3-8b', true), { temperature: 0.6, topP: 0.95, topK: 20 });
		assert.deepEqual(recommendedSampling('qwen/qwen3-8b', false), { temperature: 0.7, topP: 0.8, topK: 20 });
		assert.deepEqual(recommendedSampling('Qwen3-4B-Thinking-2507', false), { temperature: 0.6, topP: 0.95, topK: 20 }, 'it reasons whatever it is told');
		assert.equal(recommendedSampling('acme/unknown-7b'), undefined);
	});
});

describe('modelGrade', () => {
	it('favors active params near 4B, then total size near 20B', () => {
		const a4 = modelGrade('google/gemma-4-26b-a4b-qat');
		const a3 = modelGrade('qwen3-30b-a3b');
		const dense = modelGrade('meta/llama-3.1-8b');
		assert.ok(a4 > a3);
		assert.ok(a3 > dense);
		assert.ok(modelGrade('other-20b-a4b') > modelGrade('other-70b-a4b'));
	});
});

describe('pickSingleChatModel', () => {
	const a4 = 'google/gemma-4-26b-a4b-qat';
	const dense = 'google/gemma-4-31b-qat';

	it('stays on a loaded model instead of an unloaded higher grade', () => {
		const picked = pickSingleChatModel([
			model(dense, { state: 'loaded' }),
			model(a4),
			model(embed, { type: 'embeddings' }),
		]);
		assert.equal(picked, dense);
	});

	it('does not JIT-load a higher grade over a model that is already in VRAM', () => {
		const picked = pickSingleChatModel([
			model(dense, { state: 'loaded' }),
			model(a4),
		]);
		assert.equal(picked, dense);
	});

	it('picks the higher grade when the server does not report load state', () => {
		const picked = pickSingleChatModel([
			model(dense),
			model(a4),
		]);
		assert.equal(picked, a4);
	});

	it('treats loaded:true as in VRAM', () => {
		const picked = pickSingleChatModel([
			model(a4, { loaded: true }),
			model(dense),
		]);
		assert.equal(picked, a4);
	});

	it('honors an explicit request even if another model is in VRAM', () => {
		const picked = pickSingleChatModel([
			model(a4, { state: 'loaded' }),
			model(dense),
		], undefined, 'gemma-4-31b-qat');
		assert.equal(picked, dense);
	});
});

describe('isThinkingModel', () => {
	it('follows thinking flags on the tier list', () => {
		const thinking = MODEL_TIERS.find((t) => t.thinking)?.id;
		assert.ok(thinking);
		assert.equal(isThinkingModel(thinking), true);
		assert.equal(isThinkingModel('plain-chat'), false);
	});

	it('takes hybrid Qwen3 as thinking, but not its Instruct or Thinking splits, which ignore /no_think', () => {
		assert.equal(isThinkingModel('qwen/qwen3-32b'), true);
		assert.equal(isThinkingModel('qwen3-4b-instruct-2507'), false, 'a /no_think prefill made it answer nothing');
		assert.equal(isThinkingModel('qwen/qwen3-4b-thinking-2507'), false);
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

	it('reads reasoning allowed_options from the native catalog', () => {
		const list = asModelList({
			models: [
				{
					key: 'google/gemma-4-26b-a4b-qat',
					loaded_instances: [],
					capabilities: {
						reasoning: { allowed_options: ['off', 'on', 'low', 'medium', 'high'], default: 'low' },
					},
				},
				{
					key: 'google/gemma-4-26b-a4b',
					loaded_instances: [],
					capabilities: {
						reasoning: { allowed_options: ['off', 'on'], default: 'on' },
					},
				},
				{ key: 'plain-chat', loaded_instances: [] },
			],
		});
		assert.deepEqual(list[0]?.reasoning, {
			allowed: ['off', 'on', 'low', 'medium', 'high'],
			default: 'low',
		});
		assert.deepEqual(list[1]?.reasoning, { allowed: ['off', 'on'], default: 'on' });
		assert.equal(list[2]?.reasoning, undefined);
	});
});

describe('pickReasoningOption', () => {
	it('prefers low when thinking is on and low is listed', () => {
		assert.equal(pickReasoningOption(['off', 'on', 'low', 'high'], true, 'low'), 'low');
	});

	it('uses on when the model only lists on/off', () => {
		assert.equal(pickReasoningOption(['off', 'on'], true, 'low'), 'on');
		assert.equal(pickReasoningOption(['off', 'on'], false), 'off');
	});

	it('sends nothing when the catalog has no match', () => {
		assert.equal(pickReasoningOption(undefined, true, 'low'), undefined);
		assert.equal(pickReasoningOption(['on'], false), undefined);
	});
});

describe('pickSingleChatModel', () => {
	it('never picks an encoder', () => {
		const models = asModelList({ models: [
			{ key: 'google/gemma-4-e2b', type: 'llm', architecture: 'gemma4', size_bytes: 4.4e9, capabilities: { vision: true, trained_for_tool_use: true, reasoning: { allowed_options: ['off', 'on'] } } },
			{ key: 'laya-finetuned-rlcd', type: 'llm', architecture: 'modern-bert', size_bytes: 3.6e8, capabilities: { vision: false, trained_for_tool_use: false } },
			{ key: 'liquid/lfm2-1.2b', type: 'llm', architecture: 'lfm2', size_bytes: 1.2e9, capabilities: { vision: false, trained_for_tool_use: false } },
		] });
		assert.notEqual(pickSingleChatModel(models), 'laya-finetuned-rlcd');
	});
});
