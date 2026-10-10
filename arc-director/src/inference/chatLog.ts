import { isRecord } from '../json.js';

function contentText(content:unknown):string {
	if (typeof content === 'string') {
		return content;
	}
	if (!Array.isArray(content)) {
		return '';
	}
	const parts:string[] = [];
	for (const part of content) {
		if (typeof part === 'string') {
			parts.push(part);
		}
		else if (isRecord(part) && typeof part.text === 'string') {
			parts.push(part.text);
		}
	}
	return parts.join('');
}

function findImage(payload:unknown):string | undefined {
	if (!isRecord(payload)) {
		return undefined;
	}
	return lastDataURL(payload.messages);
}

function lastDataURL(value:unknown):string | undefined {
	if (typeof value === 'string') {
		return value.startsWith('data:') ? value : undefined;
	}
	if (Array.isArray(value)) {
		let hit:string | undefined;
		for (const item of value) {
			hit = lastDataURL(item) ?? hit;
		}
		return hit;
	}
	if (isRecord(value)) {
		let hit:string | undefined;
		for (const item of Object.values(value)) {
			hit = lastDataURL(item) ?? hit;
		}
		return hit;
	}
	return undefined;
}

function stripContents(value:unknown, blocks:string[]):unknown {
	if (Array.isArray(value)) {
		return value.map((item) => {
			if (isRecord(item) && 'content' in item) {
				const text = contentText(item.content);
				if (text) {
					blocks.push(text);
				}
				const rest:Record<string, unknown> = { ...item };
				delete rest.content;
				return rest;
			}
			return stripContents(item, blocks);
		});
	}
	if (isRecord(value)) {
		const out:Record<string, unknown> = {};
		for (const [key, item] of Object.entries(value)) {
			out[key] = stripContents(item, blocks);
		}
		return out;
	}
	if (typeof value === 'string' && value.startsWith('data:')) {
		return '[image]';
	}
	return value;
}

function fence(text:string):string {
	let n = 3;
	const tick = '`';
	while (text.includes(tick.repeat(n))) {
		n += 1;
	}
	const marks = tick.repeat(n);
	return `${marks}\n${text}\n${marks}`;
}

/** A response-format schema is kilobytes of grammar, so the log shows its name: wire `response_format` or raw `responseFormat`. */
function schemaNamed(payload:unknown):unknown {
	if (!isRecord(payload)) {
		return payload;
	}
	const out:Record<string, unknown> = { ...payload };
	const wire = out['response_format'];
	if (isRecord(wire) && isRecord(wire['json_schema']) && typeof wire['json_schema'].name === 'string') {
		out['response_format'] = wire['json_schema'].name;
	}
	const raw = out['responseFormat'];
	if (isRecord(raw) && typeof raw.name === 'string') {
		out['responseFormat'] = raw.name;
	}
	return out;
}

/** Wire/request dump: JSON minus message bodies, bodies in fences, schemas by name, last data-URL as `image`. */
export function formatChatLog(payload:unknown):{ message:string; image?:string } {
	const blocks:string[] = [];
	const image = findImage(payload);
	const json = JSON.stringify(stripContents(schemaNamed(payload), blocks));
	const message = blocks.length > 0 ? `${json}\n${blocks.map(fence).join('\n')}` : json;
	return image ? { message, image } : { message };
}
