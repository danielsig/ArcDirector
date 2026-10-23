import { fileURLToPath } from 'node:url';
import { searchForWorkspaceRoot } from 'vite';
import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import { aiLogPlugin } from './viteAiLog.ts';

/**
 * Hosted services' keys, from the repo-root `.env`. They stay on this dev server, which adds them to what the page
 * sends through its proxies (`/systemone` for TypeSafe's Jev, `/xai` for xAI); the page only learns which are set.
 */
const { TYPE_SAFE_KEY, XAI_API_KEY } = loadEnv('development', fileURLToPath(new URL('..', import.meta.url)), '');

/** A proxy's answer when its key is not set: 503 here, so nothing goes out unauthenticated. */
function withoutKey(key:string | undefined, name:string) {
	return (_req:unknown, res:{ statusCode:number; end(text:string):void } | undefined):false | undefined => {
		if (key || !res) {
			return undefined;
		}
		res.statusCode = 503;
		res.end(`${name} is not set in the repo-root .env`);
		return false;
	};
}

/**
 * Cross-origin isolation: the page may share memory between threads, so wllama runs llama.cpp on several CPU
 * threads beside the GPU. `credentialless` still lets the page fetch models from other origins.
 */
const ISOLATED = {
	'Cross-Origin-Opener-Policy': 'same-origin',
	'Cross-Origin-Embedder-Policy': 'credentialless',
};

export default defineConfig({
	plugins: [vue(), aiLogPlugin()],
	// Which hosted services can be offered (`director/hosted.ts`): flags only, never the keys.
	define: { __HOSTED__: JSON.stringify({ jev: !!TYPE_SAFE_KEY, xai: !!XAI_API_KEY }) },
	/** Saves key components by class name (`captureWorld`); keep names through minify. */
	esbuild: { keepNames: true },
	resolve: {
		alias: {
			'@arc-director/kindling/score': fileURLToPath(new URL('../kindling/src/score/index.ts', import.meta.url)),
			'@arc-director/kindling': fileURLToPath(new URL('../kindling/src/index.ts', import.meta.url)),
			'@arc-director/control': fileURLToPath(new URL('../control/src/index.ts', import.meta.url)),
			'arc-director/bench': fileURLToPath(new URL('../arc-director/src/bench/index.ts', import.meta.url)),
			'arc-director': fileURLToPath(new URL('../arc-director/src/index.ts', import.meta.url)),
		},
	},
	optimizeDeps: {
		exclude: ['arc-director', 'arc-director/bench', '@arc-director/kindling', '@arc-director/control'],
		include: ['three', 'three/addons/loaders/GLTFLoader.js'],
	},
	preview: { headers: ISOLATED },
	server: {
		headers: ISOLATED,
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
				bypass: withoutKey(TYPE_SAFE_KEY, 'TYPE_SAFE_KEY'),
			},
			'/xai': {
				target: 'https://api.x.ai',
				changeOrigin: true,
				rewrite: (path) => path.replace(/^\/xai/, '/v1'),
				headers: XAI_API_KEY ? { Authorization: `Bearer ${XAI_API_KEY}` } : undefined,
				bypass: withoutKey(XAI_API_KEY, 'XAI_API_KEY'),
			},
		},
	},
});
