// Runs `node:test` files through Vite SSR, for imports plain Node cannot resolve: `node scripts/viteTest.mjs <files…>`
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
	for (const file of process.argv.slice(2)) {
		await server.ssrLoadModule(`/${file}`);
	}
}
finally {
	await server.close();
}
