import {
	Agent,
	formatArc,
	isCrowdConductor,
	parseArc,
	type Actor,
	type ArcResult,
	type CrowdConductor,
	type CrowdUnit,
} from 'arc-director';
import type { ActorRow, AiLogQuery, Command, ReconnectResult } from '@arc-director/control';
import type { Session } from '../engine/Session';
import { coercePrefsPatch, prefs, setPrefs } from '../prefs';
import type { AgentCtx } from '../npc/types';
import { PlayerPilot } from '../actors/PlayerPilot';

export async function dispatchControl(session:Session, command:Command):Promise<unknown> {
	switch (command.op) {
		case 'listActors':
			return { actors: listActors(session) };
		case 'runVerb':
			return runVerb(session, command.actor, command.arc);
		case 'getPrefs':
			return prefs();
		case 'setPref':
			return setPrefs(coercePrefsPatch(command.patch), command.persist !== false);
		case 'think':
			return think(session, command.actor, command.about, command.enact);
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

function listActors(session:Session):ActorRow[] {
	const actors:ActorRow[] = [];
	for (const actor of session.director.arc?.actors() ?? []) {
		actors.push({ id: actor.id, kind: actor instanceof Agent ? 'agent' : 'actor' });
		if (isCrowdConductor(actor)) {
			for (const unit of actor.crowd.list()) {
				actors.push({
					id: unit.id,
					kind: 'unit',
					conductor: actor.id,
					tags: unit.tags.map((t) => actor.shortOf(t)).filter((t) => t.length > 0),
				});
			}
		}
	}
	return actors;
}

async function runVerb(session:Session, actor:string, text:string):Promise<ArcResultRow> {
	const found = locate(session, actor);
	if ('unit' in found) {
		return resultRow(await found.actor.enactUnit(found.unit, parseArc(text, found.actor.verbs)));
	}
	const body = found.actor;
	if (isCrowdConductor(body)) {
		const units = body.crowd.list().map((u) => u.id).join(', ') || 'none';
		throw new Error(`${actor} is a crowd conductor; run verbs on a unit (${units})`);
	}
	if (session.gameObject.world?.findByID(body.id)?.getComponent(PlayerPilot)) {
		return resultRow(await session.director.enactPlayer(text));
	}
	return resultRow(await body.enact(parseArc(text, body.verbs)));
}

type ArcResultRow = Pick<ArcResult, 'ok' | 'verb' | 'reason'> & { interrupted:boolean };

/** A preempted step that still failed counts as interrupted: something else took the body. */
function resultRow(result:ArcResult):ArcResultRow {
	return {
		ok: result.ok,
		verb: result.verb,
		reason: result.reason,
		interrupted: !!result.interrupted || (!!result.preempted && !result.ok),
	};
}

async function think(
	session:Session,
	actor:string,
	about:string | undefined,
	enact:boolean | undefined,
):Promise<unknown> {
	const found = locate(session, actor);
	if ('unit' in found) {
		throw new Error(`${actor} is a crowd unit of ${found.actor.id}`);
	}
	const agent = found.actor;
	if (!(agent instanceof Agent)) {
		throw new Error(`${actor} has no mind to think with`);
	}
	const arc = await agent.thinkNow({ now: session.gameObject.world?.time, about, enact });
	return {
		arc: arc ? formatArc(arc, agent.verbs) : null,
		enacted: enact ?? agent.autoEnact,
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

type Located =
	| { actor:Actor<AgentCtx> }
	| { actor:CrowdConductor<AgentCtx>; unit:CrowdUnit };

/** An actor by id, else the crowd unit with that id and its conductor. */
function locate(session:Session, id:string):Located {
	const direct = session.director.arc?.actor(id);
	if (direct) {
		return { actor: direct };
	}
	const found = session.director.agentByID(id);
	const unit = isCrowdConductor(found) ? found.crowd.get(id) : undefined;
	if (isCrowdConductor(found) && unit) {
		return { actor: found, unit };
	}
	throw new Error(`no actor ${id}`);
}
