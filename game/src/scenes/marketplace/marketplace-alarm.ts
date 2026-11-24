import { Time, distanceXZ, type GameObject } from '@arc-director/kindling';
import { SayTone, type SpeechUtterance } from 'arc-director';
import { Alarm, MarketplaceNPC, Wanted, idOf } from '../../engine/components';
import { USE_RANGE } from '../../items/pickup';
import type { GameHost } from '../../director/adapter';
import { findObject } from '../../director/names';
import { showSpeech } from '../../director/player-talk';

/** How long a cry keeps guards running, in seconds of game time. */
const ALARM_LIFE = 24;

/** A theft word pulls the watch however it is said. Whole words only. */
const THEFT_WORD = /\b(thefts?|thieves|thief|stolen|stole|stealing|steals?|robberies|robbery|robbers?|robbing|robbed|muggings?|muggers?|mugged)\b/i;

/** Tones that make "help" a call. Said plainly ("can you help me find the baker?"), it is no cry. */
const CALLS:readonly SayTone[] = [SayTone.Shout, SayTone.Scream];

/**
 * The word the guard answers in a line, if it pulls the watch: a theft word, else "help" as a call, shouted, screamed
 * or with a "!" ("Help!", "Help me, please!").
 */
export function securityWord({ text, as }:Pick<SpeechUtterance, 'text' | 'as'>):string | undefined {
	const called = text.includes('!') || CALLS.some((tone) => tone === as);
	return text.match(THEFT_WORD)?.[1]?.toLowerCase() ?? (called && /\bhelp\b/i.test(text) ? 'help' : undefined);
}

function answerLine(word:string):string {
	return word === 'help' ? 'Hold. What do you need?' : 'Hold. Who stole?';
}

/** A cry from anyone but a guard. A thief is already chased; a guard does not answer their own word. */
export function noteSecurityCry(host:GameHost, utterance:SpeechUtterance):void {
	const word = securityWord(utterance);
	if (!word) {
		return;
	}
	const speaker = findObject(host.world, utterance.speakerID);
	if (!speaker || speaker.getComponent(MarketplaceNPC)?.kind === 'guard' || speaker.getComponent(Wanted)?.enabled) {
		return;
	}
	const alarm = speaker.getOrAddComponent(Alarm);
	alarm.enabled = true;
	alarm.until = Time.time + ALARM_LIFE;
	alarm.word = word;
	const who = idOf(speaker);
	host.arc?.pushEvent({
		kind: 'Cry',
		text: `${who} cried "${word}": ${utterance.text.trim()}`,
		tags: ['alarm', word, who],
		remember: true,
		major: false,
	});
	host.world.setMessage(`${who} cried ${word}`);
}

/** The first guard in reach speaks and the cry ends, so the rest go back to their gates. */
export function answerCries(host:GameHost):void {
	const now = Time.time;
	const guards:GameObject[] = [];
	host.world.forEachComponent(MarketplaceNPC, (npc, go) => {
		if (npc.kind === 'guard') {
			guards.push(go);
		}
	});
	host.world.forEachComponent(Alarm, (alarm, crier) => {
		if (!alarm.enabled) {
			return;
		}
		if (now >= alarm.until) {
			alarm.enabled = false;
			return;
		}
		const guard = guards.find((go) => distanceXZ(go, crier) <= USE_RANGE);
		if (!guard) {
			return;
		}
		const word = alarm.word;
		alarm.enabled = false;
		alarm.word = '';
		showSpeech(host, guard, answerLine(word));
		host.world.setMessage(`${idOf(guard)} answered ${idOf(crier)}`);
	});
}
