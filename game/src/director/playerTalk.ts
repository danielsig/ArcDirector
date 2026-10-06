import { pascalCase, type ArcResult, type SpeechUtterance, type VerbCall } from 'arc-director';
import { HumanBody, Named, SpeechBubble } from '../engine/components';
import type { GameObject } from '../engine/GameObject';
import type { World } from '../engine/World';
import { compactName, distXZ, listCarried } from '../items/inventory';
import { coinsOf, goodsAsk } from '../items/wallet';
import { parseSlash, SLASH_HELP, type ParsedSlash, type SayCatalog } from '../ui/sayCommands';
import type { GameHost } from './adapter';
import { bodyName, findBody, isLiving } from './names';
import type { AgentCtx } from './types';
import { carriedLabels } from './perception';
import { talkNotices, CLEAR_RANGE, SPEECH_LIFE } from './talkAttend';
import { settleBuy, settleGive, settlePay, settleSell, tooFar } from './items';
import { cueAt, talkAsks, talkDur, talkHz } from '../audio/cue';

const TALK_RANGE = CLEAR_RANGE;
const HEAR_RANGE = 16;
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
	const speaker = findBody(world, speakerID);
	const listener = findBody(world, listenerID);
	if (!speaker || !listener || speaker === listener) {
		return false;
	}
	return distXZ(speaker, listener) <= HEAR_RANGE;
}

export function nearbyTalkPeers(world:World, speakerID:string):string[] {
	const speaker = findBody(world, speakerID);
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
			hits.push({ name: bodyName(go), d });
		}
	}
	hits.sort((a, b) => a.d - b.d);
	return hits.map((h) => h.name);
}

export function nearestTalkPeer(world:World, speakerID:string):string | undefined {
	return nearbyTalkPeers(world, speakerID)[0];
}

export function playerSayCatalog(world:World):SayCatalog {
	const player = world.findByID('Player');
	const peers = nearbyTalkPeers(world, 'Player');
	const items = player ? carriedLabels(player) : [];
	const gold = player ? coinsOf(player) : 0;
	const goods:{ item:string; from:string }[] = [];
	const seen = new Set<string>();
	for (const name of peers) {
		const go = findBody(world, name);
		if (!go) {
			continue;
		}
		for (const it of listCarried(go)) {
			if (goodsAsk(it) === undefined) {
				continue;
			}
			const label = pascalCase(it.name) || it.name;
			const key = `${compactName(label)}:${compactName(name)}`;
			if (seen.has(key)) {
				continue;
			}
			seen.add(key);
			goods.push({ item: label, from: name });
		}
	}
	return { peers, items, gold, goods };
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
	const speaker = findBody(world, speakerID);
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
		const id = bodyName(go);
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
	const result = host.talk.say('Player', line, to, host.world.time);
	if (!result.ok) {
		host.world.setMessage(result.reason ?? 'no one heard');
	}
}

export function playerSlash(host:GameHost, slash:ParsedSlash):void {
	if (!slash.ok) {
		host.world.setMessage(slash.reason);
		return;
	}
	if (slash.verb === 'help') {
		host.world.setMessage(SLASH_HELP);
		pushChat(host, 'Help', SLASH_HELP);
		return;
	}
	const player = host.world.findByID('Player');
	if (!player) {
		host.world.setMessage('no player');
		return;
	}
	const result = runPlayerSlash(host, player, slash);
	host.world.setMessage(result.reason ?? '');
}

export function runPlayerSlash(
	host:GameHost,
	player:GameObject,
	slash:Exclude<ParsedSlash, { ok:false } | { ok:true; verb:'help' }>,
):ArcResult {
	if (slash.verb === 'give') {
		const target = playerReach(host, player, slash.to, 'give');
		if (!target.ok) {
			return target;
		}
		return settleGive(player, target.who, slash.item, host);
	}
	if (slash.verb === 'pay') {
		const target = playerReach(host, player, slash.to, 'give');
		if (!target.ok) {
			return target;
		}
		return settlePay(player, target.who, slash.amount, host);
	}
	if (slash.verb === 'buy') {
		const target = playerReach(host, player, slash.from, 'buy');
		if (!target.ok) {
			return target;
		}
		return settleBuy(player, target.who, slash.item, slash.offer ?? NaN, host);
	}
	if (slash.verb === 'sell') {
		const target = playerReach(host, player, slash.to, 'sell');
		if (!target.ok) {
			return target;
		}
		return settleSell(player, target.who, slash.item, slash.ask ?? NaN, host);
	}
	const unseen:never = slash;
	return { ok: false, verb: 'buy', reason: String(unseen) };
}

export function playerReach(
	host:GameHost,
	player:GameObject,
	name:string,
	verb:string,
):{ ok:true; who:GameObject } | { ok:false; verb:string; reason:string } {
	const who = findBody(host.world, name);
	if (!who) {
		return { ok: false, verb, reason: `no such person ${name}` };
	}
	const far = tooFar(player, who, name);
	if (far) {
		return { ok: false, verb, reason: far };
	}
	return { ok: true, who };
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
	const go = findBody(host.world, id);
	const named = go?.getComponent(Named);
	add(named?.id);
	for (const alias of named?.aliases ?? []) {
		add(alias);
	}
	return out;
}

export function pushChat(host:GameHost, speaker:string, text:string, to?:string, act = false):void {
	host.chat.push({ speaker, text, to, timestamp: host.world.time, act: act || undefined });
	if (host.chat.length > CHAT_CAP) {
		host.chat.splice(0, host.chat.length - CHAT_CAP);
	}
}

/** A successful verb aimed at another living body. `say` is already logged by talk. */
export function noteAct(host:GameHost, call:VerbCall<AgentCtx>, result:ArcResult):void {
	if (!result.ok || result.verb === 'say') {
		return;
	}
	const self = call.ctx.actor;
	let to:string | undefined;
	for (const value of Object.values(call.args)) {
		if (typeof value !== 'string') {
			continue;
		}
		const go = findBody(host.world, value);
		if (isLiving(go) && go !== self) {
			to = bodyName(go);
			break;
		}
	}
	if (!to) {
		return;
	}
	pushChat(host, bodyName(self), actText(result.verb ?? call.verb, call.args, result.reason), to, true);
}

function actText(verb:string, args:Record<string, unknown>, reason?:string):string {
	const title = verb.split('_').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
	const item = typeof args.item === 'string' ? args.item : '';
	if (!item) {
		return title;
	}
	const qty = Math.max(1, Math.floor(Number(args.quantity) || 1));
	const thing = `${qty}×${item}`;
	const gold = verb === 'buy' || verb === 'sell' ? reason?.match(/for (\d+) gold/)?.[1] : undefined;
	return gold && gold !== '0' ? `${title}: ${thing} for ${gold} gold` : `${title}: ${thing}`;
}

export function showSpeech(host:GameHost, actor:GameObject, text:string, to?:string, life = SPEECH_LIFE):void {
	const spoken = text.trim();
	if (!spoken) {
		return;
	}
	const bubble = actor.getOrAddComponent(SpeechBubble);
	bubble.text = spoken;
	bubble.until = host.world.time + life;
	bubble.timestamp = host.world.time;
	const hz = talkHz(actor.id);
	cueAt(host.world, 'talk', actor, {
		freq: hz,
		dur: talkDur(spoken),
		freqTo: talkAsks(spoken) ? hz * 1.35 : undefined,
	});
	pushChat(host, bodyName(actor), spoken, to);
}

export function onSpoke(host:GameHost, utterance:SpeechUtterance):void {
	const actor = findBody(host.world, utterance.speakerID);
	if (actor) {
		showSpeech(host, actor, utterance.text, chatTo(utterance.to));
	}
}
