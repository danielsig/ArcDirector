import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { openHub, type HubHandle } from '@arc-director/control/hub';
import { connectHttpInference, lmStudioConfig } from 'arc-director';
import { projectEntries, type LogEntry } from './project.js';

const sessionField = z.string().min(1).describe('Client session id from ?session=');

function isEntries(value:unknown):value is { entries:LogEntry[] } {
	return typeof value === 'object' && value !== null && Array.isArray((value as { entries?:unknown }).entries);
}

function text(value:unknown):{ content:Array<{ type:'text'; text:string }> } {
	return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] };
}

async function main():Promise<void> {
	const hub:HubHandle = openHub();
	const server = new McpServer({ name: 'arc-director', version: '0.0.1' });

	server.registerTool('list_clients', {
		description: 'List game pages connected to the control hub.',
	}, async () => {
		return text({ sessions: await hub.sessions() });
	});

	server.registerTool('list_actors', {
		description: 'List actors in a connected client: agents (with a mind), crowd units, and host-driven actors (the Player).',
		inputSchema: { session: sessionField },
	}, async ({ session }) => {
		return text(await hub.call(session, { op: 'listActors' }));
	});

	server.registerTool('run_verb', {
		description: 'Run an arc on an NPC, a CrowdUnit, or the Player. The Player has no mind, so mind verbs (think, remember, goals, identity, watches, focus) are not available to it. A click on the game canvas cancels a Player arc and returns control.',
		inputSchema: {
			session: sessionField,
			actor: z.string().min(1),
			arc: z.string().min(1).describe('Arc text, e.g. go_to(EastGate)'),
		},
	}, async ({ session, actor, arc }) => {
		return text(await hub.call(session, { op: 'runVerb', actor, arc }));
	});

	server.registerTool('get_prefs', {
		description: 'Read live prefs from a connected client.',
		inputSchema: { session: sessionField },
	}, async ({ session }) => {
		return text(await hub.call(session, { op: 'getPrefs' }));
	});

	server.registerTool('set_pref', {
		description: 'Patch prefs on a connected client. Unknown keys are dropped; unusable values keep the current one. '
			+ 'persist=false detaches that page: from then on no pref change in it is written to storage, until reload. Other pages are unaffected.',
		inputSchema: {
			session: sessionField,
			patch: z.record(z.string(), z.unknown()),
			persist: z.boolean().optional(),
		},
	}, async ({ session, patch, persist }) => {
		return text(await hub.call(session, { op: 'setPref', patch, persist }));
	});

	server.registerTool('think', {
		description: 'Run one live tactical LLM think on a named agent in the client. The Player does not think.',
		inputSchema: {
			session: sessionField,
			actor: z.string().min(1),
			about: z.string().optional(),
			enact: z.boolean().optional(),
		},
	}, async ({ session, actor, about, enact }) => {
		return text(await hub.call(session, { op: 'think', actor, about, enact }));
	});

	server.registerTool('read_ai_log', {
		description: 'Read the live AI log for a connected client, optionally filtered. Omits map image bytes; image is a boolean. '
			+ 'Pass `each` to reduce every row in-process so you do not parse the tool-result file. '
			+ '`each` is a JavaScript expression. `entry` is { seq, name, message, image }. '
			+ '`take(re, text?)` returns the first capture group, or the whole match, from `text` (default `entry.message`); empty string if none. '
			+ 'A string result is returned as { seq, name, text }. An object is kept as returned. null, undefined, or false drops the row. '
			+ 'Example: entry.message.startsWith("prompt") ? [take(/Short-term[\\s\\S]*?\\n\\n/), take(/Last verb result:.*/), take(/In talking range:.*/)].filter(Boolean).join("\\n") : entry.message.slice(0, 2500)',
		inputSchema: {
			session: sessionField,
			name: z.string().optional().describe('Agent id to keep (same as the HUD source filter).'),
			pattern: z.string().optional().describe('JavaScript regular expression matched against name or message.'),
			after: z.number().optional().describe('Only rows with seq greater than this.'),
			limit: z.number().optional().describe('Keep the last N matching rows.'),
			each: z.string().optional().describe('JavaScript expression run per row. Bindings: entry, take(re, text?).'),
		},
	}, async ({ session, name, pattern, after, limit, each }) => {
		const result = await hub.call(session, { op: 'readAiLog', name, pattern, after, limit });
		if (!each || !isEntries(result)) {
			return text(result);
		}
		return text({ entries: projectEntries(result.entries, each) });
	});

	server.registerTool('save_game', {
		description: 'Write the current scene save.',
		inputSchema: { session: sessionField },
	}, async ({ session }) => {
		return text(await hub.call(session, { op: 'saveGame' }));
	});

	server.registerTool('load_game', {
		description: 'Reload the scene from its save. Waits until the client reconnects.',
		inputSchema: { session: sessionField },
	}, async ({ session }) => {
		return text(await hub.call(session, { op: 'loadGame' }));
	});

	server.registerTool('complete', {
		description: 'Chat completion against LM Studio. Does not need a game client.',
		inputSchema: {
			messages: z.array(z.object({
				role: z.enum(['system', 'user', 'assistant']),
				content: z.string(),
			})).min(1),
			model: z.string().optional(),
		},
	}, async ({ messages, model }) => {
		const connected = await connectHttpInference(lmStudioConfig(), model);
		const res = await connected.provider.chat({
			model: connected.model,
			messages,
		});
		return text({
			model: connected.model,
			content: res.content,
			reasoning: res.reasoning,
		});
	});

	const transport = new StdioServerTransport();
	await server.connect(transport);
	const shutdown = ():void => {
		hub.close();
		void server.close();
	};
	process.on('SIGINT', shutdown);
	process.on('SIGTERM', shutdown);
}

void main().catch((err:unknown) => {
	console.error(err);
	process.exit(1);
});
