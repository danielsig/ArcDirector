import { extractJson, isRecord } from '../json.js';
import { chatContentText, type ChatRequest, type ChatResponse, type InferenceProvider } from './provider.js';

export type FakeChatFn = (req:ChatRequest)=>ChatResponse | Promise<ChatResponse>;
export type FakeEmbedFn = (texts:string[], model?:string)=>number[][] | Promise<number[][]>;

export class FakeProvider implements InferenceProvider {
	constructor(
		private readonly chatFn:FakeChatFn,
		private readonly embedFn?:FakeEmbedFn,
	) {}

	chat(req:ChatRequest):Promise<ChatResponse> {
		return Promise.resolve(this.chatFn(req));
	}

	embed(texts:string[], model?:string):Promise<number[][]> {
		if (!this.embedFn) {
			return Promise.reject(new Error('FakeProvider has no embeddings'));
		}
		return Promise.resolve(this.embedFn(texts, model));
	}
}

/** Deterministic helper: go_to the first PascalCase name in the last user message. */
export function goToNamedInteractable():FakeChatFn {
	return (req) => {
		const lastUser = [...req.messages].reverse().find((m) => m.role === 'user');
		const text = chatContentText(lastUser?.content);
		const names = text.match(/\b[A-Z][A-Za-z0-9]+(?:[A-Z][A-Za-z0-9]+)+\b/g) ?? [];
		const name = names.find((n) => n !== 'Arc') ?? 'EastGate';
		return {
			content: JSON.stringify({
				head: { verb: 'go_to', args: { name } },
			}),
			toolCalls: [],
		};
	};
}

export function parseFakeArc(content:string):unknown {
	return extractJson(content);
}

export function hashEmbed(text:string, dims = 8):number[] {
	const vec = new Array<number>(dims).fill(0);
	for (let i = 0; i < text.length; i++) {
		vec[i % dims] += text.charCodeAt(i) / 255;
	}
	let n = 0;
	for (const v of vec) {
		n += v * v;
	}
	const s = Math.sqrt(n) || 1;
	return vec.map((v) => v / s);
}

export function isRecordUnknown(v:unknown):v is Record<string, unknown> {
	return isRecord(v);
}
