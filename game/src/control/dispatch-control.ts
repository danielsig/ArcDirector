import { Time } from '@arc-director/kindling';
import { formatArc, parseArc, showNamingText, type ArcResult } from 'arc-director';
import { filterAiLog, type AiLogQuery, type AiLogRow, type CastRows, type CharacterRow, type Command, type ReconnectResult } from '@arc-director/control';
import type { Session } from '../engine/Session';
import { coercePrefsPatch, prefs, setPrefs } from '../prefs';
import { PlayerPilot } from '../characters/PlayerPilot';
import { findObject } from '../director/names';
import { aiLogRow } from '../director/ai-log-sink';
import { CameraFocus } from '../engine/CameraFocus';
import { FollowCamera } from '../engine/components';

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
		case 'renderStats':
			return { scene: session.scene.id, ...session.gameObject.world?.renderer?.stats(), ...session.gameObject.world?.perf.stats() };
		case 'saveGame': {
			const save = session.slot.save();
			if (!save) {
				throw new Error('Save failed');
			}
			return { savedUTC: save.savedUTC };
		}
		case 'loadGame': {
			if (!session.reboot('save')) {
				throw new Error('No save');
			}
			const reconnect:ReconnectResult = { reconnect: true };
			return reconnect;
		}
		case 'setCamera':
			return setCamera(session, command);
		default:
			throw new Error('unknown command');
	}
}

/** Puts the camera at `view`, sets what it follows and how far back it sits; answers whom the focus picks now. */
function setCamera(session:Session, { focus, zoom, view }:Extract<Command, { op:'setCamera' }>):{ focus:string; picks:string[] | { error:string } } {
	const camera = session.gameObject.getComponent(CameraFocus);
	if (!camera) {
		throw new Error('no camera focus in this scene');
	}
	if (view) {
		// The call boot makes for `?view=`. A focus left on would glide the rig off it again.
		session.pose.snapTo(view);
		camera.expr = '';
	}
	if (focus !== undefined) {
		camera.expr = focus.trim();
	}
	const rig = session.gameObject.world?.findByID('MainCamera')?.getComponent(FollowCamera);
	if (rig && zoom !== undefined) {
		rig.distance = zoom;
	}
	return { focus: camera.expr, picks: camera.expr ? camera.picks() : [] };
}

/** Who thinks for `character`: its collective, its own mind, or no one. */
function mindKind(character:{ collective:object | null; mind:object | null }):CharacterRow['mind'] {
	return character.collective ? 'collective' : character.mind ? 'own' : 'none';
}

function listCharacters(session:Session):CastRows {
	const arc = session.director.arc;
	return {
		characters: (arc?.characters() ?? []).map((character) => {
			const collective = character.collective;
			const tags = character.tags.map((t) => collective?.shortOf(t) ?? t).filter((t) => t.length > 0);
			const last = character.lastResult;
			const pos = findObject(session.director.world, character.id)?.transform.position;
			return {
				id: character.id,
				mind: mindKind(character),
				collective: collective?.id,
				tags: tags.length > 0 ? tags : undefined,
				arc: character.arc ? formatArc(character.arc) : undefined,
				verb: character.verb || undefined,
				last: last ? `${last.verb ?? ''} ${last.status === 'ok' ? 'ok' : 'failed'}${last.reason ? `: ${showNamingText(last.reason)}` : ''}` : undefined,
				at: pos ? [Math.round(pos.x * 10) / 10, Math.round(pos.z * 10) / 10] : undefined,
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

type ArcResultRow = Pick<ArcResult, 'status' | 'verb'> & { reason?:string };

function resultRow(result:ArcResult):ArcResultRow {
	return { status: result.status, verb: result.verb, reason: result.reason && showNamingText(result.reason) };
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
		mind: mindKind(character),
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
	const out = await mind.thinkNow({ now: Time.time, about, enact });
	return {
		mind: mind.id,
		arc: out ? formatArc(out, mind.owner.verbs) : null,
		// Under a director a think enacts its Arc unless told not to.
		enacted: enact ?? true,
	};
}

function logEntries(session:Session, query:AiLogQuery):AiLogRow[] {
	return filterAiLog(session.director.log.map(aiLogRow), query);
}
