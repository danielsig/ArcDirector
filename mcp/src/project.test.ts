import assert from 'node:assert/strict';
import test from 'node:test';
import { projectEntries, type LogEntry } from './project.js';

const prompt = [
	'prompt',
	'```',
	'system',
	'```',
	'```',
	'user',
	'Sight.',
	'',
	'Short-term memory (later line wins):',
	'- heard a bell',
	'',
	'Last verb result: go_to ok',
	'In talking range: Mira.',
	'```',
	'```',
	'follow-up tool body',
	'```',
].join('\n');

const entries:LogEntry[] = [
	{ seq: 4, name: 'Mira', message: prompt, image: true },
	{ seq: 5, name: 'Mira', message: 'go_to(Well)' },
];

test('each pulls prompt sections and truncates replies', () => {
	const rows = projectEntries(entries, `
		entry.message.startsWith('prompt')
			? [take(/Short-term[\\s\\S]*?\\n\\n/), take(/Last verb result:.*/), take(/In talking range:.*/), entry.message.split('\`\`\`').slice(5).join('|').slice(0, 600)].filter(Boolean).join('\\n')
			: entry.message.slice(0, 2500)
	`) as Array<{ seq:number; text:string }>;
	assert.equal(rows.length, 2);
	assert.match(rows[0].text, /Short-term memory/);
	assert.match(rows[0].text, /heard a bell/);
	assert.match(rows[0].text, /Last verb result: go_to ok/);
	assert.match(rows[0].text, /In talking range: Mira/);
	assert.match(rows[0].text, /follow-up tool body/);
	assert.equal(rows[1].text, 'go_to(Well)');
	assert.equal(rows[0].seq, 4);
});

test('null drops the row and objects pass through', () => {
	const rows = projectEntries(entries, 'entry.seq === 5 ? { seq: entry.seq, verb: entry.message } : null') as Array<{ verb:string }>;
	assert.deepEqual(rows, [{ seq: 5, verb: 'go_to(Well)' }]);
});

test('a bad expression names the row', () => {
	assert.throws(() => projectEntries(entries, 'entry.missing()'), /each on #4/);
});
