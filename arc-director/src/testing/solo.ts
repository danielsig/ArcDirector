import { Character, type CharacterJSON, type CharacterOptions } from '../character/character.js';
import { Persona, type PersonaSpec } from '../character/persona.js';
import { Mind, type MindDeps, type MindSettings } from '../mind/mind.js';

export type SoloOptions<TCtx> = CharacterOptions<TCtx> & MindDeps<TCtx> & PersonaSpec & MindSettings;

/**
 * A character with a mind of its own, wired without a director: for tests and scripts. Its mind paces itself
 * (heartbeat 30 unless set), since no think queue does. `json` restores a saved character.
 */
export function soloCharacter<TCtx>(opts:SoloOptions<TCtx>, json?:CharacterJSON):Character<TCtx> {
	const persona = opts.persona ?? (json ? Persona.fromJSON(json.persona, opts) : new Persona(opts));
	const character = new Character<TCtx>({ ...opts, persona });
	if (json) {
		character.load(json);
	}
	const mind = json?.mind ? Mind.fromJSON<TCtx>(json.mind) : new Mind<TCtx>({ heartbeat: 30, ...opts });
	character.ownMind = mind;
	mind.attach(character, opts);
	opts.talk?.attach({ id: character.id, nameOf: (id) => mind.nameOf(id), pushEvent: (event) => mind.pushEvent(event) });
	return character;
}
