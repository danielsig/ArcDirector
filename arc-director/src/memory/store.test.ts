import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { hashEmbed } from '../inference/fake.js';
import { FORGETFULNESS, FORGOTTEN, MemoryPool, MemoryStore, recallChance, type MemoryRecord } from './store.js';
import { internalsOf } from '../internals.js';

const HOUR = 3_600;
const DAY = 24 * HOUR;
/** A day of memory: a day of time, as fast as a memory forgets by default. */
const MEMORY_DAY = DAY / FORGETFULNESS;
/** `actual` within rounding of `expected`. */
const near = (actual:number, expected:number, message?:string):void => assert.ok(Math.abs(actual - expected) < 1e-9, message ?? `${actual} is not ${expected}`);

describe('MemoryPool', () => {
	/** Bob and Ann on their own, and hive Street that thinks for both. */
	function street() {
		const pool = new MemoryPool();
		return { pool, bob: pool.view('Bob'), ann: pool.view('Ann'), hive: pool.view('Street', () => ['Street', 'Bob', 'Ann']) };
	}

	it('keeps an event once, known by each who took it in; each view reads what its holders know', () => {
		const { bob, ann, hive } = street();
		// Taken in as events are: the same text at the same time is one record.
		internalsOf(bob).perceive({ text: ['Joe says: the key is under the stone'], timestamp: 3 });
		internalsOf(ann).perceive({ text: ['Joe says: the key is under the stone'], timestamp: 3 });
		internalsOf(ann).perceive({ text: ['The bell rang'], timestamp: 4 });
		ann.add({ text: 'The bell rang', timestamp: 4 });
		assert.deepEqual(hive.all().map((r) => [r.text, r.knownBy]), [['Joe says: the key is under the stone', ['Bob', 'Ann']], ['The bell rang', ['Ann']], ['The bell rang', ['Ann']]], 'a note added is its own record');
		assert.deepEqual(bob.all().map((r) => r.text), ['Joe says: the key is under the stone']);
		assert.deepEqual(hive.recall({ query: 'bell rang' }).map((r) => r.text), ['The bell rang', 'The bell rang'], 'a collective recalls what its characters know');
	});

	it('pins only its owner\'s own, forgets for its holders alone, and copies what others know before a rewrite', () => {
		const { bob, ann, hive } = street();
		bob.add({ text: 'You are a cobbler', pinned: true });
		hive.add({ text: 'We hold Mill Street', pinned: true });
		assert.deepEqual(hive.pinned().map((r) => r.text), ['We hold Mill Street']);
		assert.deepEqual(bob.pinned().map((r) => r.text), ['You are a cobbler']);
		const seen = bob.add({ text: 'Last saw Joe by the well', knownBy: ['Bob', 'Ann'] });
		const moved = bob.rewrite(seen.id, 'Last saw Joe by the mill')!;
		assert.notEqual(moved.id, seen.id, 'Ann still knows the old one');
		assert.deepEqual(ann.all().filter((r) => r.text.startsWith('Last saw')).map((r) => r.text), ['Last saw Joe by the well']);
		assert.deepEqual(bob.all().filter((r) => r.text.startsWith('Last saw')).map((r) => r.text), ['Last saw Joe by the mill']);
		assert.equal(ann.remove(seen.id), true);
		assert.equal(hive.all().some((r) => r.id === seen.id), false, 'gone with its last holder');
	});

	it('caps each holder\'s plain episodic memories on its own', () => {
		const pool = new MemoryPool({ maxEpisodic: (holder) => (holder === 'Bob' ? 2 : 256) });
		const [bob, ann] = [pool.view('Bob'), pool.view('Ann')];
		for (let t = 0; t < 3; t++) {
			bob.add({ text: `Bob and Ann saw cart ${t}`, knownBy: ['Bob', 'Ann'], timestamp: t });
		}
		assert.deepEqual(bob.all().map((r) => r.text), ['Bob and Ann saw cart 1', 'Bob and Ann saw cart 2']);
		assert.equal(ann.all().length, 3, 'Ann keeps her own, under her own cap');
		assert.equal(ann.maxEpisodic, 256);
	});
});

describe('MemoryStore', () => {
	it('recalls the newer of memories as relevant, newest first', () => {
		const store = new MemoryStore('Me');
		for (let round = 1; round <= 8; round++) {
			store.add({ text: `Round ${round} at the Mill.`, tags: ['Mill'], timestamp: round });
		}
		assert.deepEqual(store.recall({ query: 'Mill', k: 3 }).map((r) => r.text), ['Round 8 at the Mill.', 'Round 7 at the Mill.', 'Round 6 at the Mill.']);
	});

	it('brings to mind memories of what is before you, most of what stands closest', () => {
		const store = new MemoryStore('Me');
		store.add({ text: 'Hilde asked me for 2 Wool and 1 Thatch.', tags: ['Hilde', 'Wool'] });
		store.add({ text: 'I gave Hilde the 2 Wool. She still needs the Thatch.', tags: ['Hilde'] });
		store.add({ text: 'Mattis owes me a favor.', tags: ['Mattis'] });
		store.add({ text: 'Godric said the roads are muddy.', tags: ['Godric'] });
		const query = 'Finish the jobs people asked of you';
		assert.deepEqual(store.recall({ query, k: 2 }).map((r) => r.text), ['Hilde asked me for 2 Wool and 1 Thatch.'], 'the goal alone finds only the request');
		const before = store.recall({ query, k: 2, salience: new Map([['Hilde', 0.8], ['Mattis', 0.1]]) }).map((r) => r.text);
		assert.deepEqual(before, ['Hilde asked me for 2 Wool and 1 Thatch.', 'I gave Hilde the 2 Wool. She still needs the Thatch.']);
	});

	it('recalls by tag overlap without embeddings', () => {
		const store = new MemoryStore('Me');
		store.add({ text: 'a merchant in a red sash', tags: ['sash', 'red'], timestamp: 1 });
		store.add({ text: 'damp stone', tags: ['hall'], timestamp: 2 });
		const hit = store.recall({ query: 'the red sash', tags: ['sash'], k: 1 });
		assert.equal(hit.length, 1);
		assert.equal(hit[0].text, 'a merchant in a red sash');
	});

	it('skips records the caller already shows before taking the top k', () => {
		const store = new MemoryStore('Me');
		store.add({ text: 'Keeper says: the bridge costs 10 gold', tags: ['bridge'], timestamp: 2 });
		store.add({ text: 'Angler is across the bridge', tags: ['bridge'], timestamp: 1 });
		const hit = store.recall({ query: 'Keeper says: the bridge costs 10 gold', k: 1, skip: (r) => r.text.startsWith('Keeper') });
		assert.deepEqual(hit.map((r) => r.text), ['Angler is across the bridge']);
	});

	it('never brings a pinned memory to mind unbidden: it is in every prompt already', () => {
		const store = new MemoryStore('Me');
		store.add({ text: 'I am the canal-marketplace hive', tags: ['marketplace'], pinned: true, timestamp: 1 });
		assert.equal(store.intrusion({ query: 'the canal marketplace hive', tags: ['marketplace'], threshold: 0 }), null);
		store.add({ text: 'A thief ran through the canal marketplace', tags: ['marketplace'], timestamp: 1 });
		assert.equal(store.intrusion({ query: 'the canal marketplace hive', tags: ['marketplace'], threshold: 0 })?.text, 'A thief ran through the canal marketplace');
	});

	it('recalls by cosine when embeddings exist', () => {
		const store = new MemoryStore('Me');
		store.add({
			text: 'EastGate is the door in the east wall',
			tags: ['gate'],
			timestamp: 1,
			embedding: hashEmbed('EastGate is the door in the east wall'),
		});
		store.add({
			text: 'I like soup',
			tags: ['food'],
			timestamp: 1,
			embedding: hashEmbed('I like soup'),
		});
		const hit = store.recall({
			query: 'where is the gate',
			k: 1,
			embedding: hashEmbed('EastGate is the door in the east wall'),
			baseline: 0,
		});
		assert.equal(hit[0].text.includes('EastGate'), true);
	});

	it('brings a heavy memory to mind more readily, and unbidden on meaning alone', () => {
		const store = new MemoryStore('Me');
		const flames = [1, 0, 0];
		store.add({ text: 'The fire took my brother.', timestamp: 1, embedding: [0.9, 0.1, 0], weight: 3 });
		store.add({ text: 'My cousin stole the cart.', timestamp: 2, embedding: [0.9, 0.1, 0] });
		const unbidden = (embedding?:number[]):string | undefined => store.intrusion(embedding ? { query: 'Flames rise from the barn', embedding, baseline: 0 } : { query: 'Flames rise from the barn' })?.text;
		assert.equal(unbidden(flames), 'The fire took my brother.', 'shares no word with what is seen: only the heavy one comes');
		assert.equal(unbidden(), undefined, 'without meaning, nothing to go on');
		store.add({ text: 'The barn smells of hay.', timestamp: 3 });
		store.add({ text: 'The barn burned down once.', timestamp: 4, weight: 2 });
		assert.deepEqual(store.recall({ query: 'barn', k: 1 }).map((r) => r.text), ['The barn burned down once.'], 'the heavier of two that match alike');
	});

	it('evicts oldest unpinned episodic over cap', () => {
		const store = new MemoryPool({ maxEpisodic: () => 2 }).view('Me');
		store.add({ text: 'old', timestamp: 1 });
		store.add({ text: 'keep me', timestamp: 2, pinned: true });
		store.add({ text: 'mid', timestamp: 3 });
		store.add({ text: 'new', timestamp: 4 });
		const texts = store.all().map((r) => r.text).sort();
		assert.deepEqual(texts, ['keep me', 'mid', 'new']);
	});

	it('keeps those likeliest to come back over its cap: a memory used outlasts newer ones left alone', () => {
		let forgetfulness = 1;
		const store = new MemoryPool({ maxEpisodic: () => 3, forgetfulness: () => forgetfulness }).view('Me');
		const errand = store.add({ text: 'Runa asked me to fetch salt.', timestamp: 0 });
		store.add({ text: 'A crow flew by.', timestamp: HOUR }, HOUR);
		store.add({ text: 'It rained.', timestamp: 2 * HOUR }, 2 * HOUR);
		store.used([errand], 3 * HOUR);
		store.add({ text: 'A cart passed.', timestamp: 4 * HOUR }, 4 * HOUR);
		assert.deepEqual(store.all().map((r) => r.text), ['Runa asked me to fetch salt.', 'It rained.', 'A cart passed.']);
		forgetfulness = 0;
		store.add({ text: 'A dog barked.', timestamp: 5 * HOUR }, 5 * HOUR);
		assert.deepEqual(store.all().map((r) => r.text), ['Runa asked me to fetch salt.', 'A cart passed.', 'A dog barked.'], 'forgetting nothing, the least lasting, then the oldest, go');
	});

	it('fades as people forget: 90% at its stability, then ever more slowly, longer when heavy or a fact, a pinned one never', () => {
		const at = (draft:Partial<MemoryRecord>, days:number, forgetfulness?:number):number => recallChance({ ...new MemoryStore('Me').add({ text: 'x', timestamp: 0 }), ...draft }, days * MEMORY_DAY, forgetfulness);
		near(at({}, 1), 0.9, 'an episode: a day');
		near(at({ weight: 2 }, 2), 0.9);
		near(at({ category: 'semantic' }, 4), 0.9, 'a fact: four days');
		near(at({}, 0.5, 2 * FORGETFULNESS), 0.9, 'twice as forgetful: half the time');
		near(at({ stability: 3, usedAt: MEMORY_DAY }, 4), 0.9, 'from its last use');
		assert.ok(at({}, 10) > 0.5 && at({}, 60) > FORGOTTEN && at({}, 70) < FORGOTTEN, 'half after ten days, forgotten after about two months');
		assert.equal(at({ pinned: true }, 900), 1);
		assert.equal(at({}, 900, 0), 1);
	});

	it('makes a used memory last longer, the more so the further it had faded, next to nothing when used again at once', () => {
		const store = new MemoryStore('Me');
		const salt = store.add({ text: 'Runa asked me to fetch salt.', timestamp: 0 });
		store.used([salt], MEMORY_DAY);
		assert.equal(salt.usedAt, MEMORY_DAY);
		near(salt.stability!, 2.5, '90% likely: two and a half times as lasting');
		store.used([salt], MEMORY_DAY + MEMORY_DAY / 1440);
		assert.ok(salt.stability! < 2.51, 'a minute of memory on');
		// A vow brought to mind weekly for a year is still likely after five years of never thinking of it.
		const vow = store.add({ text: 'I married Bram.', timestamp: 0, weight: 3 });
		for (let week = 1; week <= 52; week++) {
			store.used([vow], week * 7 * MEMORY_DAY);
		}
		assert.ok(store.recallChanceOf(vow, 52 * 7 * MEMORY_DAY + 5 * 365 * MEMORY_DAY) > 0.75, `${store.recallChanceOf(vow, 52 * 7 * MEMORY_DAY + 5 * 365 * MEMORY_DAY)}`);
	});

	it('forgets what faded, folds memories told alike into the newest, as lasting as all of them', () => {
		const store = new MemoryStore('Me');
		store.add({ text: 'Old news.', timestamp: 0 });
		store.add({ text: 'I am a farmer.', timestamp: 0, pinned: true });
		for (const hour of [20, 21, 22]) {
			store.add({ text: 'Sold 2 Turnips to Aldous.', tags: [`h${hour}`], timestamp: 69 * DAY + hour * HOUR }, 69 * DAY + hour * HOUR);
		}
		store.forgetFaded(70 * DAY);
		assert.deepEqual(store.all().map((r) => r.text), ['I am a farmer.', 'Sold 2 Turnips to Aldous.']);
		const [, sold] = store.all();
		assert.equal(sold.timestamp, 69 * DAY + 22 * HOUR);
		assert.deepEqual(sold.tags, ['h22', 'h21', 'h20']);
		assert.equal(sold.stability, 3);
	});

	it('forgets for each holder at its own forgetfulness', () => {
		const pool = new MemoryPool({ forgetfulness: (holder) => (holder === 'Bob' ? 0 : 1) });
		const hive = pool.view('Street', () => ['Street', 'Bob', 'Ann']);
		const seen = hive.add({ text: 'Joe walked by.', knownBy: ['Bob', 'Ann'], timestamp: 0 });
		hive.forgetFaded(70 * DAY);
		assert.deepEqual(seen.knownBy, ['Bob'], 'Ann forgot it; Bob forgets nothing');
		const far = pool.view('Cy');
		far.add({ text: 'A cart passed.', timestamp: 0 });
		pool.forgetFaded(70 * DAY);
		assert.deepEqual(far.all(), [], 'the whole pool: one far off, whom no view asked, too');
	});

	it('keeps with each memory what each who takes it in feels then, or what its draft is steeped in', () => {
		const pool = new MemoryPool({ feelings: (holder) => (holder === 'Ann' ? { sad: 0.7, happy: 0.1 } : undefined) });
		const eggs = pool.view('Ann').add({ text: 'I dropped the eggs.', knownBy: ['Ann', 'Bob'] });
		assert.deepEqual(eggs.felt, { Ann: { sad: 0.7 } }, 'a faint feeling is not kept, nor a holder who felt nothing');
		const gift = pool.view('Bob').add({ text: 'A gift, out of the blue.', feelings: { happy: 0.9, surprised: 0.6 } });
		assert.deepEqual(gift.felt, { Bob: { happy: 0.9, surprised: 0.6 } });
	});

	it('feels toward each one its memories name what it felt in them, on average, fading as they fade, its own only', () => {
		const pool = new MemoryPool();
		const ann = pool.view('Ann');
		ann.add({ text: (name) => `${name('Bram')} saved my life.`, feelings: { loving: 1 }, weight: 2, timestamp: 0 });
		ann.add({ text: (name) => `${name('Bram')} and I went fishing.`, feelings: { happy: 0.6 }, timestamp: 0 });
		ann.add({ text: (name) => `${name('Bram')} walked by.`, timestamp: 0 });
		ann.add({ text: (name) => `I dropped a whole basket of ${name('Eggs')}.`, feelings: { sad: 0.8 }, timestamp: 0 });
		ann.add({ text: 'Odo sold me Boots.', tags: ['Odo', 'Boots'], feelings: { happy: 0.5 }, timestamp: 0 });
		const toward = ann.feelingsToward(0);
		assert.deepEqual([...toward.keys()].sort(), ['Bram', 'Eggs'], 'by the ids its text names, never by a tag');
		near(toward.get('Bram')!.loving, 2 / 3, 'the heavy one counts twice; one with no feeling counts not at all');
		near(toward.get('Bram')!.happy, 0.2);
		near(ann.feelingsToward(3 / (19 / 81) * MEMORY_DAY).get('Eggs')!.sad, 0.4, 'a lone memory, half as likely to come back');
		assert.deepEqual(pool.view('Bram').feelingsToward(0).size, 0, 'he holds none of it');
	});

	it('brings a memory used lately to mind unbidden less readily, and as readily again five minutes on', () => {
		const store = new MemoryStore('Me');
		const drowned = store.add({ text: 'I nearly drowned in the Well.', tags: ['Well'], timestamp: 0 });
		const water = store.add({ text: 'I fetched water from the Well.', tags: ['Well'], timestamp: 0 });
		const comes = (now:number):MemoryRecord | null => store.intrusion({ query: 'Well', now, threshold: 0 });
		assert.equal(comes(100), drowned, 'of two alike, the first');
		store.used([drowned], 100);
		assert.equal(comes(145), water, 'the other, while the first comes back');
		assert.equal(comes(400), drowned, 'come back');
	});

	it('brings to mind more readily a memory naming one who matters to it', () => {
		const store = new MemoryStore('Me');
		store.add({ text: 'Bram fixed the fence by the well.', timestamp: 1 });
		store.add({ text: 'Odo fixed the gate by the well.', timestamp: 2 });
		assert.deepEqual(store.recall({ query: 'well', k: 1 }).map((r) => r.text), ['Odo fixed the gate by the well.'], 'the newer of two alike');
		assert.deepEqual(store.recall({ query: 'well', k: 1, bonds: { Bram: 2 } }).map((r) => r.text), ['Bram fixed the fence by the well.']);
	});

	it('recalls by lexical overlap without embeddings or matching tags', () => {
		const store = new MemoryStore('Me');
		store.add({
			text: 'BridgeKeeper says the bridge fee is FireMushroom.',
			tags: ['speech'],
			timestamp: 1,
		});
		store.add({ text: 'I like soup', tags: ['food'], timestamp: 2 });
		const hit = store.recall({ query: 'Trade FireMushroom for SilverTrout', k: 1 });
		assert.equal(hit.length, 1);
		assert.equal(hit[0].text.includes('FireMushroom'), true);
	});

	it('removes and rewrites a record by id', () => {
		const store = new MemoryStore('Me');
		const kept = store.add({ text: 'Dawn leads us', embedding: [1, 0] });
		const gone = store.add({ text: 'Dusk is the enemy' });
		assert.equal(store.remove(gone.id), true);
		assert.equal(store.remove(gone.id), false);
		assert.deepEqual(store.rewrite(kept.id, 'Dawn led us')?.text, 'Dawn led us');
		assert.equal(kept.embedding, undefined);
		assert.equal(store.rewrite('mem_99', 'x'), undefined);
		assert.deepEqual(store.all().map((r) => r.text), ['Dawn led us']);
	});

	it('keeps a memory pinned for as many thinks as it was told, and after that recall still finds it', () => {
		const store = new MemoryStore('Me');
		store.add({ text: 'I live in Hut.', tags: ['Hut'], pinned: true });
		store.add({ text: 'Goal reached: bought Bread.', tags: ['goal', 'Bread'], pinned: true, pinnedThinks: 2 });
		store.agePins();
		assert.equal(store.pinned().length, 2);
		store.agePins();
		assert.deepEqual(store.pinned().map((r) => r.text), ['I live in Hut.'], 'the one for good stays');
		assert.deepEqual(store.recall({ query: 'Bread', k: 1 }).map((r) => r.text), ['Goal reached: bought Bread.']);
	});
});
