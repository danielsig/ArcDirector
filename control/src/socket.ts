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
	peer:MemorySocket | null = null;
	private closed = false;
	private readonly messages:Array<(data:string)=>void> = [];
	private readonly closes:Array<()=>void> = [];

	send(data:string):void {
		if (this.closed) {
			throw new Error('hub socket closed');
		}
		queueMicrotask(() => {
			this.peer?.emitMessage(data);
		});
	}

	close():void {
		if (this.closed) {
			return;
		}
		this.closed = true;
		const peer = this.peer;
		this.peer = null;
		for (const fn of this.closes) {
			fn();
		}
		peer?.close();
	}

	onMessage(fn:(data:string)=>void):void {
		this.messages.push(fn);
	}

	onClose(fn:()=>void):void {
		this.closes.push(fn);
	}

	private emitMessage(data:string):void {
		if (this.closed) {
			return;
		}
		for (const fn of this.messages) {
			fn(data);
		}
	}
}
