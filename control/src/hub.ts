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
	private readonly _games = new Map<string, GameRow>();
	private readonly _reconnectWait = new Map<string, Array<()=>void>>();
	private _wss:WebSocketServer | null = null;
	private readonly _takeID = idCounter();

	public attach(session:string, socket:HubSocket, instance = ''):string {
		const requested = session.trim();
		if (!requested) {
			throw new Error('empty session');
		}
		const id = this.claim(requested, socket, instance);
		const prev = this._games.get(id);
		const row:GameRow = { socket, instance, pending: new Map() };
		this._games.set(id, row);
		const waiters = this._reconnectWait.get(id);
		if (waiters) {
			this._reconnectWait.delete(id);
			for (const fn of waiters) {
				fn();
			}
		}
		socket.onMessage((raw) => {
			if (this._games.get(id)?.socket !== socket) {
				return;
			}
			const msg = parseHubMsg(raw);
			if (msg?.kind === 'result') {
				settle(row.pending, msg);
			}
		});
		socket.onClose(() => {
			if (this._games.get(id)?.socket !== socket) {
				return;
			}
			this._games.delete(id);
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

	public async sessions():Promise<string[]> {
		return [...this._games.keys()];
	}

	public async call(session:string, command:Command, timeoutMs = COMMAND_TIMEOUT_MS):Promise<unknown> {
		const id = session.trim();
		const row = this._games.get(id);
		if (!row) {
			throw new Error(`no client ${id}`);
		}
		const sentTo = row.socket;
		const callID = this._takeID();
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

	public listen(port = HUB_PORT, host = HUB_HOST):Promise<void> {
		return new Promise((resolve, reject) => {
			const wss = new WebSocketServer({ host, port });
			this._wss = wss;
			wss.once('error', (err) => {
				this._wss = null;
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

	public close():void {
		for (const row of this._games.values()) {
			row.socket.close();
		}
		this._games.clear();
		// ws keeps accepted sockets open after server close; drop peers so they rehost.
		for (const ws of this._wss?.clients ?? []) {
			ws.terminate();
		}
		this._wss?.close();
		this._wss = null;
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
		const prev = this._games.get(requested);
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
			if (!this._games.has(id)) {
				return id;
			}
			n += 1;
		}
	}

	private waitReconnect(session:string, timeoutMs:number, previous:HubSocket):Promise<void> {
		const live = this._games.get(session)?.socket;
		if (live && live !== previous) {
			return Promise.resolve();
		}
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				const waiters = this._reconnectWait.get(session);
				if (waiters) {
					this._reconnectWait.set(session, waiters.filter((w) => w !== onHello));
				}
				reject(new Error('timed out waiting for the client to reconnect'));
			}, timeoutMs);
			const onHello = ():void => {
				clearTimeout(timer);
				resolve();
			};
			const list = this._reconnectWait.get(session) ?? [];
			list.push(onHello);
			this._reconnectWait.set(session, list);
		});
	}
}

class HubPeer implements HubHandle {
	private readonly _takeID = idCounter();
	private readonly _pending:Pending = new Map();

	constructor(private readonly _socket:HubSocket, onLost:()=>void) {
		_socket.onMessage((raw) => {
			const msg = parseHubMsg(raw);
			if (msg?.kind === 'rpcResult') {
				settle(this._pending, msg);
			}
		});
		_socket.onClose(() => {
			rejectAll(this._pending, 'hub disconnected');
			onLost();
		});
	}

	public async sessions():Promise<string[]> {
		const result = await this.rpc({ kind: 'rpc', id: this._takeID(), method: 'list' }, LIST_TIMEOUT_MS);
		if (!Array.isArray(result)) {
			return [];
		}
		return result.filter((id):id is string => typeof id === 'string');
	}

	public call(session:string, command:Command, timeoutMs = COMMAND_TIMEOUT_MS):Promise<unknown> {
		return this.rpc({
			kind: 'rpc',
			id: this._takeID(),
			method: 'call',
			session,
			command,
		}, timeoutMs);
	}

	public close():void {
		this._socket.close();
	}

	private rpc(msg:RpcMsg, timeoutMs:number):Promise<unknown> {
		return waitReply(this._pending, msg.id, () => {
			this._socket.send(encode(msg));
		}, timeoutMs);
	}
}

/**
 * One hub per port, shared by every MCP process. The first process hosts; the rest join as peers.
 * When the host goes away, each peer tries to host again, else rejoins, so no process is left orphaned.
 */
class HubLink implements HubHandle {
	private _live:Promise<HubHandle>;
	private _closed = false;

	constructor(private readonly _port:number) {
		this._live = this.open();
	}

	public async sessions():Promise<string[]> {
		return (await this.handle()).sessions();
	}

	public async call(session:string, command:Command, timeoutMs?:number):Promise<unknown> {
		return (await this.handle()).call(session, command, timeoutMs);
	}

	public close():void {
		this._closed = true;
		this._live.then((hub) => {
			hub.close();
		}, () => undefined);
	}

	private open():Promise<HubHandle> {
		const live = hostOrJoin(this._port, () => {
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
		if (!this._closed && this._live === stale) {
			this._live = this.open();
		}
	}

	private async handle():Promise<HubHandle> {
		const live = this._live;
		try {
			return await live;
		}
		catch {
			this.reopen(live);
			return this._live;
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
