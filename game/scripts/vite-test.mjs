// Runs `node:test` files through Vite SSR, for imports plain Node cannot resolve:
// `node scripts/vite-test.mjs [files…]`, every src/**/*.test.ts when given none.
import { globSync } from 'node:fs';
import { createServer } from 'vite';

const files = process.argv.length > 2 ? process.argv.slice(2) : globSync('src/**/*.test.ts').sort();
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
// The tests share this process and never draw, but Three loads pictures through `document`. Set only now:
// Vite's config loads Vue, which takes any `document` for a browser's.
const image = { addEventListener() {}, removeEventListener() {} };
globalThis.document ??= { createElementNS: () => image };
try {
	for (const file of files) {
		await server.ssrLoadModule(`/${file}`);
	}
}
finally {
	await server.close();
}
