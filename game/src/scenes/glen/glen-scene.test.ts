import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STOCK_VERB_DEFS, STOCK_VERBS, VerbRegistry, type MindEvent } from 'arc-director';
import { FakeProvider, soloCharacter } from 'arc-director/testing';
import { GLEN } from './glen-scene';

/** The memory BridgeKeeper keeps of what to do with a fee paid in goods. */
const SELLS_FEE = /sell any bridge fee paid in goods/;

/** What a played glen leaves BridgeKeeper remembering besides his own, crowding what comes to mind (from an AI log). */
const AFTERNOON = [
	'I last saw Chair: furnitures',
	'I last saw RiverChair: furnitures',
	'Forager bought 1 SilverTrout from Angler for 5 gold.',
	'The bridge is raised. The fee is ten gold or items of equal value.',
	'Five gold is not enough. The fee is ten gold or items of equal value.',
	'The records show no value for a spare key. Five gold and a key do not meet the ten gold requirement.',
	'The fee is paid. The bridge is lowered.',
	'Angler offers 1 SilverTrout for 5 gold to anyone.',
	'Do you have anything else of value to provide for the fee?',
	'The rules are clear. I must know if a key is worth the ten gold fee.',
	'As I have stated, five gold and a key do not meet the ten gold requirement. You must provide the full fee before I will consider the bridge.',
	'Forager asked to cross the bridge with five gold and a key.',
	'I lowered the bridge for Forager once the fee was paid.',
	'Payment for lowering the bridge lasts a full day.',
	'I never lower the bridge unpaid or underpaid, and I refund a payment that is too little or too much.',
	'I charge people a fee of ten gold for lowering the bridge, or goods of equal value, and never overcharge.',
	'A fee that lowered the bridge is mine to keep, gold or goods paid at their value.',
	'The bridge is lowered only once the fee is paid in gold or in goods of equal value.',
	'Charging people the fee for lowering the bridge gets me gold, if the bridge is raised.',
	'A payment that comes after the bridge is already lowered I refund, gold or goods.',
	'Underpaid is unpaid: the bridge stays raised until the whole fee of ten gold is paid.',
	'People pay the fee for lowering the bridge in gold, or in goods worth as much.',
];

/** A line `speakerID` said to BridgeKeeper. */
function said(speakerID:string, text:string):MindEvent {
	return { kind: 'HeardSpeech', remember: true, text: `${speakerID} says to BridgeKeeper: "${text}"`, tags: ['speech'], turn: { speakerID, to: ['BridgeKeeper'], text } };
}

/**
 * What BridgeKeeper's next think is shown of his memory after `event`: his own goals and memories from the glen and an
 * afternoon's worth more, and no embedding model, so only words and tags bring a memory to mind.
 */
async function remembersAfter(event:MindEvent):Promise<string> {
	const spec = GLEN.cast.find((member) => member.id === 'BridgeKeeper')!;
	const prompts:string[] = [];
	const provider = new FakeProvider((req) => {
		prompts.push(String(req.messages[req.messages.length - 1]?.content ?? ''));
		return { content: JSON.stringify({ steps: [{ verb: 'wait', seconds: 1 }] }), toolCalls: [] };
	});
	const keeper = soloCharacter<{ scene:string }>({
		id: spec.id,
		identity: spec.identity,
		goals: spec.goals,
		memories: [...spec.memories ?? [], ...AFTERNOON.map((text) => ({ text }))],
		provider,
		verbs: new VerbRegistry().addAll(STOCK_VERB_DEFS),
		kit: { verbs: STOCK_VERBS },
		senses: { environment: (ctx) => ctx.scene },
		tools: {},
		context: () => ({ scene: 'A windy river glen. Angler 2 paces in front of you.' }),
		model: 'fake',
		minThinkInterval: 0,
		toolRounds: 0,
		repairRetries: 0,
		strategicInterval: 0,
	});
	keeper.mind!.pushEvent(said('Forager', 'I only have five gold. Would a FireMushroom pay the fee?'));
	keeper.mind!.pushEvent({ ...event, major: true });
	await keeper.mind!.tick(1);
	const prompt = prompts[0] ?? '';
	return prompt.match(/You remember:[^]*?\n\n/)?.[0] ?? '';
}

test('BridgeKeeper remembers to sell a fee paid in goods when Angler would trade for his FireMushroom', async () => {
	assert.match(await remembersAfter(said('Angler', 'You got a FireMushroom earlier, didn\'t you? I\'d trade a SilverTrout for one.')), SELLS_FEE);
	assert.match(await remembersAfter(said('Angler', 'I would like to buy that FireMushroom from you.')), SELLS_FEE);
});

test('BridgeKeeper remembers to sell a fee paid in goods when Angler offers him gold for it', async () => {
	const offer:MindEvent = { kind: 'Offer', text: 'Angler offers you 10 gold for 1 FireMushroom. To accept: offer(to=Angler, give=FireMushroom:1, get=gold:10)', tags: ['offer'], remember: true };
	assert.match(await remembersAfter(offer), SELLS_FEE);
});

test('BridgeKeeper is not reminded to sell the fee by talk of something else, or an offer called out to anyone', async () => {
	assert.doesNotMatch(await remembersAfter(said('Angler', 'Fine weather for a stroll, isn\'t it?')), SELLS_FEE);
	const toAnyone:MindEvent = { kind: 'Offer', text: 'Angler offers 1 SilverTrout for 5 gold to anyone. To accept: offer(to=Angler, give=gold:5, get=SilverTrout:1)', tags: ['offer'], remember: true };
	assert.doesNotMatch(await remembersAfter(toAnyone), SELLS_FEE);
});
