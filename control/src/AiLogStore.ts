import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { filterAiLog, isRecord, type AiLogPost, type AiLogQuery, type AiLogRow, type AiLogRun } from './protocol.js';

/** `<repo>/logs/ai`, gitignored. */
export const AI_LOG_DIR = fileURLToPath(new URL('../../logs/ai/', import.meta.url));

/** Files kept, across all sessions: a session id is a throwaway name, and pages without one log too. */
export const AI_LOG_KEEP = 10;

/** A stored run, as `list` gives it. */
export type AiLogFile = AiLogRun & {
	file:string;
	rows:number;
};

/** The rows of a stored run that pass a query, and the response formats those rows asked for, by id. */
export type AiLogRead = AiLogFile & {
	entries:AiLogRow[];
	schemas:Record<string, unknown>;
};

/**
 * The AI log of each run, kept on disk so a reload loses nothing: one JSON-lines file per run, the newest `keep`
 * kept. Line one is the run; rows follow as they arrive. A response format is written once per file, before the first
 * row that asks for it, as `{ schemaID, schema }`, and rows name it by that id.
 */
export class AiLogStore {
	/** Per file, the ids of the schemas written to it. */
	private readonly _written = new Map<string, Set<string>>();

	constructor(public readonly dir = AI_LOG_DIR, private readonly _keep = AI_LOG_KEEP) {}

	/** Appends a row to its run's file, starting the file (and dropping the oldest past `keep`) on its first row. */
	public write(post:AiLogPost):void {
		if (typeof post.run?.started !== 'string' || typeof post.row?.seq !== 'number' || typeof post.row.message !== 'string') {
			throw new Error('not an AI log row');
		}
		const file = fileOf(post.run);
		const full = path.join(this.dir, file);
		const lines:string[] = [];
		const fresh = !fs.existsSync(full);
		if (fresh) {
			fs.mkdirSync(this.dir, { recursive: true });
			lines.push(JSON.stringify({ session: post.run.session, scene: post.run.scene, started: post.run.started }));
			this._written.set(file, new Set());
		}
		const row:AiLogRow = { ...post.row };
		if (post.schema) {
			const json = JSON.stringify(post.schema);
			const id = createHash('sha1').update(json).digest('hex').slice(0, 8);
			const written = this._written.get(file) ?? new Set();
			this._written.set(file, written);
			if (!written.has(id)) {
				written.add(id);
				lines.push(`{"schemaID":"${id}","schema":${json}}`);
			}
			row.schema = id;
		}
		lines.push(JSON.stringify(row));
		fs.appendFileSync(full, `${lines.join('\n')}\n`);
		if (fresh) {
			for (const old of this.files().slice(this._keep)) {
				fs.rmSync(path.join(this.dir, old), { force: true });
				this._written.delete(old);
			}
		}
	}

	/** The stored runs, newest first. */
	public list():AiLogFile[] {
		return this.files().map((file) => {
			const { run, rows } = this.load(file);
			return { file, ...run, rows: rows.length };
		});
	}

	/** A stored run's rows that pass `query`: `run` is a file name, or the how-manyth newest (0 = newest) of `session`'s runs, else of all. */
	public read(run:number | string, session?:string, query:AiLogQuery = {}):AiLogRead {
		const file = typeof run === 'string' ? path.basename(run) : this.nth(run, session);
		if (!fs.existsSync(path.join(this.dir, file))) {
			throw new Error(`no AI log ${file}`);
		}
		const stored = this.load(file);
		const entries = filterAiLog(stored.rows, query);
		const schemas:Record<string, unknown> = {};
		for (const entry of entries) {
			if (entry.schema) {
				schemas[entry.schema] = stored.schemas.get(entry.schema);
			}
		}
		return { file, ...stored.run, rows: stored.rows.length, entries, schemas };
	}

	/** File names, newest first: each starts with its run's start time. */
	private files():string[] {
		if (!fs.existsSync(this.dir)) {
			return [];
		}
		return fs.readdirSync(this.dir).filter((file) => file.endsWith('.jsonl')).sort().reverse();
	}

	private nth(index:number, session:string | undefined):string {
		const files = session === undefined ? this.files() : this.list().filter((run) => run.session === session).map((run) => run.file);
		const file = files[index];
		if (file === undefined) {
			throw new Error(`no AI log run ${index}${session === undefined ? '' : ` for ${session}`}: ${files.length} stored`);
		}
		return file;
	}

	private load(file:string):{ run:AiLogRun; rows:AiLogRow[]; schemas:Map<string, unknown> } {
		const lines = fs.readFileSync(path.join(this.dir, file), 'utf8').split('\n');
		const run:AiLogRun = { session: '', scene: '', started: '' };
		const rows:AiLogRow[] = [];
		const schemas = new Map<string, unknown>();
		lines.forEach((line, i) => {
			const value = parseLine(line);
			if (!value) {
				return;
			}
			if (i === 0) {
				run.session = String(value.session ?? '');
				run.scene = String(value.scene ?? '');
				run.started = String(value.started ?? '');
			}
			else if (typeof value.schemaID === 'string') {
				schemas.set(value.schemaID, value.schema);
			}
			else if (typeof value.seq === 'number') {
				rows.push(value as AiLogRow);
			}
		});
		return { run, rows, schemas };
	}
}

/** `<start time>-<session>.jsonl`, so names sort oldest first. */
function fileOf(run:AiLogRun):string {
	return `${run.started}-${run.session || 'page'}`.replace(/[^\w-]/g, '-') + '.jsonl';
}

/** A line cut short by a crash parses as nothing, and the rest of the file still reads. */
function parseLine(line:string):Record<string, unknown> | null {
	if (!line) {
		return null;
	}
	try {
		const value:unknown = JSON.parse(line);
		return isRecord(value) ? value : null;
	}
	catch {
		return null;
	}
}
