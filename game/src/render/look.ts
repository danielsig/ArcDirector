import type { RendererLook } from '@arc-director/kindling';
import { CLEAR_COLOR } from './palette';
import type { SceneLook } from '../data/scenes';

export function rendererLook(look:SceneLook):RendererLook {
	if (look === 'glen') {
		return {
			background: 0x87b5d9,
			fogNear: 22,
			fogFar: 56,
			exposure: 1.45,
			hemiSky: 0xd7ebff,
			hemiGround: 0x3d6b38,
			hemiIntensity: 1.35,
			fillColor: 0x8fb892,
			fillIntensity: 0.48,
			sun: { color: 0xfff6d8, intensity: 2.65 },
			ink: 0x2b1d12,
		};
	}
	if (look === 'market') {
		return {
			background: 0x8eb8d4,
			fogNear: 48,
			fogFar: 110,
			exposure: 1.42,
			hemiSky: 0xffe8c4,
			hemiGround: 0x6b5a3a,
			hemiIntensity: 1.2,
			fillColor: 0xc4a878,
			fillIntensity: 0.4,
			sun: { color: 0xffe2b0, intensity: 2.45 },
			ink: 0x33200f,
		};
	}
	return {
		background: CLEAR_COLOR,
		fogNear: 18,
		fogFar: 42,
		exposure: 1.15,
		hemiSky: 0x6a7d98,
		hemiGround: 0x1a1410,
		hemiIntensity: 0.24,
		fillColor: 0x243044,
		fillIntensity: 0.12,
		ink: 0x0b0a0e,
	};
}
