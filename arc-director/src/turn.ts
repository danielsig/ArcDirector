/** A browser's message port, as far as {@link nextTurn} uses it (the library builds without the DOM's types). */
type Port = { onmessage:(()=>void) | null; postMessage(message:unknown):void };

/** Who waits on the browser's channel, oldest first. */
const waiting:(()=>void)[] = [];
let channel:{ port1:Port; port2:Port } | undefined;

/**
 * One turn of the event loop, so whatever the last one woke runs first. Unlike `setTimeout(0)`, never clamped (a few
 * milliseconds a call, more on Windows) nor throttled in a background tab: `setImmediate` in Node, a
 * `MessageChannel` message in a browser.
 */
export function nextTurn():Promise<void> {
	return new Promise((resolve) => {
		if (typeof setImmediate === 'function') {
			setImmediate(resolve);
			return;
		}
		if (!channel) {
			channel = new MessageChannel() as unknown as { port1:Port; port2:Port };
			channel.port1.onmessage = () => waiting.shift()?.();
		}
		waiting.push(resolve);
		channel.port2.postMessage(undefined);
	});
}
