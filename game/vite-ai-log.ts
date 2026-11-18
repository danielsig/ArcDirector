import type { IncomingMessage } from 'node:http';
import type { Plugin } from 'vite';
import { AiLogStore } from '@arc-director/control/ai-log-store';
import type { AiLogPost } from '@arc-director/control';

function readBody(req:IncomingMessage):Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks:Buffer[] = [];
		req.on('data', (chunk:Buffer) => {
			chunks.push(chunk);
		});
		req.on('end', () => {
			resolve(Buffer.concat(chunks).toString('utf8'));
		});
		req.on('error', reject);
	});
}

/** Stores the AI log rows a page posts (`ai-log-sink.ts`) in `<repo>/logs/ai`, a file per game (each scene start, restart or load), so a reload loses none. */
export function aiLogPlugin():Plugin {
	const logs = new AiLogStore();
	return {
		name: 'ai-log',
		configureServer(server) {
			server.middlewares.use('/__ai-log', (req, res, next) => {
				if (req.method !== 'POST') {
					next();
					return;
				}
				void readBody(req).then((raw) => {
					logs.write(JSON.parse(raw) as AiLogPost);
					res.statusCode = 204;
				}).catch((err:unknown) => {
					res.statusCode = 400;
					res.setHeader('content-type', 'text/plain; charset=utf-8');
					res.write(err instanceof Error ? err.message : String(err));
				}).finally(() => {
					res.end();
				});
			});
		},
	};
}
