import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { AiLogStore } from './AiLogStore.js';
import type { AiLogRun } from './protocol.js';

function store(keep = 10):AiLogStore {
	return new AiLogStore(fs.mkdtempSync(path.join(os.tmpdir(), 'ai-log-')), keep);
}

function run(session:string, minute:number):AiLogRun {
	return { session, scene: 'glen', started: `2026-11-18T10:${String(minute).padStart(2, '0')}:00.000Z` };
}

describe('AiLogStore', () => {
	it('keeps the newest runs across sessions', () => {
		const logs = store(3);
		for (let minute = 0; minute < 5; minute++) {
			logs.write({ run: run(minute % 2 ? 'alpha' : 'beta', minute), row: { seq: 1, name: 'Mira', message: `m${minute}` } });
		}
		const runs = logs.list();
		assert.deepEqual(runs.map((r) => r.started.slice(14, 16)), ['04', '03', '02']);
		assert.deepEqual(runs.map((r) => r.session), ['beta', 'alpha', 'beta']);
		assert.equal(runs[0].rows, 1);
	});

	it('reads a run by index or file, filtered, with the schemas its rows asked for', () => {
		const logs = store();
		const reply = { name: 'reply', schema: { type: 'object' }, strict: true };
		logs.write({ run: run('alpha', 0), row: { seq: 1, name: 'Mira', message: 'old' } });
		logs.write({ run: run('alpha', 1), row: { seq: 1, name: 'Mira', message: 'prompt a', image: true }, schema: reply });
		logs.write({ run: run('alpha', 1), row: { seq: 2, name: 'Mira', message: 'go_to(Well)' } });
		logs.write({ run: run('alpha', 1), row: { seq: 3, name: 'Tam', message: 'prompt b' }, schema: reply });
		logs.write({ run: run('beta', 2), row: { seq: 1, name: 'Tam', message: 'beta' } });
		assert.equal(logs.read(0).session, 'beta');
		const now = logs.read(0, 'alpha', { pattern: '^prompt' });
		assert.equal(now.rows, 3);
		assert.deepEqual(now.entries.map((e) => e.seq), [1, 3]);
		assert.equal(now.entries[0].image, true);
		assert.equal(now.entries[0].schema, now.entries[1].schema);
		assert.deepEqual(Object.values(now.schemas), [reply]);
		const text = fs.readFileSync(path.join(logs.dir, now.file), 'utf8');
		assert.equal(text.split('"schemaID"').length, 2);
		assert.equal(logs.read(1, 'alpha').entries[0].message, 'old');
		assert.equal(logs.read(now.file, undefined, { after: 1, limit: 1 }).entries[0].seq, 3);
		assert.throws(() => logs.read(2, 'alpha'), /no AI log run 2 for alpha/);
	});

	it('reads past a line cut short', () => {
		const logs = store();
		logs.write({ run: run('alpha', 0), row: { seq: 1, name: 'Mira', message: 'kept' } });
		const file = logs.list()[0].file;
		fs.appendFileSync(path.join(logs.dir, file), '{"seq":2,"name":"Mi');
		assert.deepEqual(logs.read(file).entries.map((e) => e.message), ['kept']);
	});
});
