import type { VerbDef } from '../arc/stock-verbs.js';
import type { VerbArgs, VerbHandler } from '../director/types.js';

/** How fighters fight, in an RPG and a MOBA alike. */
const FIGHT_VERB_DEFS = {
	attack: { args: { target: 'id?' } },
	block: { args: { target: 'id?' }, help: 'guard up against them, or the nearest enemy, for a moment' },
	heal: { args: { target: 'id?' } },
	protect: { args: { target: 'id?' }, help: 'stand between an ally and the threat, then attack that threat' },
} as const satisfies Record<string, VerbDef>;

/** An RPG's verbs: what characters wear and take, and how they fight. */
export const STOCK_RPG_VERB_DEFS = {
	equip: { args: { item: 'id', slot: 'string?' } },
	unequip: { args: { slot: 'string' } },
	steal: { args: { item: 'id', from: 'id' }, help: 'goes to them first' },
	...FIGHT_VERB_DEFS,
} as const satisfies Record<string, VerbDef>;

/** A MOBA's verbs: how its heroes fight, beside their abilities. */
export const STOCK_MOBA_VERB_DEFS = FIGHT_VERB_DEFS;

/** One of the game's own attacks and spells: a verb used on someone. */
const ABILITY_DEF = { args: { target: 'id' } } as const satisfies VerbDef;

/** A genre verb as the game runs it: its handler, or its handler and the help line the game's own rules call for. */
type GenreVerb<TCtx, TArgMap> = VerbHandler<TCtx, VerbArgs<TArgMap>> | { help?:string; handler:VerbHandler<TCtx, VerbArgs<TArgMap>> };

/** What a game gives `withRPG` or `withMOBA`: a handler for each of the genre's verbs it has, and its abilities. */
type GenreHost<TCtx, TDefs extends Readonly<Record<string, VerbDef>>> = {
	[TVerb in keyof TDefs]?:GenreVerb<TCtx, TDefs[TVerb]['args']>;
} & {
	/** The game's own attacks and spells, each its own verb used on someone: `hex(target)`, `cleave(target)`. */
	abilities?:Readonly<Record<string, GenreVerb<TCtx, typeof ABILITY_DEF.args>>>;
};

export type RPGHost<TCtx = unknown> = GenreHost<TCtx, typeof STOCK_RPG_VERB_DEFS>;
export type MOBAHost<TCtx = unknown> = GenreHost<TCtx, typeof STOCK_MOBA_VERB_DEFS>;

/** Any genre verb: a handler whose args the schema checks before it runs. */
type AnyGenreVerb<TCtx> = VerbHandler<TCtx, never> | { help?:string; handler:VerbHandler<TCtx, never> };

/** A verb as the director registers it. */
export type GenreVerbEntry<TCtx> = { name:string; def:VerbDef; handler:VerbHandler<TCtx> };

/**
 * The verbs `host` handles, in the genre's order, then its abilities: each with its args, its help (the game's
 * own first), and its handler.
 */
export function genreVerbs<TCtx>(defs:Readonly<Record<string, VerbDef>>, { abilities = {}, ...verbs }:RPGHost<TCtx>):GenreVerbEntry<TCtx>[] {
	const own:Readonly<Record<string, AnyGenreVerb<TCtx> | undefined>> = verbs;
	const given:[string, VerbDef, AnyGenreVerb<TCtx>][] = [
		...Object.keys(defs).flatMap((name):[string, VerbDef, AnyGenreVerb<TCtx>][] => (own[name] ? [[name, defs[name]!, own[name]!]] : [])),
		...Object.entries(abilities).map(([name, verb]):[string, VerbDef, AnyGenreVerb<TCtx>] => [name, ABILITY_DEF, verb]),
	];
	return given.map(([name, def, verb]) => {
		const { help, handler } = typeof verb === 'function' ? { help: undefined, handler: verb } : verb;
		// The schema is checked before dispatch, so the args match what this handler was typed with.
		return { name, def: { ...def, help: help ?? def.help }, handler: handler as VerbHandler<TCtx> };
	});
}
