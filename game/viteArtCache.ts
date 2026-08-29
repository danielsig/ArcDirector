import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin, ViteDevServer } from 'vite';
import { cacheDirFor, kindFromSource, packArtCache } from './scripts/artCachePack.mjs';

const VIRTUAL = 'virtual:art-cache';
const RESOLVED = `\0${VIRTUAL}`;
const dir = path.dirname(fileURLToPath(import.meta.url));

function mimeFor(file:string):string {
	if (file.endsWith('.png')) {
		return 'image/png';
	}
	if (file.endsWith('.json')) {
		return 'application/json; charset=utf-8';
	}
	return 'application/octet-stream';
}

function under(root:string, file:string):boolean {
	const rel = path.relative(root, file);
	return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

export function artCachePlugin():Plugin {
	let manifestJson = '{}';
	let outDir = 'dist';
	let cacheDir = cacheDirFor(dir);

	function rebuild(only?:string):boolean {
		const result = packArtCache({
			root: dir,
			only,
			silent: true,
		});
		const next = JSON.stringify(result.manifest);
		const changed = next !== manifestJson;
		manifestJson = next;
		cacheDir = result.cacheDir;
		return changed;
	}

	function notify(server:ViteDevServer):void {
		// Vite's graph API is getModuleById — not ours to rename.
		const mod = server.moduleGraph.getModuleById(RESOLVED); // eslint-disable-line no-restricted-syntax
		if (mod) {
			void server.reloadModule(mod);
		}
		server.ws.send({ type: 'full-reload' });
	}

	return {
		name: 'art-cache',
		configResolved(config) {
			outDir = path.resolve(config.root, config.build.outDir);
		},
		buildStart() {
			rebuild();
		},
		resolveId(id) { // eslint-disable-line no-restricted-syntax
			if (id === VIRTUAL) {
				return RESOLVED;
			}
			return undefined;
		},
		load(id) {
			if (id === RESOLVED) {
				return `export default ${manifestJson};`;
			}
			return undefined;
		},
		configureServer(server) {
			watchArt(server, (only) => {
				if (rebuild(only)) {
					notify(server);
				}
			});
			server.middlewares.use((req, res, next) => {
				const raw = req.url?.split('?')[0] ?? '';
				const base = (server.config.base || '/').replace(/\/$/, '');
				const prefix = `${base}/cache/`;
				if (!raw.startsWith(prefix)) {
					next();
					return;
				}
				const rel = decodeURIComponent(raw.slice(prefix.length));
				const file = path.resolve(cacheDir, rel);
				if (!under(cacheDir, file) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
					res.statusCode = 404;
					res.end();
					return;
				}
				res.statusCode = 200;
				res.setHeader('Content-Type', mimeFor(file));
				res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
				fs.createReadStream(file).pipe(res);
			});
		},
		closeBundle() {
			if (!fs.existsSync(cacheDir)) {
				return;
			}
			fs.cpSync(cacheDir, path.join(outDir, 'cache'), { recursive: true });
		},
	};
}

function watchArt(server:ViteDevServer, onChange:(only?:string) => void):void {
	server.watcher.add(path.join(dir, 'public', 'characters'));
	server.watcher.add(path.join(dir, 'public', 'items', 'sword'));
	let timer:ReturnType<typeof setTimeout> | null = null;
	const pending = new Set<string>();
	const kick = (file:string) => {
		const kind = kindFromSource(file, dir);
		if (!kind) {
			return;
		}
		pending.add(kind);
		if (timer) {
			clearTimeout(timer);
		}
		timer = setTimeout(() => {
			timer = null;
			const kinds = [...pending];
			pending.clear();
			onChange(kinds.length === 1 ? kinds[0] : undefined);
		}, 80);
	};
	server.watcher.on('change', kick);
	server.watcher.on('add', kick);
	server.watcher.on('unlink', kick);
}
