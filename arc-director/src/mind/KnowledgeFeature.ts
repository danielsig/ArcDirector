import { showNamingText } from '../character/text-with-ids.js';
import { Feature, type PromptPart } from '../director/Feature.js';
import type { ArcDirector } from '../director/ArcDirector.js';
import { bagOf } from '../expr/prev.js';
import { internalsOf } from '../internals.js';
import { mindTools, type Mind } from './mind.js';
import { recallQuery } from './MindMemory.js';
import type { ToolSpec } from './mind-types.js';
import { articlesNamedIn, isAboutItem, knowledgeFor, knowledgePages, mentionedArticles, receivedArticles, type KnowledgeSource } from './knowledge.js';
import { nothingFoundThen } from './prompt.js';

/** Articles shown per think for names said or heard. */
export const DEFAULT_MENTION_CAP = 2;
/** Thinks before an article shown for a mention may be shown again. */
const MENTION_REPEAT = 5;
/** `recall`'s description where the world has articles, for a mind with `verbs`. */
function knowledgeRecall(verbs:{ has(name:string):boolean }):string {
	return `Search what you remember (what you were told, saw, or did) and what you know of the world (places, items, people, who sells or makes what, how things work). Query a name or keyword your goal needs (Bread, Gate), or a plain word (trees, house) to learn its Capitalized name. Empty query lists the topics you know. It answers any question. If it finds nothing, ${nothingFoundThen(verbs)}.`;
}

/** What `withKnowledge` takes. */
export type KnowledgeOptions<TCtx = unknown> = {
	/** The articles, a list or one from a character's context. */
	pages:KnowledgeSource<TCtx>;
	/** Most articles shown per think for names said or heard. Default {@link DEFAULT_MENTION_CAP}; 0 shows none. */
	mentions?:number;
};

/**
 * What minds know of the world (`withKnowledge({ pages })`): articles `recall` searches beside memory, and
 * brings up unasked when a name is said or heard, when the last verb failed on one, and for what just came into a
 * character's hands. Talk carries the outside facts a mind lacks, where its own reasoning would only feed its fixation.
 */
export class KnowledgeFeature<TCtx = unknown> extends Feature<TCtx> {
	private _mentions = DEFAULT_MENTION_CAP;
	/** Per mind: its thinks so far, and the think each article was last shown on for being mentioned. */
	private readonly _minds = new WeakMap<Mind<TCtx>, { thinks:number; shownOn:Map<string, number> }>();

	private _pages:KnowledgeSource<TCtx>;

	constructor(options:KnowledgeOptions<TCtx>) {
		super();
		this._pages = options.pages;
		this.configure(options);
	}

	public configure({ pages, mentions = this._mentions }:KnowledgeOptions<TCtx>):this {
		this._pages = pages;
		this._mentions = mentions;
		return this;
	}

	public override promptPart(mind:Mind<TCtx>):PromptPart {
		const marks = this._minds.get(mind) ?? { thinks: 0, shownOn: new Map<string, number>() };
		this._minds.set(mind, marks);
		marks.thinks += 1;
		return { mentioned: this.mentioned(mind, marks), lastResultArticles: this.failureArticles(mind), section: this.received(mind), recallKnows: this.hasPages(mind) };
	}

	/** Whether the world `mind` looks from has articles: only then does `recall` promise what the world knows. */
	private hasPages(mind:Mind<TCtx>):boolean {
		return knowledgePages(this._pages, internalsOf(mind).worldContext()).length > 0;
	}

	public override install():void {
		this.director.withTools((t) => t.add('recall', this.tool));
	}

	/**
	 * `recall` with the articles: memory, and what the world knows, where the world has any; memory alone, as every mind
	 * has it, where it has none. What `install` registers, and what a solo character is given.
	 */
	public get tool():ToolSpec<TCtx> {
		const memory = mindTools<TCtx>().recall;
		return {
			...memory,
			description: (mind) => (this.hasPages(mind) ? knowledgeRecall(mind.owner.activeVerbs()) : typeof memory.description === 'string' ? memory.description : memory.description(mind)),
			handler: async (ctx, args, mind) => {
				const remember = await mind.memory.recall(args);
				const know = knowledgeFor(knowledgePages(this._pages, ctx), recallQuery(args), mind.owner.activeVerbs());
				return remember.length + know.length > 0 ? { remember, know } : mind.memory.nothingMore(args);
			},
		};
	}

	/**
	 * Articles for names said or heard lately. Item articles always say whether this mind carries one. The article text
	 * itself is not repeated within a few thinks.
	 */
	private mentioned(mind:Mind<TCtx>, marks:{ thinks:number; shownOn:Map<string, number> }):string {
		const talked = mind.memory.talkedOf().join('\n');
		const ctx = this._mentions > 0 && talked.trim() ? internalsOf(mind).worldContext() : undefined;
		if (ctx === undefined) {
			return '';
		}
		const me = mind.voice.catalog?.()?.me;
		const bag = me ? bagOf(me) : undefined;
		const lines:string[] = [];
		for (const entry of mentionedArticles(knowledgePages(this._pages, ctx), talked, Infinity)) {
			if (lines.length >= this._mentions) {
				break;
			}
			const name = entry.name.trim();
			const carried = entry.item && bag ? ` (${isAboutItem(entry, bag) ? 'you carry one' : 'you carry none'})` : '';
			if (marks.thinks - (marks.shownOn.get(name) ?? -Infinity) > MENTION_REPEAT) {
				marks.shownOn.set(name, marks.thinks);
				lines.push(`- ${name}${carried}: ${entry.text.trim()}`);
			}
			else if (carried) {
				lines.push(`- ${name}${carried}.`);
			}
		}
		return lines.join('\n');
	}

	/**
	 * Articles for what stopped the last verb. A small model looks up its goal, not its obstacle; this does the obstacle's
	 * lookup for it, when it is stuck on it and only then.
	 */
	private failureArticles(mind:Mind<TCtx>):string {
		const reason = mind.lastResult?.reason && mind.lastResult.status !== 'ok' ? showNamingText(mind.lastResult.reason, (id) => mind.nameOf(id)) : undefined;
		const ctx = reason ? internalsOf(mind).worldContext() : undefined;
		return reason && ctx !== undefined ? articlesNamedIn(knowledgePages(this._pages, ctx), reason) : '';
	}

	/** Articles for what came into the voice's hands since its last think. */
	private received(mind:Mind<TCtx>):string {
		const voice = mind.voice;
		const me = voice.prevMe ? voice.catalog?.()?.me : undefined;
		if (!me || !voice.prevMe) {
			return '';
		}
		const pages = knowledgePages(this._pages, internalsOf(mind).worldContext());
		if (pages.length === 0) {
			return '';
		}
		const prev = new Set(bagOf(voice.prevMe).map((item) => item.id));
		const articles = receivedArticles(pages, bagOf(me).filter((item) => !prev.has(item.id)));
		return articles ? `What you know about what you just received:\n${articles}` : '';
	}
}

declare module '../director/ArcDirector.js' {
	interface ArcDirector<TCtx, TEntity> {
		/** {@link KnowledgeFeature}: `withKnowledge({ pages, mentions: 1 })`. */
		withKnowledge(options:KnowledgeOptions<TCtx>):this;
		getKnowledge():KnowledgeFeature<TCtx> | undefined;
	}
}
export function withKnowledge<TCtx>(this:ArcDirector<TCtx>, options:KnowledgeOptions<TCtx>):ArcDirector<TCtx> {
	return this.configureFeature(KnowledgeFeature<TCtx>, () => new KnowledgeFeature<TCtx>(options), (knowledge) => knowledge.configure(options));
}
