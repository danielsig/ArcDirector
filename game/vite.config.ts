import { fileURLToPath } from 'node:url';
import { searchForWorkspaceRoot } from 'vite';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { aiLogPlugin } from './viteAiLog.ts';
import { artCachePlugin } from './viteArtCache.ts';

export default defineConfig({
	plugins: [vue(), aiLogPlugin(), artCachePlugin()],
	resolve: {
		alias: {
			'@arc-director/kindling': fileURLToPath(new URL('../kindling/src/index.ts', import.meta.url)),
			'arc-director': fileURLToPath(new URL('../arc-director/src/index.ts', import.meta.url)),
		},
	},
	optimizeDeps: {
		exclude: ['arc-director', '@arc-director/kindling'],
	},
	server: {
		watch: {
			ignored: ['**/cache/**'],
		},
		fs: {
			allow: [searchForWorkspaceRoot(process.cwd())],
		},
		proxy: {
			'/inference': {
				target: 'http://127.0.0.1:1234',
				changeOrigin: true,
				rewrite: (path) => path.replace(/^\/inference/, ''),
			},
		},
	},
});
