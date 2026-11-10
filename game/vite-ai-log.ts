import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

const dir = path.dirname(fileURLToPath(import.meta.url));
const jsonlPath = path.join(dir, '.ai-log.jsonl');
const txtPath = path.join(dir, '.ai-log.txt');
const CAP = 250;

type Entry = {
	seq:number;
	name:string;
	message:string;
};

function asEntry(row:unknown):Entry | null {
	if (!row || typeof row !== 'object') {
		return null;
	}
	const rec = row as Record<string, unknown>;
	if (typeof rec.name !== 'string' || typeof rec.message !== 'string') {
		return null;
	}
	const seq = typeof rec.seq === 'number' ? rec.seq : 0;
	return { seq, name: rec.name, message: rec.message };
}

function formatTxt(entries:Entry[]):string {
	if (entries.length === 0) {
		return '';
	}
	return entries.map((e) => `[${e.seq}] ${e.name}\n${e.message}`).join('\n\n---\n\n') + '\n';
}

function writeFiles(entries:Entry[]):void {
	fs.writeFileSync(jsonlPath, entries.map((e) => JSON.stringify(e)).join('\n') + (entries.length > 0 ? '\n' : ''));
	fs.writeFileSync(txtPath, formatTxt(entries));
}

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

function send(res:ServerResponse, status:number, body?:string, type = 'text/plain; charset=utf-8'):void {
	res.statusCode = status;
	if (body !== undefined) {
		res.setHeader('content-type', type);
		res.end(body);
		return;
	}
	res.end();
}

export function aiLogPlugin():Plugin {
	let entries:Entry[] = [];
	return {
		name: 'ai-log',
		configureServer(server) {
			server.middlewares.use('/__ai-log', (req, res, next) => {
				if (req.method === 'GET') {
					send(res, 200, formatTxt(entries) || '(empty)\n');
					return;
				}
				if (req.method !== 'POST') {
					next();
					return;
				}
				void readBody(req).then((raw) => {
					let body:unknown;
					try {
						body = raw ? JSON.parse(raw) : {};
					}
					catch {
						send(res, 400, 'bad json');
						return;
					}
					if (!body || typeof body !== 'object') {
						send(res, 400, 'bad body');
						return;
					}
					const rec = body as Record<string, unknown>;
					if (rec.reset === true) {
						entries = [];
						writeFiles(entries);
						send(res, 204);
						return;
					}
					if (Array.isArray(rec.replace)) {
						entries = rec.replace.map(asEntry).filter((e):e is Entry => e !== null).slice(-CAP);
						writeFiles(entries);
						send(res, 204);
						return;
					}
					const entry = asEntry(rec);
					if (!entry) {
						send(res, 400, 'need name and message');
						return;
					}
					entries.push(entry);
					if (entries.length > CAP) {
						entries = entries.slice(-CAP);
						writeFiles(entries);
					}
					else {
						fs.appendFileSync(jsonlPath, `${JSON.stringify(entry)}\n`);
						fs.writeFileSync(txtPath, formatTxt(entries));
					}
					send(res, 204);
				}).catch(() => {
					send(res, 500, 'log write failed');
				});
			});
		},
	};
}
