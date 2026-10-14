import { Time, type GameObject } from '@arc-director/kindling';
import type { SpeechUtterance } from 'arc-director';
import { Alarm, MarketNPC, Wanted } from '../engine/components';
import { distXZ } from '../items/inventory';
import { USE_RANGE } from '../items/pickup';
import type { GameHost } from './adapter';
import { findObject, idOf } from './names';
import { showSpeech } from './playerTalk';

/** How long a cry keeps guards running, in seconds of game time. */
const ALARM_LIFE = 24;

/**
 * A word that pulls the watch. Whole words only, so "helpful" is not "help".
 * The first match is the word the guard answers.
 */
const SECURITY_WORD = /\b(thefts?|thieves|thief|stolen|stole|stealing|steals?|robberies|robbery|robbers?|robbing|robbed|muggings?|muggers?|mugged|helps?|helped|helping)\b/i;

export function securityWord(text:string):string | undefined {
	return text.match(SECURITY_WORD)?.[1]?.toLowerCase();
}

function answerLine(word:string):string {
	return word.startsWith('help') ? 'Hold. What do you need?' : 'Hold. Who stole?';
}

/** A cry from anyone but a guard. A thief is already chased; a guard does not answer their own word. */
export function noteSecurityCry(host:GameHost, utterance:SpeechUtterance):void {
	const word = securityWord(utterance.text);
	if (!word) {
		return;
	}
	const speaker = findObject(host.world, utterance.speakerID);
	if (!speaker || speaker.getComponent(MarketNPC)?.kind === 'guard' || speaker.getComponent(Wanted)?.enabled) {
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
	host.world.forEachComponent(MarketNPC, (npc, go) => {
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
		const guard = guards.find((go) => distXZ(go, crier) <= USE_RANGE);
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
