import { Character, type CharacterJSON, type CharacterOptions } from '../character/Character.js';
import { Persona, type PersonaSpec } from '../character/Persona.js';
import { internalsOf } from '../internals.js';
import type { InferenceProvider } from '../inference/provider.js';
import { ModelSlots } from '../director/ModelSlots.js';
import { isVisionModel } from '../inference/models.js';
import { Mind, mindTools, type MindDeps, type MindModel, type MindSettings } from '../mind/mind.js';
import type { TalkFeature } from '../mind/TalkFeature.js';

/** What a solo character takes: its own options, its persona, its mind's settings and services, and the one model it thinks with. */
export type SoloOptions<TCtx> = Omit<CharacterOptions<TCtx>, 'talk'> & Omit<MindDeps<TCtx>, 'thinksWith'> & PersonaSpec & MindSettings
	& Partial<Omit<MindModel, 'run'>> & { provider:InferenceProvider; modelID?:string; talk?:TalkFeature<TCtx> };

/**
 * A character with a mind of its own, wired without a director: for tests and scripts. It has every mind's own tools
 * (`mindTools`) besides `tools`, and with `talk` its sense, tool and checks. `opts` stand in for a director's
 * layer of its mind's settings, and its model thinks unless `thinking` says not. Its mind paces itself (heartbeat 30
 * unless set), since no think queue does. `json` restores a saved character.
 */
export function soloCharacter<TCtx>(opts:SoloOptions<TCtx>, json?:CharacterJSON):Character<TCtx> {
	const persona = opts.persona ?? (json ? Persona.fromJSON(json.persona, opts) : new Persona(opts));
	const fail = ():never => {
		throw new Error('ArcDirector: a solo character has no director to move it');
	};
	const talk = opts.talk;
	const character = new Character<TCtx>({ ...opts, persona, talk: () => talk, wiring: { setMind: fail, setCollective: fail } });
	const fields = internalsOf(character);
	if (json) {
		fields.load(json);
	}
	const mind = json?.mind ? Mind.fromJSON<TCtx>(json.mind) : new Mind<TCtx>();
	fields.setMind(mind);
	const { provider, modelID = '', vision = isVisionModel(modelID), contextTokens, thinking = true, promptStyle = 'full', jsonOnly = false } = opts;
	const model:MindModel = { run: new ModelSlots(Infinity, 0).on(provider, modelID).run, vision, contextTokens, thinking, promptStyle, jsonOnly };
	const tools = { ...mindTools<TCtx>(), ...talk && { earshot: talk.tool }, ...opts.tools };
	internalsOf(mind).attach(character, { ...opts, tools, senses: { ...opts.senses, ...talk && { earshot: talk.earshot } }, features: [...opts.features ?? [], ...talk ? [talk] : []], thinksWith: () => model, defaults: { heartbeat: 30, ...opts } });
	talk?.attach(character);
	return character;
}
