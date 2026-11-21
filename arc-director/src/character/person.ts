import { idSegment, joinTextWithIDs, type TextSegment, type TextWithIDs } from './text-with-ids.js';

/**
 * One person in every memory. Text keeps everyone by id, its holder too, and each reader is shown it in its own
 * person: itself as "you", anyone else by name (`[Bill] went to the store`: `You went to the store` to Bill, `Bill went
 * to the store` to Ann). A note a model or a designer writes comes in "I" or "you"; its words for its writer become the
 * writer's id as it is kept, its verbs said to "you". Nothing inside double quotes or backticks changes: a quoted line
 * keeps its speaker's words, code its own. The tables are English and data; a port or a game in another language
 * brings its own.
 */

/** A note's words for its writer, and what each is kept as after the writer's id. Subjects first: their verb agrees. */
const WRITER_WORDS:Readonly<Record<string, string>> = {
	I: '', you: '', 'I\'m': ' are', 'I\'ve': ' have', 'I\'ll': '\'ll', 'I\'d': '\'d',
	'you\'re': ' are', 'you\'ve': ' have', 'you\'ll': '\'ll', 'you\'d': '\'d',
	me: '', my: '\'s', your: '\'s', myself: '\'self', yourself: '\'self',
};

/** A collective's own words for itself, the same way. */
const GROUP_WORDS:Readonly<Record<string, string>> = {
	we: '', 'we\'re': ' are', 'we\'ve': ' have', 'we\'ll': '\'ll', 'we\'d': '\'d',
	us: '', our: '\'s', ourselves: '\'self',
};

/** Whether `word` is a subject: the verb after one is kept as said to "you" (`I am` is kept `[Cy] are`). */
function subject(word:string | undefined):boolean {
	return word === 'I' || /^(you|we)$/i.test(word ?? '');
}

/** The verbs that agree with who comes before them: as said to "you", and of anyone else. */
const AGREE:readonly { you:string; other:string; forms:readonly string[] }[] = [
	{ you: 'are', other: 'is', forms: ['am', 'are', 'is'] },
	{ you: 'were', other: 'was', forms: ['were', 'was'] },
	{ you: 'have', other: 'has', forms: ['have', 'has'] },
	{ you: 'do', other: 'does', forms: ['do', 'does'] },
	{ you: 'aren\'t', other: 'isn\'t', forms: ['aren\'t', 'isn\'t'] },
	{ you: 'weren\'t', other: 'wasn\'t', forms: ['weren\'t', 'wasn\'t'] },
	{ you: 'haven\'t', other: 'hasn\'t', forms: ['haven\'t', 'hasn\'t'] },
	{ you: 'don\'t', other: 'doesn\'t', forms: ['don\'t', 'doesn\'t'] },
];

const VERB = new RegExp(`^ (${AGREE.flatMap((row) => row.forms).join('|')})\\b`, 'i');

/** `next`, the text after an id, with the verb it starts with as said to "you" (`you`) or of anyone else. */
function agree(next:string, form:'you' | 'other'):string {
	const verb = VERB.exec(next);
	const row = verb && AGREE.find((agreed) => agreed.forms.includes(verb[1].toLowerCase()));
	return row ? ` ${row[form]}${next.slice(verb[0].length)}` : next;
}

/** Whether an odd number of double quotes stands in `text`: what follows is inside a quote. */
function opens(text:string):boolean {
	return (text.match(/"/g) ?? []).length % 2 === 1;
}

/**
 * `text`, a note, with its words for its `writer` as the writer's id, outside quotes and backticks: `I am owed my cart`
 * is kept `[Cy] are owed [Cy]'s cart`. With a `group`, a collective's words for itself (`we`, `our`) become its id. A
 * curly apostrophe is one.
 */
export function writerToID(text:TextWithIDs, writer:string, group?:string):TextWithIDs {
	const words = { ...WRITER_WORDS, ...group ? GROUP_WORDS : {} };
	const keys = Object.keys(words);
	// Longest first, so `I'm` is read before `I`.
	const spellings = [...keys].sort((a, b) => b.length - a.length).map((word) => word.replace('\'', '[\'’]'));
	const pattern = new RegExp(`(?<![\\w'’])(${spellings.join('|')})(?![\\w'’])`, 'gi');
	const swap = (piece:string):(string | TextWithIDs)[] => {
		const bits = piece.split(pattern);
		return bits.map((bit, k) => {
			const plain = bit.replace('’', '\'');
			// "I" is the pronoun only in capitals; "US" is no "us".
			const key = k % 2 === 1 ? keys.find((word) => word.toLowerCase() === plain.toLowerCase() && (word !== 'I' || bit === 'I')) : undefined;
			if (key === undefined || bit === 'US') {
				// No word for the writer. Right after a subject that was one (`I am`), its verb is kept as said to "you".
				return k % 2 === 0 && k > 0 && subject(bits[k - 1]) ? agree(bit, 'you') : bit;
			}
			return ['', key in GROUP_WORDS ? group! : writer, words[key]];
		});
	};
	// A quote or code can run on past an id, so whether it is open carries across the text's parts.
	let inside = '';
	const swapOutside = (part:string):TextWithIDs => joinTextWithIDs(...part.split(/(["`])/).flatMap((piece) => {
		if (piece === '"' || piece === '`') {
			inside = inside === piece ? '' : inside || piece;
			return [piece];
		}
		return inside ? [piece] : swap(piece);
	}));
	return joinTextWithIDs(...text.map((part, i) => (i % 2 === 1 ? ['', part, ''] : swapOutside(part))));
}

/**
 * `text` as its reader reads it: each id it `is` as "you" (`You` where a sentence starts, `your` before what it owns,
 * `yourself`), anyone else by `name` (`Bill`, `Bill's`, `Bill` for `'self`; `start` where a sentence starts), and every
 * id inside double quotes by name. A note of `writer`'s keeps its verbs as said to "you", and anyone else reads the
 * writer's verb in the third person (`[Cy] are` is `Cy is`). In any other text only the reader's verb changes, where
 * its id starts a clause: it is said to "you" (`[Dee] has no shot` is `You have no shot` to Dee).
 */
export function showInPerson(text:TextWithIDs, is:(id:string)=>boolean, name:(id:string, start:boolean)=>string, writer?:string):string {
	return personSegments(text, is, name, writer).map((piece) => piece.text).join('');
}

/** {@link showInPerson} in pieces for a host, each id's piece with its id ({@link TextSegment}). */
export function personSegments(text:TextWithIDs, is:(id:string)=>boolean, name:(id:string, start:boolean)=>string, writer?:string):TextSegment[] {
	const parts = [...text];
	const pieces:TextSegment[] = [];
	let out = '';
	for (let i = 0; i < parts.length; i++) {
		let part = parts[i];
		if (i % 2 === 0) {
			out += part;
			if (part) {
				pieces.push({ text: part });
			}
			continue;
		}
		const quoted = opens(out);
		const self = !quoted && is(part);
		let next = parts[i + 1] ?? '';
		const start = out.trim() === '' || /[.!?]["')\]]*\s+$|\n\s*$/.test(out);
		const clause = start || /([,;:]|\b(and|or))\s*$/i.test(out);
		if (next.startsWith('\'self')) {
			next = next.slice('\'self'.length);
			part = self ? 'yourself' : name(part, start);
		}
		else if (next.startsWith('\'s') && self) {
			part = 'your';
			next = next.slice(2);
		}
		else {
			part = self ? 'you' : name(part, start);
			if (!quoted && writer === undefined && self && clause) {
				next = agree(next, 'you');
			}
			else if (!quoted && !self && text[i] === writer) {
				next = agree(next, 'other');
			}
		}
		if (self && start) {
			part = part.charAt(0).toUpperCase() + part.slice(1);
		}
		out += part;
		pieces.push(idSegment(part, text[i]));
		parts[i + 1] = next;
	}
	return pieces;
}
