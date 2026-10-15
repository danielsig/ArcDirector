/**
 * Replies held to a JSON schema in the browser, through xgrammar (`@mlc-ai/web-xgrammar`, an optional peer
 * dependency imported on first use): the engine vLLM, SGLang and WebLLM use. It tracks every branch of an `anyOf`
 * as each token arrives, so a wrong verb or argument is refused at its first token, never after it.
 */

/** What this file uses of xgrammar; hosts without it installed must not need its types. */
type XGrammar = {
	TokenizerInfo:{ createTokenizerInfo(vocab:string[], type:string, prependSpace:boolean, vocabSize:number, stopTokenIds?:number[]):Promise<Disposable> };
	GrammarCompiler:{ createGrammarCompiler(info:Disposable):Promise<Compiler> };
	GrammarMatcher:{ createGrammarMatcher(grammar:Disposable):Promise<Matcher> };
};

type Disposable = { dispose():void };

type Compiler = Disposable & { compileJSONSchema(schema:string):Promise<Disposable> };

/**
 * A matcher, used through its synchronous `handle`: transformers.js asks its logits processors synchronously, and
 * the wrapper's `getNextTokenBitmask` only adds an `await` for xgrammar's start-up, long done by then.
 */
type Matcher = Disposable & {
	handle:{
		AcceptToken(id:number, verbose:boolean):boolean;
		GetNextTokenBitmask(vocabSize:number):{ size():number; get(i:number):number; delete():void };
	};
};

/** The parts of a tokenizer.json that say how its tokens spell text. */
export type TokenizerJSON = {
	model:{ vocab:Record<string, number> | [string, number][] };
	added_tokens?:{ id:number; content:string }[];
	decoder?:unknown;
	normalizer?:unknown;
	pre_tokenizer?:unknown;
};

type Logits = { dims:number[]; data:{ [i:number]:number; length:number } };

/** A logits processor as transformers.js calls it, and the matcher to free once generation ends. */
export type SchemaConstraint = {
	process<T extends Logits>(ids:bigint[][], logits:T):T;
	dispose():void;
};

/** One model's vocabulary, as xgrammar compiles schemas for it. */
export class SchemaGrammar {
	private readonly _xgrammar:XGrammar;
	private readonly _info:Disposable;
	private readonly _compiler:Compiler;
	private readonly _vocabSize:number;

	private constructor(xgrammar:XGrammar, info:Disposable, compiler:Compiler, vocabSize:number) {
		this._xgrammar = xgrammar;
		this._info = info;
		this._compiler = compiler;
		this._vocabSize = vocabSize;
	}

	/** For a tokenizer whose model scores `vocabSize` tokens (its logits, padding and all) and stops at `stopTokenIds`. */
	public static async create(tokenizer:TokenizerJSON, vocabSize:number, stopTokenIds:number[]):Promise<SchemaGrammar> {
		const xgrammar = await importXGrammar();
		const info = await xgrammar.TokenizerInfo.createTokenizerInfo(
			encodedVocab(tokenizer),
			vocabType(tokenizer),
			prependsSpace(tokenizer),
			vocabSize,
			stopTokenIds.length > 0 ? stopTokenIds : undefined,
		);
		return new SchemaGrammar(xgrammar, info, await xgrammar.GrammarCompiler.createGrammarCompiler(info), vocabSize);
	}

	/**
	 * A processor that lets through only tokens that keep the reply on `schema`. Generation starts after the
	 * `prompt` tokens; each later one the matcher takes in as it was chosen.
	 */
	public async constrain(schema:unknown, prompt:number):Promise<SchemaConstraint> {
		// The compiler keeps each schema it compiled, so a mind's reply schema compiles once.
		const matcher = await this._xgrammar.GrammarMatcher.createGrammarMatcher(await this._compiler.compileJSONSchema(JSON.stringify(schema)));
		let seen = prompt;
		return {
			process: <T extends Logits>(ids:bigint[][], logits:T):T => {
				const tokens = ids[0];
				for (; seen < tokens.length; seen++) {
					matcher.handle.AcceptToken(Number(tokens[seen]), false);
				}
				applyBitmask(logits, matcher.handle.GetNextTokenBitmask(this._vocabSize));
				return logits;
			},
			dispose: () => matcher.dispose(),
		};
	}

	public dispose():void {
		this._compiler.dispose();
		this._info.dispose();
	}
}

/** Every token a bitmask's 0 bit refuses, and any the model scores past its vocabulary, gets -Infinity. */
function applyBitmask(logits:Logits, mask:{ size():number; get(i:number):number; delete():void }):void {
	const vocab = logits.dims[logits.dims.length - 1];
	const base = logits.data.length - vocab;
	try {
		for (let word = 0; word < mask.size(); word++) {
			const bits = mask.get(word);
			if (bits === -1) {
				continue;
			}
			for (let bit = 0; bit < 32; bit++) {
				const id = word * 32 + bit;
				if (id < vocab && !(bits & (1 << bit))) {
					logits.data[base + id] = -Infinity;
				}
			}
		}
		for (let id = mask.size() * 32; id < vocab; id++) {
			logits.data[base + id] = -Infinity;
		}
	}
	finally {
		mask.delete();
	}
}

/** Each token as the tokenizer stores it, by id: the model's vocabulary, then its added and special tokens. */
export function encodedVocab(tokenizer:TokenizerJSON):string[] {
	const vocab:string[] = [];
	const entries = Array.isArray(tokenizer.model.vocab)
		? tokenizer.model.vocab.map(([token], id):[string, number] => [token, id])
		: Object.entries(tokenizer.model.vocab);
	for (const [token, id] of entries) {
		vocab[id] = token;
	}
	for (const { id, content } of tokenizer.added_tokens ?? []) {
		vocab[id] = content;
	}
	return Array.from(vocab, (token) => token ?? '');
}

/**
 * How tokens spell text, as xgrammar's own `from_huggingface` reads it: byte-level (GPT-2's `Ġ`, Qwen), byte fallback
 * (sentencepiece's `▁` and `<0x..>` bytes, Gemma, Llama 2), or as written.
 */
export function vocabType(tokenizer:TokenizerJSON):'byte_level' | 'byte_fallback' | 'raw' {
	const decoder = JSON.stringify(tokenizer.decoder ?? null);
	if (decoder.includes('"ByteLevel"')) {
		return 'byte_level';
	}
	return decoder.includes('"ByteFallback"') ? 'byte_fallback' : 'raw';
}

/** Whether tokenizing puts a space before the text (sentencepiece's prefix space). */
export function prependsSpace(tokenizer:TokenizerJSON):boolean {
	return JSON.stringify(tokenizer.normalizer ?? null).includes('"Prepend"')
		|| /"prepend_scheme":"(first|always)"|"add_prefix_space":true/.test(JSON.stringify(tokenizer.pre_tokenizer ?? null));
}

/**
 * xgrammar ships as a UMD script: a bundler that reads it as CommonJS gives its exports, one that reads it as a
 * module leaves them on `globalThis.xgrammar`.
 */
async function importXGrammar():Promise<XGrammar> {
	const mod = await (import('@mlc-ai/web-xgrammar') as Promise<unknown>).catch(() => {
		throw new Error('Replies with a schema in the browser need @mlc-ai/web-xgrammar installed');
	}) as Partial<XGrammar> & { default?:Partial<XGrammar> };
	const found = [mod, mod.default, (globalThis as { xgrammar?:Partial<XGrammar> }).xgrammar].find((x) => x?.GrammarCompiler);
	if (!found) {
		throw new Error('@mlc-ai/web-xgrammar loaded without its exports');
	}
	return found as XGrammar;
}
