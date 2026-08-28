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

export type ChatRequest = {
	model:string;
	messages:ChatMessage[];
	tools?:ToolDef[];
	responseFormat?:JsonSchemaResponseFormat;
	temperature?:number;
	maxTokens?:number;
};

export type ChatResponse = {
	content:string | null;
	toolCalls:ToolCall[];
};

export type InferenceProvider = {
	chat(req:ChatRequest):Promise<ChatResponse>;
	embed?(texts:string[], model?:string):Promise<number[][]>;
};
