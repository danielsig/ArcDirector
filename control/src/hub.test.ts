import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { encode, parseHubMsg, type Command } from './protocol.js';
import { SessionHub, openHub } from './hub.js';
import { pairSockets } from './socket.js';

function reply(gameSide:{ send:(data:string)=>void }, raw:string, result:unknown):void {
	const msg = parseHubMsg(raw);
	if (!msg || msg.kind !== 'call') {
		return;
	}
	gameSide.send(encode({ kind: 'result', id: msg.id, ok: true, result }));
}

describe('SessionHub', () => {
	it('call round-trips to the attached client', async () => {
		const hub = new SessionHub();
		const [hubSide, gameSide] = pairSockets();
		gameSide.onMessage((raw) => {
			reply(gameSide, raw, { actors: [{ id: 'Guard', kind: 'agent' }] });
		});
		hub.attach('alpha', hubSide);
		assert.deepEqual(await hub.sessions(), ['alpha']);
		const result = await hub.call('alpha', { op: 'listActors' });
		assert.deepEqual(result, { actors: [{ id: 'Guard', kind: 'agent' }] });
		hub.close();
	});

	it('renames a second live client instead of replacing the first', async () => {
		const hub = new SessionHub();
		const [firstHub, firstGame] = pairSockets();
		const [secondHub, secondGame] = pairSockets();
		let firstClosed = false;
		let assigned = '';
		firstGame.onClose(() => {
			firstClosed = true;
		});
		secondGame.onMessage((raw) => {
			const msg = parseHubMsg(raw);
			if (msg?.kind === 'session') {
				assigned = msg.session;
			}
			reply(secondGame, raw, 'ok');
		});
		assert.equal(hub.attach('alpha', firstHub, 'tab-a'), 'alpha');
		assert.equal(hub.attach('alpha', secondHub, 'tab-b'), 'alpha-2');
		await Promise.resolve();
		assert.equal(firstClosed, false);
		assert.equal(assigned, 'alpha-2');
		assert.deepEqual(await hub.sessions(), ['alpha', 'alpha-2']);
		assert.equal(await hub.call('alpha-2', { op: 'saveGame' } satisfies Command), 'ok');
		hub.close();
		secondGame.close();
		firstGame.close();
	});

	it('skips postfix ids that are already taken', async () => {
		const hub = new SessionHub();
		const [aHub] = pairSockets();
		const [bHub] = pairSockets();
		const [cHub] = pairSockets();
		hub.attach('alpha', aHub, 'tab-a');
		hub.attach('alpha-2', bHub, 'tab-b');
		assert.equal(hub.attach('alpha', cHub, 'tab-c'), 'alpha-3');
		hub.close();
	});

	it('replaces the old socket when the same tab reconnects', async () => {
		const hub = new SessionHub();
		const [firstHub, firstGame] = pairSockets();
		const [secondHub, secondGame] = pairSockets();
		let firstClosed = false;
		firstGame.onClose(() => {
			firstClosed = true;
		});
		assert.equal(hub.attach('alpha', firstHub, 'tab-a'), 'alpha');
		assert.equal(hub.attach('alpha', secondHub, 'tab-a'), 'alpha');
		assert.equal(firstClosed, true);
		secondGame.onMessage((raw) => {
			reply(secondGame, raw, 'ok');
		});
		assert.equal(await hub.call('alpha', { op: 'saveGame' } satisfies Command), 'ok');
		hub.close();
	});

	it('replaces the old socket when the same session connects again', async () => {
		const hub = new SessionHub();
		const [firstHub, firstGame] = pairSockets();
		const [secondHub, secondGame] = pairSockets();
		let firstClosed = false;
		firstGame.onClose(() => {
			firstClosed = true;
		});
		hub.attach('alpha', firstHub);
		hub.attach('alpha', secondHub);
		assert.equal(firstClosed, true);
		secondGame.onMessage((raw) => {
			reply(secondGame, raw, 'ok');
		});
		assert.equal(await hub.call('alpha', { op: 'saveGame' } satisfies Command), 'ok');
		hub.close();
	});

	it('waits for hello after a reconnect result', async () => {
		const hub = new SessionHub();
		const [firstHub, firstGame] = pairSockets();
		const [secondHub, secondGame] = pairSockets();
		firstGame.onMessage((raw) => {
			reply(firstGame, raw, { reconnect: true });
			queueMicrotask(() => {
				hub.attach('alpha', secondHub);
			});
		});
		secondGame.onMessage(() => undefined);
		hub.attach('alpha', firstHub);
		const result = await hub.call('alpha', { op: 'loadGame' });
		assert.deepEqual(result, { reconnected: true });
		assert.deepEqual(await hub.sessions(), ['alpha']);
		hub.close();
		secondGame.close();
	});
});

describe('openHub', () => {
	const port = 39_211;

	it('a peer takes over hosting when the host closes', async () => {
		const host = openHub(port);
		assert.deepEqual(await host.sessions(), []);
		const peer = openHub(port);
		assert.deepEqual(await peer.sessions(), []);
		host.close();
		await new Promise((resolve) => setTimeout(resolve, 100));
		assert.deepEqual(await peer.sessions(), []);
		const late = openHub(port);
		assert.deepEqual(await late.sessions(), []);
		late.close();
		peer.close();
	});
});
