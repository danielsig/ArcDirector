import { formatArc, parseArc, type ArcResult } from 'arc-director';
import type { AiLogQuery, CastRows, Command, ReconnectResult } from '@arc-director/control';
import type { Session } from '../engine/Session';
import { coercePrefsPatch, prefs, setPrefs } from '../prefs';
import { PlayerPilot } from '../characters/PlayerPilot';

export async function dispatchControl(session:Session, command:Command):Promise<unknown> {
	switch (command.op) {
		case 'listCharacters':
			return listCharacters(session);
		case 'runVerb':
			return runVerb(session, command.character, command.arc);
		case 'getPrefs':
			return prefs();
		case 'setPref':
			return setPrefs(coercePrefsPatch(command.patch), command.persist !== false);
		case 'think':
			return think(session, command.id, command.about, command.enact);
		case 'setCollective':
			return setCollective(session, command.character, command.collective);
		case 'readAiLog':
			return { entries: logEntries(session, command) };
		case 'saveGame': {
			const save = session.save();
			if (!save) {
				throw new Error('Save failed');
			}
			return { savedUTC: save.savedUTC };
		}
		case 'loadGame': {
			if (!session.load()) {
				throw new Error('No save');
			}
			const reconnect:ReconnectResult = { reconnect: true };
			return reconnect;
		}
		default:
			throw new Error('unknown command');
	}
}

function listCharacters(session:Session):CastRows {
	const arc = session.director.arc;
	return {
		characters: (arc?.characters() ?? []).map((character) => {
			const collective = character.collective;
			const tags = character.tags.map((t) => collective?.shortOf(t) ?? t).filter((t) => t.length > 0);
			return {
				id: character.id,
				mind: collective ? 'collective' : character.mind ? 'own' : 'none',
				collective: collective?.id,
				tags: tags.length > 0 ? tags : undefined,
			};
		}),
		collectives: (arc?.collectives() ?? []).map((collective) => ({
			id: collective.id,
			commander: collective.commander?.id,
			characters: collective.characters.map((c) => c.id),
		})),
	};
}

async function runVerb(session:Session, id:string, text:string):Promise<ArcResultRow> {
	const character = session.director.characterOf(id);
	if (!character) {
		const collective = session.director.arc?.collective(id);
		throw new Error(collective
			? `${id} is a collective; run verbs on one of its characters (${collective.characters.map((c) => c.id).join(', ') || 'none'})`
			: `no character ${id}`);
	}
	if (session.gameObject.world?.findByID(character.id)?.getComponent(PlayerPilot)) {
		return resultRow(await session.director.enactPlayer(text));
	}
	return resultRow(await character.enact(parseArc(text, character.verbs)));
}

type ArcResultRow = Pick<ArcResult, 'ok' | 'verb' | 'reason'> & { interrupted:boolean };

/** A preempted step that still failed counts as interrupted: something else took over the character. */
function resultRow(result:ArcResult):ArcResultRow {
	return {
		ok: result.ok,
		verb: result.verb,
		reason: result.reason,
		interrupted: !!result.interrupted || (!!result.preempted && !result.ok),
	};
}

/** Move a character into a collective, or out of one: what it is in, and who thinks for it, after. */
function setCollective(session:Session, id:string, to:string | null):unknown {
	const character = session.director.characterOf(id);
	if (!character) {
		throw new Error(`no character ${id}`);
	}
	const collective = to === null ? null : session.director.arc?.collective(to);
	if (collective === undefined) {
		throw new Error(`no collective ${to}`);
	}
	character.collective = collective;
	return {
		character: character.id,
		collective: character.collective?.id ?? null,
		mind: character.collective ? 'collective' : character.mind ? 'own' : 'none',
	};
}

/** One think by the mind of character or collective `id`: a member thinks with its collective's mind. */
async function think(
	session:Session,
	id:string,
	about:string | undefined,
	enact:boolean | undefined,
):Promise<unknown> {
	const arc = session.director.arc;
	const mind = (session.director.characterOf(id) ?? arc?.collective(id))?.mind;
	if (!mind) {
		throw new Error(`${id} has no mind to think with`);
	}
	const out = await mind.thinkNow({ now: session.gameObject.world?.time, about, enact });
	return {
		mind: mind.id,
		arc: out ? formatArc(out, mind.owner.verbs) : null,
		enacted: enact ?? mind.autoEnact,
	};
}

function logEntries(session:Session, query:AiLogQuery):AiLogRow[] {
	const re = query.pattern ? new RegExp(query.pattern) : null;
	const after = query.after ?? -Infinity;
	const rows = session.director.log.filter((entry) => entry.seq > after
		&& (!query.name || entry.name === query.name)
		&& (!re || re.test(entry.name) || re.test(entry.message)));
	const kept = query.limit !== undefined && query.limit > 0 ? rows.slice(-query.limit) : rows;
	return kept.map((entry) => ({
		seq: entry.seq,
		name: entry.name,
		message: entry.message,
		image: !!entry.image,
	}));
}

type AiLogRow = {
	seq:number;
	name:string;
	message:string;
	image:boolean;
};
