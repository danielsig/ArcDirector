/**
 * Plays the arc bench's cases (`ARC_BENCH`) with a model on LM Studio, as the game's minds think, and prints how each
 * went.
 *
 *   pnpm --filter arc-director bench --model google/gemma-4-e4b --skill questing
 *
 * `--only <id>` plays the case of that character alone, and `--show` prints each think's thought and reply.
 */
import { parseArgs } from 'node:util';
import type { ArcDirector } from '../director/director.js';
import { HttpProvider, type ModelSettings } from '../inference/http.js';
import { lmStudioConfig } from '../inference/presets.js';
import type { ChatRequest, ChatResponse, InferenceProvider } from '../inference/provider.js';
import type { SceneCtx } from '../scenario/play.js';
import { playArcCase } from './arc.js';
import { ARC_BENCH } from './cases.js';

const { values: args } = parseArgs({
	options: {
		model: { type: 'string', default: 'google/gemma-4-31b-qat' },
		url: { type: 'string', default: 'http://127.0.0.1:1234/v1' },
		skill: { type: 'string' },
		only: { type: 'string' },
		show: { type: 'boolean', default: false },
		parallel: { type: 'string', default: '2' },
		context: { type: 'string', default: '16384' },
	},
});

/**
 * One case's way to the server every case shares, so the model loads once: it keeps what came back, and never lets
 * the case's end unload the model the others use.
 */
class CaseLink implements InferenceProvider {
	public readonly replies:ChatResponse[] = [];
	private readonly _server:InferenceProvider;

	constructor(server:InferenceProvider) {
		this._server = server;
	}

	public async chat(req:ChatRequest):Promise<ChatResponse> {
		const res = await this._server.chat(req);
		this.replies.push(res);
		return res;
	}

	public configureModel(model:string, settings:ModelSettings):void {
		this._server.configureModel?.(model, settings);
	}

	public forgetModel():void {
		// The next case needs the model loaded still.
	}
}

const parallel = Math.max(1, Number(args.parallel));
// Thoughts run long on hard cases: they get room.
const server = new HttpProvider(lmStudioConfig({ baseURL: args.url, timeoutMs: 600_000, maxTokens: 8192 }));
const cases = ARC_BENCH.filter((c) => (!args.skill || c.skill === args.skill) && (!args.only || c.me.id === args.only));

/**
 * The model as the game's minds think: thinking, schema arcs and repairs, sampled as its makers recommend. Not marked
 * as seeing images, as a model in the browser is not, so no think is offered the map.
 */
const thinking = (link:CaseLink) => (director:ArcDirector<SceneCtx>) => director
	.addInference('model', link)
	.addModel('main', { inference: 'model', id: args.model, thinking: true, contextLength: Number(args.context), maxParallel: parallel })
	.withArcFormat('schema')
	.withRepair({ retries: 3 });

console.log(`${cases.length} cases with ${args.model}, ${parallel} at once`);
const queue = [...cases];
let right = 0;
await Promise.all(Array.from({ length: parallel }, async () => {
	for (let c = queue.shift(); c; c = queue.shift()) {
		const link = new CaseLink(server);
		const t0 = performance.now();
		const won = await playArcCase(c, thinking(link)).then((outcome) => outcome === 'success').catch((err:unknown) => err instanceof Error ? err.message : String(err));
		right += won === true ? 1 : 0;
		const seconds = Math.round((performance.now() - t0) / 1000);
		console.log(`${won === true ? '✓' : '✗'} ${c.skill} L${c.level} ${c.me.id} ${seconds}s${typeof won === 'string' ? `  ${won}` : ''}`);
		for (const response of args.show ? link.replies : []) {
			console.log(`   thought: ${(response.reasoning ?? '').replace(/\s+/g, ' ')}`);
			console.log(`   reply:   ${response.content ?? ''}`);
		}
	}
}));
console.log(`${right}/${cases.length} right`);
