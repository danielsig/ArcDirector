import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const playground = fileURLToPath(new URL('.', import.meta.url));
const kindlingSrc = fileURLToPath(new URL('../src/index.ts', import.meta.url));

export default defineConfig({
	root: playground,
	resolve: {
		alias: {
			'@arc-director/kindling': kindlingSrc,
		},
	},
	server: {
		port: 5174,
	},
});
