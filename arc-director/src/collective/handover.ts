import type { ChatRequest, ChatResponse } from '../inference/provider.js';
import { extractJson, isRecord } from '../json.js';
import type { Character } from '../character/character.js';
import type { Persona } from '../character/persona.js';
import type { Collective } from './collective.js';

/** One character's move between collectives in a batch: where it started and where it ended. `null` is on its own. */
export type Journey<TCtx = unknown> = {
	character:Character<TCtx>;
	from:Collective<TCtx> | null;
	to:Collective<TCtx> | null;
};

/** Edits to the memories of the character or collective with `id`. Pinned memories are never touched. */
export type MemoryEdit = {
	id:string;
	/** Memory ids to forget. */
	remove?:string[];
	rewrite?:{ id:string; text:string }[];
	/** New memories, as text. */
	add?:string[];
};

/** Fixes memories after characters change collectives. One call covers a whole batch of journeys. */
export type Handover<TCtx = unknown> = (journeys:Journey<TCtx>[])=>Promise<MemoryEdit[]>;

/** Most memories of each persona the default handover shows the model, newest first. */
export const HANDOVER_MEMORY_CAP = 40;

/** The thread the default handover's chat runs on; its log rows are named after it. */
export const HANDOVER_THREAD = 'MemoryHandover';

type Owner = { id:string; persona:Persona };

/**
 * The default handover: one chat call over every persona involved (the characters, and the collectives they
 * left and joined). It asks which memories went stale, which need new wording, and what to add.
 */
export function chatHandover<TCtx>(chat:(req:ChatRequest)=>Promise<ChatResponse>, model:()=>string):Handover<TCtx> {
	return async (journeys) => {
		const owners = ownersOf(journeys);
		const res = await chat({
			model: model(),
			thread: HANDOVER_THREAD,
			temperature: 0,
			messages: [
				{ role: 'system', content: HANDOVER_SYSTEM },
				{ role: 'user', content: handoverPrompt(journeys, owners) },
			],
		});
		return readEdits(res.content ?? '', owners);
	};
}

const HANDOVER_SYSTEM = [
	'Characters just changed groups. Each group shares one mind and one memory; a character on its own has its own.',
	'Keep every memory below true and useful after the moves. Reply with JSON only.',
].join(' ');

/** Characters first, then the collectives they left and joined, each once. */
function ownersOf<TCtx>(journeys:Journey<TCtx>[]):Owner[] {
	const out:Owner[] = [];
	const add = (owner:Owner | null):void => {
		if (owner && !out.some((o) => o.id === owner.id)) {
			out.push(owner);
		}
	};
	journeys.forEach((j) => add(j.character));
	journeys.forEach((j) => {
		add(j.from);
		add(j.to);
	});
	return out;
}

function moveLine<TCtx>({ character, from, to }:Journey<TCtx>):string {
	if (from && to) {
		return `- ${character.id} moved from ${from.id} to ${to.id}.`;
	}
	return from
		? `- ${character.id} left ${from.id} and is on their own now.`
		: `- ${character.id} joined ${to!.id}; they were on their own.`;
}

function personaBlock({ id, persona }:Owner):string {
	const { role, traits } = persona.identity;
	const who = [role && `Role: ${role}.`, traits?.length && `Traits: ${traits.join(', ')}.`].filter(Boolean).join(' ');
	const memories = persona.memory.all()
		.filter((m) => !m.pinned)
		.sort((a, b) => b.timestamp - a.timestamp)
		.slice(0, HANDOVER_MEMORY_CAP)
		.map((m) => `- ${m.id}: ${m.text}`);
	return [`## ${id}${who ? ` (${who})` : ''}`, ...(memories.length > 0 ? memories : ['(no memories)'])].join('\n');
}

/** Characters the personas call by different names, so an added or rewritten memory uses its reader's own. */
function nameLines(owners:Owner[]):string[] {
	const ids = new Set(owners.flatMap((o) => o.persona.names.ids()));
	const lines:string[] = [];
	for (const id of ids) {
		const names = owners.map((o) => `${o.id} calls them ${o.persona.names.peek(id) ?? id}`);
		if (new Set(owners.map((o) => o.persona.names.peek(id) ?? id)).size > 1) {
			lines.push(`- ${id}: ${names.join('; ')}.`);
		}
	}
	return lines;
}

function handoverPrompt<TCtx>(journeys:Journey<TCtx>[], owners:Owner[]):string {
	const names = nameLines(owners);
	return [
		`Moves:\n${journeys.map(moveLine).join('\n')}`,
		`Memories (pinned ones are not shown and stay):\n${owners.map(personaBlock).join('\n\n')}`,
		...(names.length > 0 ? [`Names that differ:\n${names.join('\n')}`] : []),
		[
			'For each of them: remove memories that are wrong now or no longer useful, rewrite ones that need new wording,',
			'and add a few short memories the moves teach them: who left or joined, and what a character who left still needs to know.',
			'Write each memory as plain text in its owner\'s voice, calling others by the names it uses.',
			`Reply as JSON keyed by id: {"${owners[0]?.id ?? 'Id'}": {"remove": ["mem_1"], "rewrite": [{"id": "mem_2", "text": "..."}], "add": ["..."]}}. Leave out anyone with nothing to change.`,
		].join(' '),
	].join('\n\n');
}

/** A memory's text as the model wrote it, less a `mem_7:` it copied from the list it was shown. */
function memoryText(text:string):string {
	return text.replace(/^\s*mem_\d+\s*:\s*/, '').trim();
}

function strings(v:unknown):string[] {
	return Array.isArray(v) ? v.filter((x):x is string => typeof x === 'string' && x.trim().length > 0) : [];
}

/** The model's edits, for the owners it was shown. Anything else in the reply is ignored. */
function readEdits(content:string, owners:Owner[]):MemoryEdit[] {
	let raw:unknown;
	try {
		raw = extractJson(content);
	}
	catch {
		return [];
	}
	if (!isRecord(raw)) {
		return [];
	}
	return owners.flatMap(({ id }) => {
		const row = raw[id];
		if (!isRecord(row)) {
			return [];
		}
		const rewrite = Array.isArray(row.rewrite)
			? row.rewrite.flatMap((r) => (isRecord(r) && typeof r.id === 'string' && typeof r.text === 'string' ? [{ id: r.id, text: memoryText(r.text) }] : []))
			: [];
		return [{ id, remove: strings(row.remove), rewrite, add: strings(row.add).map(memoryText).filter(Boolean) }];
	});
}
