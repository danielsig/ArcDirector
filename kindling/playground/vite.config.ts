import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const playground = fileURLToPath(new URL('.', import.meta.url));
const kindlingSrc = fileURLToPath(new URL('../src/index.ts', import.meta.url));
/** The game's built models, served from disk for the character lineup. */
const gameModels = fileURLToPath(new URL('../../game/public/models/', import.meta.url)).replace(/\\/g, '/');

export default defineConfig({
	root: playground,
	define: {
		__GAME_MODELS__: JSON.stringify(`/@fs/${gameModels.replace(/^\//, '')}`),
	},
	resolve: {
		alias: {
			'@arc-director/kindling': kindlingSrc,
		},
	},
	server: {
		port: 5174,
	},
});
