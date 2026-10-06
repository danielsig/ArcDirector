import { WebSocketServer, WebSocket } from 'ws';
import {
	COMMAND_TIMEOUT_MS,
	HUB_HOST,
	HUB_PORT,
	LIST_TIMEOUT_MS,
	REOPEN_MS,
	encode,
	errorText,
	hubWSURL,
	isReconnectResult,
	isRecord,
	parseHubMsg,
	type Command,
	type ResultMsg,
	type RpcMsg,
	type RpcResultMsg,
} from './protocol.js';
import { type HubSocket } from './socket.js';

export type { HubSocket } from './socket.js';

export type HubHandle = {
	sessions():Promise<string[]>;
	call(session:string, command:Command, timeoutMs?:number):Promise<unknown>;
	close():void;
};

type Waiter = {
	resolve:(value:unknown)=>void;
	reject:(err:Error)=>void;
};

type Pending = Map<string, Waiter>;

type GameRow = {
	socket:HubSocket;
	instance:string;
	pending:Pending;
};

export class SessionHub implements HubHandle {
	private readonly games = new Map<string, GameRow>();
	private readonly reconnectWait = new Map<string, Array<()=>void>>();
	private wss:WebSocketServer | null = null;
	private readonly takeID = idCounter();

	attach(session:string, socket:HubSocket, instance = ''):string {
		const requested = session.trim();
		if (!requested) {
			throw new Error('empty session');
		}
		const id = this.claim(requested, socket, instance);
		const prev = this.games.get(id);
		const row:GameRow = { socket, instance, pending: new Map() };
		this.games.set(id, row);
		const waiters = this.reconnectWait.get(id);
		if (waiters) {
			this.reconnectWait.delete(id);
			for (const fn of waiters) {
				fn();
			}
		}
		socket.onMessage((raw) => {
			if (this.games.get(id)?.socket !== socket) {
				return;
			}
			const msg = parseHubMsg(raw);
			if (msg?.kind === 'result') {
				settle(row.pending, msg);
			}
		});
		socket.onClose(() => {
			if (this.games.get(id)?.socket !== socket) {
				return;
			}
			this.games.delete(id);
			rejectAll(row.pending, 'client disconnected');
		});
		if (prev && prev.socket !== socket) {
			rejectAll(prev.pending, 'session replaced');
			prev.socket.close();
		}
		if (id !== requested) {
			socket.send(encode({ kind: 'session', session: id }));
		}
		return id;
	}

	async sessions():Promise<string[]> {
		return [...this.games.keys()];
	}

	async call(session:string, command:Command, timeoutMs = COMMAND_TIMEOUT_MS):Promise<unknown> {
		const id = session.trim();
		const row = this.games.get(id);
		if (!row) {
			throw new Error(`no client ${id}`);
		}
		const sentTo = row.socket;
		const callID = this.takeID();
		const result = await waitReply(
			row.pending,
			callID,
			() => {
				row.socket.send(encode({ kind: 'call', id: callID, command }));
			},
			timeoutMs,
		);
		if (!isReconnectResult(result)) {
			return result;
		}
		await this.waitReconnect(id, timeoutMs, sentTo);
		return { reconnected: true };
	}

	listen(port = HUB_PORT, host = HUB_HOST):Promise<void> {
		return new Promise((resolve, reject) => {
			const wss = new WebSocketServer({ host, port });
			this.wss = wss;
			wss.once('error', (err) => {
				this.wss = null;
				reject(err);
			});
			wss.once('listening', () => {
				wss.removeAllListeners('error');
				wss.on('error', (err) => {
					console.error(err);
				});
				resolve();
			});
			wss.on('connection', (ws) => {
				this.bindWire(wrapWS(ws));
			});
		});
	}

	close():void {
		for (const row of this.games.values()) {
			row.socket.close();
		}
		this.games.clear();
		// ws keeps accepted sockets open after server close; drop peers so they rehost.
		for (const ws of this.wss?.clients ?? []) {
			ws.terminate();
		}
		this.wss?.close();
		this.wss = null;
	}

	private bindWire(socket:HubSocket):void {
		socket.onMessage((raw) => {
			const msg = parseHubMsg(raw);
			if (!msg) {
				return;
			}
			if (msg.kind === 'hello' && typeof msg.session === 'string') {
				const instance = typeof msg.instance === 'string' ? msg.instance.trim() : '';
				const requested = msg.session.trim();
				if (requested) {
					this.attach(requested, socket, instance);
				}
				return;
			}
			if (msg.kind === 'rpc') {
				void this.handleRpc(socket, msg);
			}
		});
	}

	private async handleRpc(socket:HubSocket, msg:RpcMsg):Promise<void> {
		let reply:RpcResultMsg;
		try {
			const result = msg.method === 'list'
				? await this.sessions()
				: await this.call(msg.session, msg.command);
			reply = { kind: 'rpcResult', id: msg.id, ok: true, result };
		}
		catch (err) {
			reply = { kind: 'rpcResult', id: msg.id, ok: false, error: errorText(err) };
		}
		try {
			socket.send(encode(reply));
		}
		catch {
			// The peer left while its call ran; nobody is waiting for the reply.
		}
	}

	private claim(requested:string, socket:HubSocket, instance:string):string {
		const prev = this.games.get(requested);
		if (!prev || prev.socket === socket) {
			return requested;
		}
		if (instance && prev.instance !== instance) {
			return this.nextSession(requested);
		}
		return requested;
	}

	private nextSession(base:string):string {
		let n = 2;
		for (;;) {
			const id = `${base}-${n}`;
			if (!this.games.has(id)) {
				return id;
			}
			n += 1;
		}
	}

	private waitReconnect(session:string, timeoutMs:number, previous:HubSocket):Promise<void> {
		const live = this.games.get(session)?.socket;
		if (live && live !== previous) {
			return Promise.resolve();
		}
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				const waiters = this.reconnectWait.get(session);
				if (waiters) {
					this.reconnectWait.set(session, waiters.filter((w) => w !== onHello));
				}
				reject(new Error('timed out waiting for the client to reconnect'));
			}, timeoutMs);
			const onHello = ():void => {
				clearTimeout(timer);
				resolve();
			};
			const list = this.reconnectWait.get(session) ?? [];
			list.push(onHello);
			this.reconnectWait.set(session, list);
		});
	}
}

class HubPeer implements HubHandle {
	private readonly takeID = idCounter();
	private readonly pending:Pending = new Map();

	constructor(private readonly socket:HubSocket, onLost:()=>void) {
		socket.onMessage((raw) => {
			const msg = parseHubMsg(raw);
			if (msg?.kind === 'rpcResult') {
				settle(this.pending, msg);
			}
		});
		socket.onClose(() => {
			rejectAll(this.pending, 'hub disconnected');
			onLost();
		});
	}

	async sessions():Promise<string[]> {
		const result = await this.rpc({ kind: 'rpc', id: this.takeID(), method: 'list' }, LIST_TIMEOUT_MS);
		if (!Array.isArray(result)) {
			return [];
		}
		return result.filter((id):id is string => typeof id === 'string');
	}

	call(session:string, command:Command, timeoutMs = COMMAND_TIMEOUT_MS):Promise<unknown> {
		return this.rpc({
			kind: 'rpc',
			id: this.takeID(),
			method: 'call',
			session,
			command,
		}, timeoutMs);
	}

	close():void {
		this.socket.close();
	}

	private rpc(msg:RpcMsg, timeoutMs:number):Promise<unknown> {
		return waitReply(this.pending, msg.id, () => {
			this.socket.send(encode(msg));
		}, timeoutMs);
	}
}

/**
 * One hub per port, shared by every MCP process. The first process hosts; the rest join as peers.
 * When the host goes away, each peer tries to host again, else rejoins, so no process is left orphaned.
 */
class HubLink implements HubHandle {
	private live:Promise<HubHandle>;
	private closed = false;

	constructor(private readonly port:number) {
		this.live = this.open();
	}

	async sessions():Promise<string[]> {
		return (await this.handle()).sessions();
	}

	async call(session:string, command:Command, timeoutMs?:number):Promise<unknown> {
		return (await this.handle()).call(session, command, timeoutMs);
	}

	close():void {
		this.closed = true;
		this.live.then((hub) => {
			hub.close();
		}, () => undefined);
	}

	private open():Promise<HubHandle> {
		const live = hostOrJoin(this.port, () => {
			this.reopen(live);
		});
		live.catch(() => {
			setTimeout(() => {
				this.reopen(live);
			}, REOPEN_MS).unref();
		});
		return live;
	}

	private reopen(stale:Promise<HubHandle>):void {
		if (!this.closed && this.live === stale) {
			this.live = this.open();
		}
	}

	private async handle():Promise<HubHandle> {
		const live = this.live;
		try {
			return await live;
		}
		catch {
			this.reopen(live);
			return this.live;
		}
	}
}

export function openHub(port = HUB_PORT):HubHandle {
	return new HubLink(port);
}

async function hostOrJoin(port:number, onLost:()=>void):Promise<HubHandle> {
	const hub = new SessionHub();
	try {
		await hub.listen(port);
		return hub;
	}
	catch (err) {
		if (!isAddrInUse(err)) {
			throw err;
		}
	}
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(hubWSURL(port));
		ws.once('error', reject);
		ws.once('open', () => {
			ws.removeListener('error', reject);
			ws.on('error', () => undefined);
			resolve(new HubPeer(wrapWS(ws), onLost));
		});
	});
}

function wrapWS(ws:WebSocket):HubSocket {
	return {
		send(data) {
			if (ws.readyState !== WebSocket.OPEN) {
				throw new Error('hub socket closed');
			}
			ws.send(data);
		},
		close() {
			ws.close();
		},
		onMessage(fn) {
			ws.on('message', (data:WebSocket.RawData) => {
				fn(String(data));
			});
		},
		onClose(fn) {
			ws.on('close', fn);
		},
	};
}

function idCounter():()=>string {
	let n = 0;
	return () => String(++n);
}

function isAddrInUse(err:unknown):boolean {
	return isRecord(err) && err.code === 'EADDRINUSE';
}

function settle(pending:Pending, msg:ResultMsg | RpcResultMsg):void {
	const waiter = pending.get(msg.id);
	if (!waiter) {
		return;
	}
	pending.delete(msg.id);
	if (msg.ok) {
		waiter.resolve(msg.result);
	}
	else {
		waiter.reject(new Error(msg.error));
	}
}

function rejectAll(pending:Pending, message:string):void {
	for (const [, waiter] of pending) {
		waiter.reject(new Error(message));
	}
	pending.clear();
}

function waitReply(
	pending:Pending,
	id:string,
	send:()=>void,
	timeoutMs:number,
):Promise<unknown> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			pending.delete(id);
			reject(new Error('timed out'));
		}, timeoutMs);
		pending.set(id, {
			resolve: (value) => {
				clearTimeout(timer);
				resolve(value);
			},
			reject: (err) => {
				clearTimeout(timer);
				reject(err);
			},
		});
		try {
			send();
		}
		catch (err) {
			clearTimeout(timer);
			pending.delete(id);
			reject(new Error(errorText(err)));
		}
	});
}
