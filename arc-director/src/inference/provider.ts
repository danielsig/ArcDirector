import type { JsonSchema } from '../json.js';

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export type ChatTextPart = {
	type:'text';
	text:string;
};

export type ChatImagePart = {
	type:'image_url';
	image_url:{ url:string };
};

export type ChatContentPart = ChatTextPart | ChatImagePart;

export type ChatContent = string | ChatContentPart[] | null;

export type ChatMessage = {
	role:ChatRole;
	content:ChatContent;
	name?:string;
	toolCallID?:string;
	toolCalls?:ToolCall[];
};

export function chatContentText(content:ChatContent | undefined):string {
	if (typeof content === 'string') {
		return content;
	}
	if (!Array.isArray(content)) {
		return '';
	}
	return content
		.filter((p):p is ChatTextPart => p.type === 'text')
		.map((p) => p.text)
		.join('');
}

export type ToolCall = {
	id:string;
	name:string;
	arguments:string;
};

export type ToolDef = {
	name:string;
	description:string;
	parameters:JsonSchema;
};

export type JsonSchemaResponseFormat = {
	name:string;
	schema:JsonSchema;
	strict?:boolean;
};

/** `required`: the reply must be a tool call. */
export type ToolChoice = 'auto' | 'none' | 'required';

export type ChatRequest = {
	model:string;
	messages:ChatMessage[];
	tools?:ToolDef[];
	/** Keep `tools` listed with `none` on arc turns so the KV prefix stays identical. */
	toolChoice?:ToolChoice;
	responseFormat?:JsonSchemaResponseFormat;
	temperature?:number;
	maxTokens?:number;
	/**
	 * When false, this turn skips chain-of-thought even if the provider has thinking on.
	 * Omit to follow the provider setting.
	 */
	enableThinking?:boolean;
	/**
	 * Prefill a finished thought so this turn does not generate new CoT.
	 * Thinking stays on; only the canned thought is injected.
	 */
	fakeThought?:boolean;
	/** Agent id (or similar) so the HTTP layer can pick a cached response thread. */
	thread?:string;
	/** Abort in-flight chat. */
	signal?:AbortSignal;
};

export type ChatResponse = {
	content:string | null;
	toolCalls:ToolCall[];
	/** Prompt tokens served from a server-side cache, when the server reports them. */
	cachedTokens?:number;
	/** Prompt / KV load (time to first token, prompt_ms, …) in milliseconds. */
	promptMs?:number;
	/** Token generation time in milliseconds. */
	generateMs?:number;
	/** Chain-of-thought text when the server splits it from `content`. */
	reasoning?:string;
	/** The reply stopped at the output-token cap, so `content` is cut off. */
	truncated?:boolean;
};

export type InferenceProvider = {
	chat(req:ChatRequest):Promise<ChatResponse>;
	embed?(texts:string[], model?:string):Promise<number[][]>;
};
