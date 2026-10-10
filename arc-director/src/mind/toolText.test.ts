import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { jsonToolCall, writtenToolCalls } from './toolText.js';

const TOOLS = new Map<string, string | undefined>([['recall', 'query'], ['observe', 'expr'], ['earshot', 'to'], ['see_map', 'zoom']]);
const read = (text:string) => writtenToolCalls(text, TOOLS);

describe('writtenToolCalls', () => {
	it('reads every shape a small model wrote a tool in, as seen in the glen', () => {
		assert.deepEqual(read('earshot(to=BridgeKeeper)').calls, [{ name: 'earshot', args: { to: 'BridgeKeeper' } }]);
		assert.deepEqual(read('call:earshot{to:"BridgeKeeper"}').calls, [{ name: 'earshot', args: { to: 'BridgeKeeper' } }]);
		assert.deepEqual(read('earshot{to="BridgeKeeper"}').calls, [{ name: 'earshot', args: { to: 'BridgeKeeper' } }]);
		assert.deepEqual(read('call:recall{query:"buy FireMushroom"}').calls, [{ name: 'recall', args: { query: 'buy FireMushroom' } }]);
		assert.deepEqual(read('observe("BridgeKeeper")').calls, [{ name: 'observe', args: { expr: 'BridgeKeeper' } }]);
		assert.deepEqual(read('earshot()').calls, [{ name: 'earshot', args: {} }]);
		assert.deepEqual(
			read('tool:observe{expr:<|"|>isNear(me, Forager, 16)<|"|>}').calls,
			[{ name: 'observe', args: { expr: 'isNear(me, Forager, 16)' } }],
			'the chat template\'s own quote tokens',
		);
	});

	it('leaves the Arc written beside them', () => {
		assert.equal(read('call:observe{expr:<|"|>isNear(me, Forager, 16)<|"|>}\ngo_to(Forager)').rest, 'go_to(Forager)');
		assert.equal(read('observe(hasSightline) && go_to(Forager)').rest, 'go_to(Forager)');
		assert.equal(read('earshot()\nsay(text=I will gather them, to=BridgeKeeper)').rest, 'say(text=I will gather them, to=BridgeKeeper)');
		assert.equal(read('go_to(Well) && recall("Bucket") && pick_up(Bucket)').rest, 'go_to(Well) && pick_up(Bucket)');
	});

	it('never reads a tool name inside a step, or a verb', () => {
		const text = 'think(about=whether to observe(Bridge) first) && say(text=Use recall(Bread), to=Mira)';
		assert.deepEqual(read(text), { calls: [], rest: text });
		assert.deepEqual(read('go_to(Bridge)').calls, []);
	});
});

describe('jsonToolCall', () => {
	it('reads a tool called in JSON, its other keys being the args', () => {
		assert.deepEqual(jsonToolCall('{"tool":"recall","query":"Bread"}'), { name: 'recall', args: { query: 'Bread' } });
		assert.deepEqual(jsonToolCall('{ "tool": "see_map", "zoom": 0.5 }'), { name: 'see_map', args: { zoom: 0.5 } });
		assert.deepEqual(jsonToolCall('```json\n{"tool":"earshot"}\n```'), { name: 'earshot', args: {} });
		assert.deepEqual(jsonToolCall('{"tool":"recall","query":"Bre'), { name: 'recall', args: { query: 'Bre' } });
	});

	it('is not fooled by steps, prose or a tool name that is no string', () => {
		assert.equal(jsonToolCall('{"steps":[{"verb":"wait"}]}'), undefined);
		assert.equal(jsonToolCall('{"steps":[{"verb":"wait"}],"tool":"recall"}'), undefined);
		assert.equal(jsonToolCall('recall(Bread)'), undefined);
		assert.equal(jsonToolCall('I will call {"tool":"recall","query":"Bread"}'), undefined);
		assert.equal(jsonToolCall('{"tool":3}'), undefined);
		assert.equal(jsonToolCall(''), undefined);
	});
});
