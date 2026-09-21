import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatChatLog } from './chatLog.js';

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
});
