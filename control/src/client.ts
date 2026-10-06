import {
	encode,
	errorText,
	parseHubMsg,
	hubWSURL,
	REOPEN_MS,
	type CallMsg,
	type Command,
	type HubMsg,
} from './protocol.js';

export type ControlDispatch = (command:Command)=>Promise<unknown>;

export type ControlLink = {
	close():void;
};

type WindowHost = {
	arcControl?:ControlDispatch;
};

function host():WindowHost {
	return window as unknown as WindowHost;
}

export function installArcControl(dispatch:ControlDispatch):void {
	host().arcControl = dispatch;
}

export function clearArcControl(dispatch?:ControlDispatch):void {
	const w = host();
	if (!dispatch || w.arcControl === dispatch) {
		w.arcControl = undefined;
	}
}

export function connectControl(opts:{
	session:string;
	dispatch:ControlDispatch;
	url?:string;
	onSession?:(session:string)=>void;
}):ControlLink {
	const url = opts.url ?? hubWSURL();
	let socket:WebSocket | null = null;
	let closed = false;
	let timer:ReturnType<typeof setTimeout> | undefined;
	let session = opts.session.trim();
	const instance = tabInstance();

	const open = ():void => {
		if (closed || !session) {
			return;
		}
		const ws = new WebSocket(url);
		socket = ws;
		ws.addEventListener('open', () => {
			if (socket !== ws) {
				return;
			}
			ws.send(encode({ kind: 'hello', session, instance }));
		});
		ws.addEventListener('message', (ev) => {
			if (socket !== ws) {
				return;
			}
			const msg = parseHubMsg(String(ev.data));
			if (!msg) {
				return;
			}
			handleHub(ws, msg, opts.dispatch, (assigned) => {
				if (assigned === session) {
					return;
				}
				session = assigned;
				opts.onSession?.(assigned);
			});
		});
		ws.addEventListener('close', () => {
			if (closed || socket !== ws) {
				return;
			}
			socket = null;
			timer = setTimeout(open, REOPEN_MS);
		});
		ws.addEventListener('error', () => {
			ws.close();
		});
	};

	open();
	return {
		close():void {
			closed = true;
			if (timer !== undefined) {
				clearTimeout(timer);
			}
			socket?.close();
			socket = null;
		},
	};
}

function handleHub(
	ws:WebSocket,
	msg:HubMsg,
	dispatch:ControlDispatch,
	onSession:(session:string)=>void,
):void {
	if (msg.kind === 'session') {
		const assigned = msg.session.trim();
		if (assigned) {
			onSession(assigned);
		}
		return;
	}
	if (msg.kind === 'call') {
		void answer(ws, msg, dispatch);
	}
}

function tabInstance():string {
	try {
		const key = 'arcControl.instance';
		let id = sessionStorage.getItem(key);
		if (!id) {
			id = crypto.randomUUID();
			sessionStorage.setItem(key, id);
		}
		return id;
	}
	catch {
		return '';
	}
}

async function answer(ws:WebSocket, msg:CallMsg, dispatch:ControlDispatch):Promise<void> {
	try {
		const result = await dispatch(msg.command);
		if (ws.readyState !== WebSocket.OPEN) {
			return;
		}
		ws.send(encode({ kind: 'result', id: msg.id, ok: true, result }));
	}
	catch (err) {
		if (ws.readyState !== WebSocket.OPEN) {
			return;
		}
		ws.send(encode({
			kind: 'result',
			id: msg.id,
			ok: false,
			error: errorText(err),
		}));
	}
}
