import type { Agent } from 'arc-director';
import { NPCInput } from '../actors/NPCInput';
import { Companion } from '../engine/components';
import type { GameObject } from '../engine/GameObject';
import type { GameHost } from './adapter';
import { findBody } from './names';
import type { HostCtx } from './types';

export function orderStations(text:string):boolean {
	return /\b(stay|remain|wait here|wait there|wait inside|wait in\b|don'?t come|do not come|stop following|don'?t follow|do not follow|no longer follow)\b/i.test(text);
}

export function orderComes(text:string):boolean {
	return /\b(come\b|follow me|follow us|with me|after me)\b/i.test(text);
}

export function orderHoldsFollow(text:string):boolean {
	if (orderComes(text)) {
		return false;
	}
	return orderStations(text)
		|| /\b(go\b|into\b|toward|towards|head to|walk to|wander|enter|leave|fetch|bring)\b/i.test(text);
}

export function takePlayerOrder(host:GameHost, id:string, text:string):void {
	const actor = host.world.findByID(id) ?? findBody(host.world, id);
	const bond = actor?.getComponent(Companion);
	if (!actor || !bond) {
		return;
	}
	const comes = orderComes(text);
	const holds = orderHoldsFollow(text);
	if (comes) {
		bond.hold = false;
	}
	else if (holds) {
		bond.hold = true;
	}
	if (comes || holds) {
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
	const order = agent.memory.pinned().find((row) => (
		row.tags.includes('Player') && row.tags.includes('order')
	));
	if (!order) {
		bond.hold = false;
		return;
	}
	bond.hold = !orderComes(order.text);
}
