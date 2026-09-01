import type { Agent } from 'arc-director';
import { NPCInput } from '../actors/NPCInput';
import { Companion } from '../engine/components';
import type { GameObject } from '../engine/GameObject';
import type { GameHost } from './adapter';
import { findBody } from './names';
import type { HostCtx } from './types';

export function orderStations(text:string):boolean {
	return /\b(stay|remain|wait here|wait there|inside|in the house|in the cottage|go back|don'?t come|do not come|stop following|don'?t follow|do not follow|no longer follow)\b/i.test(text);
}

export function orderFollows(text:string):boolean {
	if (orderStations(text)) {
		return false;
	}
	return /\b(follow|come here|come with|with me|join me)\b/i.test(text);
}

export function takePlayerOrder(host:GameHost, id:string, text:string):void {
	const actor = host.world.findByID(id) ?? findBody(host.world, id);
	const bond = actor?.getComponent(Companion);
	if (!actor || !bond) {
		return;
	}
	if (orderStations(text)) {
		bond.hold = true;
	}
	else if (orderFollows(text)) {
		bond.hold = false;
	}
	const agent = host.agentByID(id);
	if (agent) {
		const existing = agent.memory.pinned().find((row) => (
			row.tags.includes('Player') && row.tags.includes('order')
		));
		const line = `Player ordered: "${text}"`;
		if (existing) {
			existing.text = line;
		}
		else {
			agent.memory.add({
				category: 'episodic',
				text: line,
				tags: ['Player', 'order'],
				pinned: true,
			}, host.world.time);
		}
	}
	if (bond.hold) {
		const npc = actor.getComponent(NPCInput);
		if (npc?.headingTo() === bond.targetID || npc?.headingTo() === 'Player') {
			void npc.wait(0.2);
		}
	}
}

export function restoreCompanionHold(_host:GameHost, actor:GameObject, agent:Agent<HostCtx>):void {
	const bond = actor.getComponent(Companion);
	if (!bond) {
		return;
	}
	const pin = agent.memory.pinned().find((row) => (
		row.tags.includes('Player')
		&& (row.tags.includes('order') || row.tags.includes('follow') || row.tags.includes('identity'))
	));
	if (pin) {
		bond.hold = orderStations(pin.text);
	}
}
