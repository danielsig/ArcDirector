import type { Voice } from './types.js';

export type InstrumentEnvelope = 'percussive' | 'sustaining';

export type InstrumentPlay = (
	ctx:AudioContext,
	dest:AudioNode,
	noise:AudioBuffer,
	when:number,
	midi:number,
	durSec:number,
	gain:number,
	voice:Voice,
)=>void;

type Registered = {
	envelope:InstrumentEnvelope;
	play:InstrumentPlay;
};

const registry = new Map<string, Registered>();

/**
 * Register (or replace) an instrument. Returns `{ instrument }` for `track()`.
 * `percussive` locks loudness at attack. `sustaining` lets a dim/cres turn the
 * volume on a note that is already playing.
 */
export function registerInstrument<K extends string>(
	name:K,
	envelope:InstrumentEnvelope,
	play:InstrumentPlay,
):{ instrument:K } {
	if (!name.trim()) {
		throw new Error('registerInstrument: empty name');
	}
	if (envelope !== 'percussive' && envelope !== 'sustaining') {
		throw new Error(`registerInstrument: ${name} envelope`);
	}
	registry.set(name, { envelope, play });
	return { instrument: name };
}

export function instrumentOf(name:string):Registered | undefined {
	return registry.get(name);
}
