import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatChatLog } from './chat-log.js';

describe('chatLog', () => {
	it('puts message bodies in fences, not JSON strings', () => {
		const { message, image } = formatChatLog({
			model: 'muse',
			messages: [{
				role: 'user',
				content: [
					{ type: 'text', text: 'The map.\nLook.' },
					{ type: 'image_url', image_url: { url: 'data:image/png;base64,aaaa' } },
				],
			}],
			tools: [{ name: 'see_map' }],
		});
		assert.match(message, /"model":"muse"/);
		assert.match(message, /```\nThe map\.\nLook\.\n```/);
		assert.equal(message.includes('\\n'), false);
		assert.equal(message.includes('aaaa'), false);
		assert.equal(image, 'data:image/png;base64,aaaa');
	});

	it('shows a response-format schema by name only, and returns it whole apart', () => {
		const jsonSchema = { name: 'reply', schema: { type: 'object', properties: { zzz: {} } }, strict: true };
		const wire = formatChatLog({ model: 'muse', response_format: { type: 'json_schema', json_schema: jsonSchema } });
		assert.match(wire.message, /"response_format":"reply"/);
		assert.equal(wire.message.includes('zzz'), false);
		assert.deepEqual(wire.schema, jsonSchema);
		const raw = formatChatLog({
			model: 'muse',
			responseFormat: { name: 'reply', schema: { type: 'object', properties: { zzz: {} } } },
		});
		assert.match(raw.message, /"responseFormat":"reply"/);
		assert.equal(raw.message.includes('zzz'), false);
		assert.equal(raw.schema?.name, 'reply');
		assert.equal(formatChatLog({ model: 'muse' }).schema, undefined);
	});
});
