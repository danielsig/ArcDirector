import { Time, type GameObject } from '@arc-director/kindling';
import { type ArcResult, type SpeechUtterance, type VerbCall } from 'arc-director';
import { HumanBody, Named } from '../engine/components';
import type { World } from '../engine/World';
import { distXZ } from '../items/inventory';
import { coinsOf } from '../items/wallet';
import { parseSlash, type ParsedSlash, type SayCatalog } from '../ui/sayCommands';
import type { GameHost } from './adapter';
import { idOf, findObject, isLiving } from './names';
import type { CharacterCtx } from './types';
import { carriedLabels } from './perception';
import { talkNotices, CLEAR_RANGE, HEAR_RANGE } from './talkAttend';

const TALK_RANGE = CLEAR_RANGE;
const CHAT_CAP = 80;

function chatTo(to?:string | string[]):string | undefined {
	if (to == null) {
		return undefined;
	}
	if (Array.isArray(to)) {
		return to.length === 1 ? to[0] : undefined;
	}
	return to;
}

export function inTalkRange(world:World, speakerID:string, listenerID:string):boolean {
	const speaker = findObject(world, speakerID);
	const listener = findObject(world, listenerID);
	if (!speaker || !listener || speaker === listener) {
		return false;
	}
	return distXZ(speaker, listener) <= HEAR_RANGE;
}

export function nearbyTalkPeers(world:World, speakerID:string):string[] {
	const speaker = findObject(world, speakerID);
	if (!speaker) {
		return [];
	}
	const hits:{ name:string; d:number }[] = [];
	for (const go of world.objects) {
		if (go === speaker || !go.getComponent(HumanBody)) {
			continue;
		}
		const d = distXZ(speaker, go);
		if (d <= TALK_RANGE) {
			hits.push({ name: idOf(go), d });
		}
	}
	hits.sort((a, b) => a.d - b.d);
	return hits.map((h) => h.name);
}

export function nearestTalkPeer(world:World, speakerID:string):string | undefined {
	return nearbyTalkPeers(world, speakerID)[0];
}

export function playerSayCatalog(host:GameHost):SayCatalog {
	const player = host.world.findByID('Player');
	const peers = nearbyTalkPeers(host.world, 'Player');
	const items = player ? carriedLabels(player) : [];
	const gold = player ? coinsOf(player) : 0;
	const offers:SayCatalog['offers'] = {};
	for (const offer of host.arc?.offers.all ?? []) {
		if (offer.to === undefined || offer.to === 'Player') {
			// The first offer of each good wins.
			const theirs = offers[offer.from.toLowerCase()] ??= { give: {}, get: {} };
			theirs.give = { ...offer.give, ...theirs.give };
			theirs.get = { ...offer.get, ...theirs.get };
		}
	}
	return { peers, items, gold, offers };
}

export function parseDirectedLine(spoken:string, peers:string[] = []):{ to:string; text:string } | undefined {
	const at = spoken.match(/^@(\S+)\s+([\s\S]+)$/);
	if (at) {
		const text = at[2].trim();
		if (!text) {
			return undefined;
		}
		return { to: matchPeer(at[1], peers) ?? at[1], text };
	}
	const vocative = spoken.match(/^([A-Za-z][A-Za-z0-9]+),\s+([\s\S]+)$/);
	if (!vocative) {
		return undefined;
	}
	const text = vocative[2].trim();
	const to = matchPeer(vocative[1], peers);
	if (!to || !text) {
		return undefined;
	}
	return { to, text };
}

function matchPeer(raw:string, peers:string[]):string | undefined {
	const want = raw.replace(/^@/, '').toLowerCase();
	return peers.find((p) => p.toLowerCase() === want);
}

export function talkOthers(world:World, speakerID:string):string[] {
	const speaker = findObject(world, speakerID);
	const names:string[] = [];
	for (const go of world.objects) {
		if (!go.getComponent(HumanBody)) {
			continue;
		}
		if (speaker) {
			if (!talkNotices(speaker, go)) {
				continue;
			}
		}
		else if (!world.npcCanSee(go)) {
			continue;
		}
		const id = idOf(go);
		if (id && id !== speakerID) {
			names.push(id);
		}
	}
	return names;
}

export function playerSay(host:GameHost, text:string):void {
	const spoken = text.trim();
	if (!spoken) {
		return;
	}
	const slash = parseSlash(spoken);
	if (slash) {
		playerSlash(host, slash);
		return;
	}
	const peers = nearbyTalkPeers(host.world, 'Player');
	const directed = parseDirectedLine(spoken, talkOthers(host.world, 'Player'));
	const line = directed?.text ?? spoken;
	const to = directed?.to ?? (peers.length <= 1 ? peers[0] : peers);
	const result = host.talk.say('Player', line, to, Time.time);
	if (!result.ok) {
		host.world.setMessage(result.reason ?? 'no one heard');
	}
}

export function playerSlash(host:GameHost, slash:ParsedSlash):void {
	if (!slash.ok) {
		host.world.setMessage(slash.reason);
		return;
	}
	// The player's character runs it like any other arc: it walks over first, as an NPC would.
	host.enactPlayer(slash.arc).then(
		(result) => host.world.setMessage(result.reason ?? ''),
		(err:unknown) => host.world.setMessage(err instanceof Error ? err.message : String(err)),
	);
}

export function talkNames(host:GameHost, id:string):string[] {
	const out:string[] = [];
	const add = (raw:string | undefined):void => {
		const name = raw?.trim();
		if (!name) {
			return;
		}
		if (out.some((row) => row.toLowerCase() === name.toLowerCase())) {
			return;
		}
		out.push(name);
	};
	add(id);
	const go = findObject(host.world, id);
	const named = go?.getComponent(Named);
	add(named?.id);
	for (const alias of named?.aliases ?? []) {
		add(alias);
	}
	return out;
}

export function pushChat(host:GameHost, speaker:string, text:string, to?:string, act = false):void {
	host.chat.push({ speaker, text, to, timestamp: Time.time, act: act || undefined });
	if (host.chat.length > CHAT_CAP) {
		host.chat.splice(0, host.chat.length - CHAT_CAP);
	}
}

/** A successful verb aimed at another living character. `say` is already logged by talk. A walk is not chat. */
export function noteAct(host:GameHost, call:VerbCall<CharacterCtx>, result:ArcResult):void {
	if (!result.ok || result.verb === 'say' || (result.verb ?? call.verb) === 'go_to') {
		return;
	}
	const self = call.ctx.character;
	let to:string | undefined;
	for (const value of Object.values(call.args)) {
		if (typeof value !== 'string') {
			continue;
		}
		const go = findObject(host.world, value);
		if (isLiving(go) && go !== self) {
			to = idOf(go);
			break;
		}
	}
	if (!to) {
		return;
	}
	pushChat(host, idOf(self), actText(result.verb ?? call.verb, call.args, result.reason), to, true);
}

function actText(verb:string, args:Record<string, unknown>, reason?:string):string {
	const title = verb.split('_').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
	if (verb === 'offer') {
		return reason ?? title;
	}
	const item = typeof args.item === 'string' ? args.item : '';
	if (!item) {
		return title;
	}
	const qty = Math.max(1, Math.floor(Number(args.quantity) || 1));
	return `${title}: ${qty}×${item}`;
}

/** The chat log gets the line now; bubble and voice take their turn in `host.speech`. */
export function showSpeech(host:GameHost, character:GameObject, text:string, to?:string):void {
	const spoken = text.trim();
	if (!spoken) {
		return;
	}
	host.speech.enqueue(character, spoken);
	pushChat(host, idOf(character), spoken, to);
}

export function onSpoke(host:GameHost, utterance:SpeechUtterance):void {
	const character = findObject(host.world, utterance.speakerID);
	if (character) {
		showSpeech(host, character, utterance.text, chatTo(utterance.to));
	}
	host.hooks.onSpoke?.(host, utterance);
}
