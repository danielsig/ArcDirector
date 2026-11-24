import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { openHub, type HubHandle } from '@arc-director/control/hub';
import { HttpProvider, fetchModelCatalog, findModel, lmStudioConfig, pickSingleChatModel } from 'arc-director';
import { AiLogStore } from '@arc-director/control/ai-log-store';
import type { AiLogRow } from '@arc-director/control';
import { projectEntries } from './project.js';

const sessionField = z.string().min(1).describe('Client session id from ?session=');

function isEntries(value:unknown):value is { entries:AiLogRow[] } {
	return typeof value === 'object' && value !== null && Array.isArray((value as { entries?:unknown }).entries);
}

function text(value:unknown):{ content:Array<{ type:'text'; text:string }> } {
	return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] };
}

async function main():Promise<void> {
	const hub:HubHandle = openHub();
	const logs = new AiLogStore();
	const server = new McpServer({ name: 'arc-director', version: '0.0.1' });

	server.registerTool('list_clients', {
		description: 'List game pages connected to the control hub.',
	}, async () => {
		return text({ sessions: await hub.sessions() });
	});

	server.registerTool('list_characters', {
		description: 'List the characters in a connected client and who thinks for each: its own mind, its collective\'s, or none (the host drives it, like the Player). Also lists each collective, its commander, and its characters.',
		inputSchema: { session: sessionField },
	}, async ({ session }) => {
		return text(await hub.call(session, { op: 'listCharacters' }));
	});

	server.registerTool('run_verb', {
		description: 'Run an arc on a character: an NPC, a member of a collective, or the Player. A character with no mind (the Player) cannot run mind verbs (think, remember, goals, identity, watches, focus). A click on the game canvas cancels a Player arc and returns control.',
		inputSchema: {
			session: sessionField,
			character: z.string().min(1),
			arc: z.string().min(1).describe('Arc text, e.g. go_to(EastGate)'),
		},
	}, async ({ session, character, arc }) => {
		return text(await hub.call(session, { op: 'runVerb', character, arc }));
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
		description: 'Run one live tactical LLM think in the client: a character\'s mind (its own, or its collective\'s), or a collective\'s by its id. The Player has no mind and does not think.',
		inputSchema: {
			session: sessionField,
			id: z.string().min(1).describe('A character or a collective'),
			about: z.string().optional(),
			enact: z.boolean().optional(),
		},
	}, async ({ session, id, about, enact }) => {
		return text(await hub.call(session, { op: 'think', id, about, enact }));
	});

	server.registerTool('set_collective', {
		description: 'Move a character into a collective, straight from any other, or out of it with collective=null: then it thinks with a fresh mind of its own if it had one before, else the host drives it. Its running arc, laws and tags come along. For testing transfers live.',
		inputSchema: {
			session: sessionField,
			character: z.string().min(1),
			collective: z.string().min(1).nullable(),
		},
	}, async ({ session, character, collective }) => {
		return text(await hub.call(session, { op: 'setCollective', character, collective }));
	});

	server.registerTool('read_ai_log', {
		description: 'Read the AI log of a connected client, live (the last 250 rows), or a stored run with `run`: every row of each game (a scene start, restart or load) is also kept in logs/ai, the 10 newest runs, so a reload loses nothing (list_ai_logs lists them). '
			+ 'Optionally filtered. Omits map image bytes; image is true where a row had one. '
			+ 'A stored run also answers `schemas`: the whole response format (JSON schema) of each prompt row that asked for one, by the id in its `schema`; the prompt itself names the format only. '
			+ 'Pass `each` to reduce every row in-process so you do not parse the tool-result file. '
			+ '`each` is a JavaScript expression. `entry` is { seq, name, message, image?, error?, schema? }. '
			+ '`take(re, text?)` returns the first capture group, or the whole match, from `text` (default `entry.message`); empty string if none. '
			+ 'A string result is returned as { seq, name, text }. An object is kept as returned. null, undefined, or false drops the row. '
			+ 'Example: entry.message.startsWith("prompt") ? [take(/Short-term[\\s\\S]*?\\n\\n/), take(/Last verb result:.*/), take(/In talking range:.*/)].filter(Boolean).join("\\n") : entry.message.slice(0, 2500)',
		inputSchema: {
			session: sessionField.optional().describe('Client session id from ?session=. Needed for the live log; with a numeric `run`, counts that session\'s runs only.'),
			run: z.union([z.number().int().min(0), z.string().min(1)]).optional()
				.describe('A stored run instead of the live log: 0 = the newest (the live page\'s, whole), 1 = the one before, …; or a file name from list_ai_logs.'),
			name: z.string().optional().describe('Agent id to keep (same as the HUD source filter).'),
			pattern: z.string().optional().describe('JavaScript regular expression matched against name or message.'),
			after: z.number().optional().describe('Only rows with seq greater than this.'),
			limit: z.number().optional().describe('Keep the last N matching rows.'),
			each: z.string().optional().describe('JavaScript expression run per row. Bindings: entry, take(re, text?).'),
		},
	}, async ({ session, run, name, pattern, after, limit, each }) => {
		const query = { name, pattern, after, limit };
		let result:unknown;
		if (run !== undefined) {
			result = logs.read(run, session, query);
		}
		else if (session) {
			result = await hub.call(session, { op: 'readAiLog', ...query });
		}
		else {
			throw new Error('pass session for the live log, or run for a stored one');
		}
		if (!each || !isEntries(result)) {
			return text(result);
		}
		return text({ ...result, entries: projectEntries(result.entries, each) });
	});

	server.registerTool('list_ai_logs', {
		description: 'List the stored AI log runs in logs/ai, newest first: file, session, scene, started (ISO time) and rows. One per game (each scene start, restart or load), the 10 newest across sessions. Read one with read_ai_log `run`.',
	}, async () => {
		return text(logs.list());
	});

	server.registerTool('render_stats', {
		description: 'Read GPU cost in a connected client: last frame draw calls and triangles, live geometries and textures, '
			+ 'estimated sceneMemory (shadow maps, geometry, textures) and framebufferMemory (window-size dependent) in bytes, frameMS averaged over the last 30 s, and frameMSNow over the last second; '
			+ 'fps (frames drawn per second, last 600 s, oldest first), phaseMS (average ms per frame over the last second for director, simulate without the director, and render) and heapMB (used JS heap, Chrome only). Wait 30 s after loading a scene for a fair frameMS.',
		inputSchema: { session: sessionField },
	}, async ({ session }) => {
		return text(await hub.call(session, { op: 'renderStats' }));
	});

	server.registerTool('set_camera', {
		description: 'Point the camera of a connected client. It glides to the middle of the characters `focus` picks, '
			+ 'asked every half second as the player sees them, in watch-expression syntax: '
			+ '`others.filter(u => doing(u, "cleave"))`, `others.filter("Knight")`, `[Forager, Angler]`. '
			+ 'Use with the player setting `camera` (no body to block it). Empty focus stops following. '
			+ '`view` puts the camera at a spot, as the URL view parameter does, and stops following unless focus is set too. Answers whom the focus picks now.',
		inputSchema: {
			session: sessionField,
			focus: z.string().optional().describe('Watch expression whose characters the camera follows; empty to stop'),
			zoom: z.number().positive().optional().describe('Camera distance from its target in meters (3 to 24)'),
			view: z.object({ x: z.number(), y: z.number(), z: z.number(), yaw: z.number() }).optional()
				.describe('Move the player (the camera\'s rig) and turn the camera: x and z in meters on the ground, y height, '
					+ 'yaw in radians (0 north, 1.5708 west, 3.1416 south)'),
		},
	}, async ({ session, focus, zoom, view }) => {
		return text(await hub.call(session, { op: 'setCamera', focus, zoom, view }));
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

	server.registerTool('kill', {
		description: 'For testing: a character falls dead at once, struck down by `by` (default: itself), as any blow that fells: its mind stops and everyone who sees it hears of the fall.',
		inputSchema: { session: sessionField, character: z.string().min(1), by: z.string().min(1).optional() },
	}, async ({ session, character, by }) => {
		return text(await hub.call(session, { op: 'kill', character, by }));
	});

	server.registerTool('teleport', {
		description: 'For testing: put a character, or any thing by name, at x, z on the ground (meters, as the URL view). What it was walking to it walks to from there.',
		inputSchema: { session: sessionField, character: z.string().min(1), x: z.number(), z: z.number() },
	}, async ({ session, character, x, z: atZ }) => {
		return text(await hub.call(session, { op: 'teleport', character, x, z: atZ }));
	});

	server.registerTool('scrub', {
		description: 'For testing, to inspect animation frames: the game holds still `at` seconds after a character starts a verb\'s move (wound up over `windUp` s, default the verb\'s own, at `target`), or `at` seconds from now with no verb. Shoot each frame, then scrub again; `at: null` lets the game run.',
		inputSchema: { session: sessionField, character: z.string().min(1), verb: z.string().min(1).optional(), target: z.string().min(1).optional(), windUp: z.number().positive().optional(), at: z.number().min(0).nullable() },
	}, async ({ session, character, verb, target, windUp, at }) => {
		return text(await hub.call(session, { op: 'scrub', character, verb, target, windUp, at }));
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
		const provider = new HttpProvider(lmStudioConfig());
		const catalog = await fetchModelCatalog(provider.rootURL);
		const id = model ? findModel(catalog, model)?.id ?? model : pickSingleChatModel(catalog);
		if (!id) {
			throw new Error(`no model at ${provider.baseURL}`);
		}
		const res = await provider.chat({ model: id, messages });
		return text({
			model: id,
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
