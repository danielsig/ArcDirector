import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ModelDownload, type DownloadProgress } from './download.js';

/** A download its test drives by hand. */
function manual():{ download:ModelDownload; report(progress:number):void; finish():void; fail(err:Error):void } {
	let report = (_p:DownloadProgress):void => undefined;
	let finish = ():void => undefined;
	let fail = (_err:Error):void => undefined;
	const download = new ModelDownload((r) => new Promise((resolve, reject) => {
		report = r;
		finish = resolve;
		fail = reject;
	}));
	return { download, report: (progress) => report({ progress, text: '' }), finish: () => finish(), fail: (err) => fail(err) };
}

const tick = ():Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('ModelDownload', () => {
	it('tells progress, then completes', async () => {
		const { download, report, finish } = manual();
		const seen:(number | string)[] = [];
		download.subscribe({ next: (p) => seen.push(p.progress), complete: () => seen.push('done') });
		report(0.5);
		finish();
		await download.done;
		assert.deepEqual(seen, [0, 0.5, 'done']);
		assert.equal(download.state, 'done');
	});

	it('gives a late subscriber the last progress and the end', async () => {
		const { download, report, finish } = manual();
		report(1);
		finish();
		await tick();
		const seen:(number | string)[] = [];
		download.subscribe({ next: (p) => seen.push(p.progress), complete: () => seen.push('done') });
		assert.deepEqual(seen, [1, 'done']);
	});

	it('errors, and rejects done', async () => {
		const { download, fail } = manual();
		const errors:unknown[] = [];
		download.subscribe({ error: (err) => errors.push(err) });
		fail(new Error('offline'));
		await assert.rejects(download.done, /offline/);
		assert.equal(errors.length, 1);
	});

	it('stops telling an observer that unsubscribed', async () => {
		const { download, report } = manual();
		const seen:number[] = [];
		const sub = download.subscribe((p) => seen.push(p.progress));
		sub.unsubscribe();
		report(0.5);
		await tick();
		assert.deepEqual(seen, [0]);
		assert.equal(sub.closed, true);
	});

	it('is an interop Observable', () => {
		const { download } = manual();
		assert.equal(download['@@observable'](), download);
	});
});
