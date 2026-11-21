/**
 * Text that names characters, things and places by id, as memories, heard lines, results and events keep it: even
 * entries are plain text, odd entries ids (`['', 'npc_3', ' last saw ', 'npc_17', ' at the ', 'well_2', '.']`). The
 * library builds its own lines so ({@link joinTextWithIDs}); a host's event, a verb's reason and a memory name ids
 * through a text function ({@link NamingText}), read once where it enters the library ({@link namedText}). Each mind
 * shows it in its own names by joining it ({@link showTextWithIDs}). Only text a model wrote in its names is read for
 * them, once, as it is kept ({@link parseTextWithIDs}). Internal: hosts write
 * {@link NamingText} and read display strings and `segments()`.
 */
export type TextWithIDs = string[];

const VOICE = 'voice:';

/**
 * The id a heard voice goes by in text: its own, so each reader tells it apart from the one it is of until it sees them
 * speak ({@link NameBook.hear}). A host never gets it: segments give the person's id.
 */
export function voiceOf(id:string):string {
	return VOICE + id;
}

/** Whom an id is of: the person a voice is ({@link voiceOf}); any other id itself. */
export function personOf(id:string):string {
	return id.startsWith(VOICE) ? id.slice(VOICE.length) : id;
}

/** A piece of text as a host reads it: plain, or naming `id`, with `voice` where the one named was heard, not seen. */
export type TextSegment = { text:string; id?:string; voice?:true };

/** The piece `text` naming `id`: a voice's, by its person ({@link TextSegment}). */
export function idSegment(text:string, id:string):TextSegment {
	const person = personOf(id);
	return person === id ? { text, id } : { text, id: person, voice: true };
}

/**
 * Text that names characters, things and places by id, as a host or a verb writes it: a plain string names no one; a
 * function is handed `name`, which it calls for each id it names (`(name) => \`${name(a)} is out of earshot\``), so each
 * reader shows it in its own names. The C# and C++ ports take the function form only (a plain string is one that
 * names no one).
 */
export type NamingText = string | ((name:(id:string)=>string)=>string);

/** `text` written out, each id it names as `name` calls it (the id itself by default). */
export function showNamingText(text:NamingText, name:(id:string)=>string = (id) => id):string {
	return typeof text === 'string' ? text : text(name);
}

/** `text` as {@link NamingText}, where the library hands its own text out as a host's (a saved reason, an event). */
export function namingText(text:TextWithIDs):NamingText {
	return (name) => showTextWithIDs(text, name);
}

/** Saved text read back: a string names no one, an array of strings is TextWithIDs. */
export function readTextWithIDs(json:unknown):TextWithIDs {
	return Array.isArray(json) ? json.map(String) : [typeof json === 'string' ? json : ''];
}

/** `pieces` in order: a string is plain text, an array is TextWithIDs spliced in. Adjacent text is merged. */
export function joinTextWithIDs(...pieces:(string | TextWithIDs)[]):TextWithIDs {
	const out:TextWithIDs = [''];
	for (const piece of pieces) {
		const parts = typeof piece === 'string' ? [piece] : piece;
		parts.forEach((part, i) => {
			if (i % 2 === 1) {
				out.push(part, '');
			}
			else {
				out[out.length - 1] += part;
			}
		});
	}
	return out;
}

/** `ids` as TextWithIDs, between `separator`s: `Ann, Bo`. */
export function listIDs(ids:readonly string[], separator = ', '):TextWithIDs {
	return joinTextWithIDs(...ids.flatMap((id, i) => [i > 0 ? separator : '', ['', id, '']]));
}

/** A host's text as TextWithIDs: each id its function names, by the name it is handed, becomes an id. */
export function namedText(text:NamingText):TextWithIDs {
	if (typeof text === 'string') {
		return [text];
	}
	const ids:string[] = [];
	return text((id) => `\u0000${ids.push(id) - 1}\u0000`).split('\u0000').map((part, i) => (i % 2 === 1 ? ids[Number(part)] : part));
}

/** The ids `text` names, in order. */
export function idsIn(text:TextWithIDs):string[] {
	return text.filter((part, i) => i % 2 === 1);
}

/** `text` with each id written as `name` calls it; `start` says whether nothing comes before it. */
export function showTextWithIDs(text:TextWithIDs, name:(id:string, start:boolean)=>string = (id) => id):string {
	let out = '';
	text.forEach((part, i) => {
		out += i % 2 === 1 ? name(part, out.trim() === '') : part;
	});
	return out;
}

/** `text` in pieces for a host, each id's piece written by `name`; `start` says whether nothing comes before it. */
export function textSegments(text:TextWithIDs, name:(id:string, start:boolean)=>string):TextSegment[] {
	let before = '';
	return text.flatMap((part, i) => {
		const piece = i % 2 === 1 ? name(part, before.trim() === '') : part;
		before += piece;
		return i % 2 === 1 ? [idSegment(piece, part)] : part ? [{ text: part }] : [];
	});
}

/** `text` as TextWithIDs: each word `idOf` knows (a name a mind gave) becomes its id; every other word stays text. */
export function parseTextWithIDs(text:string, idOf:(word:string)=>string | undefined):TextWithIDs {
	return joinTextWithIDs(...text.split(/([A-Za-z_][A-Za-z0-9_]*)/).map((part, i) => {
		const id = i % 2 === 1 ? idOf(part) : undefined;
		return id === undefined ? part : ['', id, ''];
	}));
}

/**
 * A PascalCase name as a screen shows it: words split apart (`OldBram` is `Old Bram`, `FigureA` is `Figure A`), in
 * title case for a character, in sentence case for anything else (`cottage bookshelf`, `book A`). A word in capitals
 * (a label's letters) keeps them. `character` unknown: only split.
 */
export function displayName(name:string, character?:boolean):string {
	const words = name.replace(/_/g, ' ').replace(/([a-z0-9])([A-Z])|([a-z])([0-9])|([A-Z])([A-Z][a-z])/g, (hit, ...g:(string | undefined)[]) => `${g[0] ?? g[2] ?? g[4]} ${g[1] ?? g[3] ?? g[5]}`).split(' ');
	if (character === undefined) {
		return words.join(' ');
	}
	return words.map((word) => (/^[A-Z]+$/.test(word) ? word : character ? word.charAt(0).toUpperCase() + word.slice(1) : word.toLowerCase())).join(' ');
}
