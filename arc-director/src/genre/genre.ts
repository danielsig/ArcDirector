import { STOCK_TRADE_VERBS, STOCK_VERBS, type VerbDef } from '../arc/stock-verbs.js';
import type { ArcDirector } from '../director/ArcDirector.js';
import type { VerbArgs, VerbHandler } from '../director/director-types.js';
import { Feature } from '../director/Feature.js';
import type { CrowdSettings } from '../world/mover.js';
import { WorldVerbsFeature } from '../world/WorldVerbsFeature.js';

/** How fighters fight, in an RPG and a MOBA alike. */
const FIGHT_VERB_DEFS = {
	attack: { args: { target: 'id?' } },
	block: { args: { target: 'id?' }, help: 'guard up against them, or the nearest enemy, for a moment' },
	heal: { args: { target: 'id?' } },
	protect: { args: { target: 'id?' }, help: 'stand between an ally and the threat, then attack that threat' },
} as const satisfies Record<string, VerbDef>;

/** An RPG's verbs: what characters wear and take, how they rest, and how they fight. */
export const STOCK_RPG_VERB_DEFS = {
	equip: { args: { item: 'id', slot: 'string?' } },
	unequip: { args: { slot: 'string' } },
	steal: { args: { item: 'id', from: 'id' }, help: 'goes to them first' },
	sit: { args: { target: 'id?' }, help: 'goes to that chair, or the nearest free one, and stays sat until you walk off', seen: 'sitting' },
	sleep: { args: { target: 'id?', seconds: 'number?' }, help: 'goes to that bed, or the nearest free one, and sleeps: you hear nothing until you wake', seen: 'sleeping' },
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
type GenreVerbEntry<TCtx> = { name:string; def:VerbDef; handler:VerbHandler<TCtx> };

/**
 * The verbs `host` handles, in the genre's order, then its abilities: each with its args, its help (the game's
 * own first), and its handler.
 */
function genreVerbs<TCtx>(defs:Readonly<Record<string, VerbDef>>, { abilities = {}, ...verbs }:RPGHost<TCtx>):GenreVerbEntry<TCtx>[] {
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

/** What each genre brings: its verbs, the stock verbs its default kit grants besides the rest, and its crowds. */
const GENRES = {
	/**
	 * An RPG: `equip`, `unequip`, `steal`, `attack`, `block`, `heal` and `protect`, each the game gives a handler for, and
	 * its own attacks and spells as `abilities`; characters get them, the stock verbs and `offer`. Crowds ring round
	 * whoever they come to, in line to trade or hand over.
	 */
	rpg: { defs: STOCK_RPG_VERB_DEFS, more: STOCK_TRADE_VERBS, crowd: { crowd: 'ring', verbs: { offer: 'line', give: 'line' } } },
	/** A MOBA: as an RPG, with its heroes' `attack`, `block`, `heal`, `protect` and `abilities`, and no `offer`. */
	moba: { defs: STOCK_MOBA_VERB_DEFS, more: [] },
} as const satisfies Record<string, { defs:Readonly<Record<string, VerbDef>>; more:readonly string[]; crowd?:CrowdSettings }>;

/**
 * A genre to start from (`withRPG(host)`, `withMOBA(host)`): its verbs, each registered with its args and help once the
 * game gives its handler, the stock verbs too, and, unless the host gives its own, the default kit and crowds.
 */
export class GenreFeature<TCtx = unknown> extends Feature<TCtx> {
	private _genre!:(typeof GENRES)[keyof typeof GENRES];
	private _verbs!:readonly GenreVerbEntry<TCtx>[];

	constructor(genre:keyof typeof GENRES, host:RPGHost<TCtx>) {
		super();
		this.configure(genre, host);
	}

	/** Be `genre` with `host`'s handlers from now on: added already, its verbs are registered again. */
	public configure(genre:keyof typeof GENRES, host:RPGHost<TCtx>):this {
		this._genre = GENRES[genre];
		this._verbs = genreVerbs(this._genre.defs, host);
		if (this.attached) {
			this.install();
		}
		return this;
	}

	public override install():void {
		const director = this.director;
		director
			.withVerbs((v) => {
				v.addStock();
				for (const { name, def, handler } of this._verbs) {
					v.add(name, { ...def, handler });
				}
			})
			.if(!director.defaultKit, (d) => d.withDefaultKit({ verbs: [...STOCK_VERBS, ...this._genre.more, ...this._verbs.map((verb) => verb.name)] }));
		const world = director.getFeature(WorldVerbsFeature);
		if ('crowd' in this._genre && !world?.crowd) {
			world?.configure({ crowd: this._genre.crowd });
		}
	}
}

declare module '../director/ArcDirector.js' {
	interface ArcDirector<TCtx, TEntity> {
		/** {@link GenreFeature}, an RPG: `withRPG({ attack, heal, abilities: { hex } })`. */
		withRPG(host:RPGHost<TCtx>):this;
		/** {@link GenreFeature}, a MOBA: `withMOBA({ attack, abilities: { cleave } })`. */
		withMOBA(host:MOBAHost<TCtx>):this;
		getGenre():GenreFeature<TCtx> | undefined;
	}
}
export function withRPG<TCtx>(this:ArcDirector<TCtx>, host:RPGHost<TCtx>):ArcDirector<TCtx> {
	return this.configureFeature(GenreFeature<TCtx>, () => new GenreFeature<TCtx>('rpg', host), (genre) => genre.configure('rpg', host));
}
export function withMOBA<TCtx>(this:ArcDirector<TCtx>, host:MOBAHost<TCtx>):ArcDirector<TCtx> {
	return this.configureFeature(GenreFeature<TCtx>, () => new GenreFeature<TCtx>('moba', host), (genre) => genre.configure('moba', host));
}
