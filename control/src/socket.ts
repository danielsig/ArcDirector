export type HubSocket = {
	/** Throws once the socket is closed, so callers fail fast instead of waiting for a reply. */
	send(data:string):void;
	close():void;
	onMessage(fn:(data:string)=>void):void;
	onClose(fn:()=>void):void;
};

export function pairSockets():[HubSocket, HubSocket] {
	const a = new MemorySocket();
	const b = new MemorySocket();
	a.peer = b;
	b.peer = a;
	return [a, b];
}

class MemorySocket implements HubSocket {
	public peer:MemorySocket | null = null;
	private _closed = false;
	private readonly _messages:Array<(data:string)=>void> = [];
	private readonly _closes:Array<()=>void> = [];

	public send(data:string):void {
		if (this._closed) {
			throw new Error('hub socket closed');
		}
		queueMicrotask(() => {
			this.peer?.emitMessage(data);
		});
	}

	public close():void {
		if (this._closed) {
			return;
		}
		this._closed = true;
		const peer = this.peer;
		this.peer = null;
		for (const fn of this._closes) {
			fn();
		}
		peer?.close();
	}

	public onMessage(fn:(data:string)=>void):void {
		this._messages.push(fn);
	}

	public onClose(fn:()=>void):void {
		this._closes.push(fn);
	}

	private emitMessage(data:string):void {
		if (this._closed) {
			return;
		}
		for (const fn of this._messages) {
			fn(data);
		}
	}
}
