import { Character, type CharacterJSON, type CharacterOptions } from '../character/Character.js';
import { Persona, type PersonaSpec } from '../character/Persona.js';
import { internalsOf } from '../internals.js';
import type { InferenceProvider } from '../inference/provider.js';
import { Mind, type MindDeps, type MindModel, type MindSettings } from '../mind/mind.js';

/** What a solo character takes: its own options, its persona, its mind's settings and services, and the one model it thinks with. */
export type SoloOptions<TCtx> = CharacterOptions<TCtx> & Omit<MindDeps<TCtx>, 'thinksWith'> & PersonaSpec & MindSettings
	& Partial<Omit<MindModel, 'id'>> & { provider:InferenceProvider; modelID?:string };

/**
 * A character with a mind of its own, wired without a director: for tests and scripts. `opts` stand in for a director's
 * layer of its mind's settings, and its model thinks unless `thinking` says not. Its mind paces itself (heartbeat 30
 * unless set), since no think queue does. `json` restores a saved character.
 */
export function soloCharacter<TCtx>(opts:SoloOptions<TCtx>, json?:CharacterJSON):Character<TCtx> {
	const persona = opts.persona ?? (json ? Persona.fromJSON(json.persona, opts) : new Persona(opts));
	const fail = ():never => {
		throw new Error('ArcDirector: a solo character has no director to move it');
	};
	const character = new Character<TCtx>({ ...opts, persona, wiring: { setMind: fail, setCollective: fail } });
	const fields = internalsOf(character);
	if (json) {
		fields.load(json);
	}
	const mind = json?.mind ? Mind.fromJSON<TCtx>(json.mind) : new Mind<TCtx>();
	fields.setMind(mind);
	const { provider, modelID = '', vision, contextTokens, thinking = true, promptStyle = 'full', jsonOnly = false } = opts;
	const model:MindModel = { provider, id: modelID, vision, contextTokens, thinking, promptStyle, jsonOnly };
	internalsOf(mind).attach(character, { ...opts, thinksWith: () => model, defaults: { heartbeat: 30, ...opts } });
	opts.talk?.attach(character);
	return character;
}
