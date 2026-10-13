import { fileURLToPath } from 'node:url';
import { searchForWorkspaceRoot } from 'vite';
import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import { aiLogPlugin } from './viteAiLog.ts';

/** The TypeSafe key, from the repo-root `.env`. It stays on this dev server; the page posts to `/systemone` without it. */
const TYPE_SAFE_KEY = loadEnv('development', fileURLToPath(new URL('..', import.meta.url)), '').TYPE_SAFE_KEY;

export default defineConfig({
	plugins: [vue(), aiLogPlugin()],
	/** Saves key components by class name (`captureWorld`); keep names through minify. */
	esbuild: { keepNames: true },
	resolve: {
		alias: {
			'@arc-director/kindling/score': fileURLToPath(new URL('../kindling/src/score/index.ts', import.meta.url)),
			'@arc-director/kindling': fileURLToPath(new URL('../kindling/src/index.ts', import.meta.url)),
			'@arc-director/control': fileURLToPath(new URL('../control/src/index.ts', import.meta.url)),
			'arc-director': fileURLToPath(new URL('../arc-director/src/index.ts', import.meta.url)),
		},
	},
	optimizeDeps: {
		exclude: ['arc-director', '@arc-director/kindling', '@arc-director/control'],
		include: ['three', 'three/addons/loaders/GLTFLoader.js'],
	},
	server: {
		fs: {
			allow: [searchForWorkspaceRoot(process.cwd())],
		},
		proxy: {
			'/inference': {
				target: 'http://127.0.0.1:1234',
				changeOrigin: true,
				rewrite: (path) => path.replace(/^\/inference/, ''),
			},
			'/systemone': {
				target: 'https://api.typesafe.ai',
				changeOrigin: true,
				rewrite: () => '/v1/systemone',
				headers: TYPE_SAFE_KEY ? { Authorization: `Bearer ${TYPE_SAFE_KEY}` } : undefined,
				// No key: answer 503 here, so nothing goes out unauthenticated and chat NPCs keep working.
				bypass: (_req, res) => {
					if (TYPE_SAFE_KEY || !res) {
						return undefined;
					}
					res.statusCode = 503;
					res.end('TYPE_SAFE_KEY is not set in the repo-root .env');
					return false;
				},
			},
		},
	},
});
