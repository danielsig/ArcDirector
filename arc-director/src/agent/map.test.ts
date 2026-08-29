import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatLegend, parseMapZoom, stampMap, DEFAULT_YOU_SYMBOL, type MapMark } from './map.js';

const marks:MapMark[] = [
	{ symbol: DEFAULT_YOU_SYMBOL, description: 'you', x: 1, y: 2 },
	{ symbol: '🏠', description: 'Cottage', x: 4, y: 2 },
	{ symbol: '🎚️', description: 'MillLever', x: 8, y: 3 },
];

describe('map legend', () => {
	it('joins symbols to names and omits numbers', () => {
		const legend = formatLegend(marks);
		assert.equal(legend, `${DEFAULT_YOU_SYMBOL} = you, 🏠 = Cottage, 🎚️ = MillLever`);
		assert.equal(/\d/.test(legend), false);
	});

	it('returns the source image when there is no canvas to stamp', async () => {
		const image = 'data:image/png;base64,xx';
		const stamped = await stampMap({
			image,
			width: 8,
			height: 8,
			toPixel: (x, y) => ({ u: x, v: y }),
			marks,
		});
		assert.equal(stamped.image, image);
		assert.equal(stamped.legend, `${DEFAULT_YOU_SYMBOL} = you, 🏠 = Cottage, 🎚️ = MillLever`);
	});
});

describe('map zoom', () => {
	it('reads zoom 0..1 and maps legacy near/world', () => {
		assert.equal(parseMapZoom({ zoom: 1 }), 1);
		assert.equal(parseMapZoom({ zoom: 0 }), 0);
		assert.equal(parseMapZoom({ zoom: 0.4 }), 0.4);
		assert.equal(parseMapZoom({ zoom: 3 }), 1);
		assert.equal(parseMapZoom({ zoom: -1 }), 0);
		assert.equal(parseMapZoom({ map: 'world' }), 0);
		assert.equal(parseMapZoom({ map: 'near' }), 1);
		assert.equal(parseMapZoom({}), 1);
	});
});
