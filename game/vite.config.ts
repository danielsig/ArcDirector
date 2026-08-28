import { searchForWorkspaceRoot } from 'vite';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { aiLogPlugin } from './viteAiLog.ts';
import { artCachePlugin } from './viteArtCache.ts';

export default defineConfig({
	plugins: [vue(), aiLogPlugin(), artCachePlugin()],
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
