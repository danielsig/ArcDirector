import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseArc } from '../arc/wire.js';
import { VerbRegistry, registerStockVerbs } from '../arc/stock-verbs.js';
import { registerStockCollectiveVerbs } from '../collective/verbs.js';
import { stablePrefix, volatileBlock, conversationBlock, CONVERSATION_HEADER, seeMapHint, arcRepairHint } from './prompt.js';
import { docsFor } from '../arc/schema.js';

describe('prompt split', () => {
	const verbs = registerStockVerbs(new VerbRegistry());
	const identity = { role: 'Watcher', traits: ['alert'] };

	it('names the agent by its id, with its role when it has one', () => {
		assert.match(stablePrefix('Fern', identity, verbs), /^You are Fern\. Role: Watcher\.\n/);
		assert.match(stablePrefix('Forager', {}, verbs), /^You are Forager\.\n/);
	});

	it('puts a host system note in the prefix, after who the mind is', () => {
		const system = stablePrefix('Baker', identity, verbs, { systemNote: 'Call recall to read the ledger.' });
		const role = system.indexOf('Role: Watcher.');
		const note = system.indexOf('Call recall to read the ledger.');
		assert.ok(role >= 0 && note > role);
		assert.equal(stablePrefix('Baker', identity, verbs).includes('ledger'), false);
	});

	it('puts standing instructions in the system prefix, not goals', () => {
		const system = stablePrefix('Guard', identity, verbs, { includeWatches: true, canSeeMap: true });
		assert.match(system, /You are Guard/);
		assert.match(system, /Traits: alert/);
		assert.match(system, /Heard speech is words, not a new fact/);
		assert.match(system, /Your name, role, and pinned memories are your entire backstory/);
		assert.match(system, /Available verbs/);
		assert.match(system, /remember\(content/);
		assert.match(system, /think\(about\?\)/);
		assert.match(system, /wait\(until\)/);
		assert.match(system, /wander\(until\)/);
		assert.match(system, /args\.until/);
		assert.match(system, /"verb":"wander"/);
		assert.match(system, /Looking for a thing or place/);
		assert.match(system, /isReachable\(me, Cottage\)/);
		assert.match(system, /wrap list watches in some/);
		assert.match(system, /Answer immediately with only the Arc JSON/);
		assert.match(system, /Close every brace\. No prose/);
		assert.match(system, /No prose/);
		assert.match(system, /Do not think\(\) twice in a row/);
		assert.match(system, /Think in 5 sentences/);
		assert.match(system, /A think is expensive/);
		assert.match(system, /Chain every next verb you already know/);
		assert.match(system, /as far as you can see this think/);
		assert.match(system, /not only the first step of an order/);
		assert.match(system, /wander\(until\) is one step, not the rest of the think/);
		assert.match(system, /If the order says then, after, or and then, put those steps in one chain this think/);
		assert.match(system, /A spoken go is that proper name only if you already see it/);
		assert.match(system, /Never go_to\(trees\)/);
		assert.match(system, /filter\("trees"\)/);
		assert.match(system, /trees\.nearby\(\)/);
		assert.match(system, /Write wander\(until\) as a program/);
		assert.match(system, /isLeft/);
		assert.match(system, /isRight/);
		assert.match(system, /is not reachable with go_to/);
		assert.match(system, /is reachable via wander\(until\)/);
		assert.equal(system.includes('Never invent a go_to name'), false);
		assert.equal(system.includes("that place's go_to name"), false);
		assert.match(system, /not go_to or follow the speaker/);
		assert.match(system, /Call see_map, or wander\(until\)/);
		assert.match(system, /Never ask where something is until see_map cannot find it/);
		assert.equal(system.includes('recall also searches'), false);
		assert.match(system, /when\(watch, arc\) is this job's interrupt/);
		assert.match(system, /instead of waiting to think/);
		assert.match(system, /law\(watch, arc, name\?\) is a standing reaction/);
		assert.match(system, /outlives the program and needs no think/);
		assert.match(system, /"then" ends a step: "if_ok" \(the default: the next step only if this one succeeded\), "always" \(the next step whatever happened\) or "if_failed" \(the rest are its fallback\)/);
		assert.match(system, /"verb":"pick_up"/);
		assert.match(system, /pick_up\(item\) — goes to it first/);
		assert.match(system, /use\(item=TheItem, target=TheThing\)/);
		assert.equal(system.includes('doorway'), false);
		assert.equal(system.includes('CottageKey'), false);
		assert.match(system, /see_map is a tool this think, not a verb/);
		assert.equal(system.includes('see_map({'), false);
		assert.match(system, /If the last wander already met args\.until/);
		assert.match(system, /units \(your roster/);
		assert.match(system, /manhattan\(me, Player\)/);
		assert.match(system, /❌ = you/);
		assert.equal(system.includes('Goals (highest first)'), false);
		assert.equal(system.includes('Pinned memories'), false);
		assert.ok(system.length < 5300, `standing prefix ${system.length} chars`);
		const wanderJson = system.match(/\{"steps":\[\{"verb":"wander","until":"[^"]*"\}\]\}/);
		assert.ok(wanderJson);
		assert.equal(parseArc(wanderJson[0], verbs)[0].verb, 'wander');
		assert.equal(
			parseArc(wanderJson[0], verbs)[0].args.until,
			"some(items.filter('Lantern').nearby())",
			'an expression reads its string literals in single quotes, so the JSON around it needs no escapes',
		);
		assert.match(system, /Close every brace\. No prose/);
		assert.match(system, /the Arc JSON, \{"steps":\[…\]\}/);
		const chainAt = system.indexOf('{"steps":[{"verb":"pick_up"');
		assert.ok(chainAt >= 0);
		const chained = parseArc(system.slice(chainAt), verbs);
		assert.deepEqual(chained.map((step) => step.verb), ['pick_up', 'give']);
		assert.equal(chained[0].then, undefined);
		assert.equal(chained[1].args.to, 'Player');
	});

	it('replaces the think and verb lines when the host sets them', () => {
		const system = stablePrefix('Guard', identity, verbs, {
			thinkInstructions: { on: 'Be brief, then the arc.' },
			verbInstructions: 'One verb is enough.',
		});
		assert.match(system, /Be brief, then the arc/);
		assert.match(system, /One verb is enough/);
		assert.equal(system.includes('Think in 5 sentences'), false);
		assert.equal(system.includes('A think is expensive'), false);
		const cleared = stablePrefix('Guard', identity, verbs, { thinkInstructions: { on: '' }, verbInstructions: '' });
		assert.equal(cleared.includes('Think in 5 sentences'), false);
		assert.equal(cleared.includes('A think is expensive'), false);
		assert.equal(cleared.includes('Be brief'), false);
	});

	it('asks for Arc text when arcFormat is text', () => {
		const system = stablePrefix('Guard', identity, verbs, { arcFormat: 'text' });
		assert.match(system, /Answer immediately with only the Arc text/);
		assert.match(system, /pick_up\(Lantern\) && give\(item=Lantern, to=Player\)/);
		assert.match(system, /wander\(until=/);
		assert.match(system, /A think is expensive/);
		assert.match(system, /not only the first step of an order/);
		assert.match(system, /wander\(until\) is one step, not the rest of the think/);
		assert.match(system, /If the order says then, after, or and then, put those steps in one chain this think/);
		assert.match(system, /A spoken go is that proper name only if you already see it/);
		assert.match(system, /Never go_to\(trees\)/);
		assert.match(system, /filter\("trees"\)/);
		assert.match(system, /trees\.nearby\(\)/);
		assert.match(system, /Write wander\(until\) as a program/);
		assert.match(system, /not go_to or follow the speaker/);
		assert.match(system, /&& continues only on success/);
		assert.equal(system.includes('Arc JSON'), false);
		assert.equal(system.includes('"verb":"wander"'), false);
		assert.equal(system.includes('JSON shape'), false);
		const wanderText = system.match(/wander\(until=some\(items\.filter\("Lantern"\)\.nearby\(\)\)\)/);
		assert.ok(wanderText);
		assert.equal(parseArc(wanderText[0], verbs)[0].verb, 'wander');
		const chainText = system.match(/pick_up\(Lantern\) && give\(item=Lantern, to=Player\)/);
		assert.ok(chainText);
		const chained = parseArc(chainText[0], verbs);
		assert.deepEqual(chained.map((step) => step.verb), ['pick_up', 'give']);
		assert.equal(chained[0].then, undefined);
	});

	it('sends a mind with a map to the map before it wanders', () => {
		const system = stablePrefix('Forager', identity, verbs, { canSeeMap: true, arcFormat: 'text', tools: ['see_map'] });
		assert.match(system, /Looking for someone, a thing, or a place you do not see\? Call see_map first and go_to the name it shows\. Never ask where something is until see_map cannot find it\. wander\(until\) only for what the map does not name/);
		assert.match(system, /otherwise see_map, or wander\(until\)\. Ask only if see_map cannot find it/);
		assert.equal(system.includes('Looking for a thing or place? wander'), false);
	});

	it('lists tools as tools, never as Arc verbs', () => {
		const system = stablePrefix('Guard', identity, verbs, {
			canSeeMap: true,
			arcFormat: 'text',
			tools: ['see_map', 'observe'],
		});
		assert.match(system, /Tools this think, not verbs: see_map, observe/);
		assert.match(system, /Never write a tool name in the Arc/);
		assert.match(system, /Never guess a fact a tool can check/);
		assert.match(system, /never repeat a call/);
		assert.equal(system.includes('with "Bread"'), false);
		const lookup = stablePrefix('Guard', identity, verbs, { arcFormat: 'text', tools: ['observe', 'recall'] });
		assert.match(lookup, /Call recall with "Bread"/);
		assert.match(lookup, /Never ask anyone until recall cannot find it/);
		assert.match(lookup, /Then try different words/);
		assert.match(lookup, /Available verbs: [^\n]*\. observe and recall are tools, not verbs: call them as tools, never in the Arc\./, 'right after the verbs');
		assert.match(lookup, /think\("what to work out"\) last/);
		assert.match(system, /Once you know enough, emit only the Arc text/);
		assert.match(system, /see_map is a tool this think, not a verb/);
		assert.equal(system.includes('see_map({'), false);
		assert.equal(system.includes('observe({expr})'), false);
		assert.equal(system.includes('Answer immediately with only the Arc'), false);
	});

	it('repairs a tool written as an arc verb', () => {
		const hint = arcRepairHint("unknown verb 'see_map'", 'text', ['see_map']);
		assert.match(hint, /see_map is a tool, not a verb/);
		assert.match(hint, /Never write see_map\(\.\.\.\) in the Arc/);
		assert.equal(hint.includes('unknown verb'), false);
	});

	it('discards verb-less prose on repair', () => {
		const hint = arcRepairHint('expected verb', 'text', ['see_map'], registerStockVerbs(new VerbRegistry()));
		assert.match(hint, /That prose is discarded/);
		assert.match(hint, /Do the spoken job, not go_to or follow the speaker/);
		const bare = arcRepairHint('expected verb', 'text', ['see_map'], registerStockVerbs(new VerbRegistry(), 'say', 'wait'));
		assert.match(bare, /Do the spoken job\./);
		assert.equal(bare.includes('go_to'), false);
		assert.equal(bare.includes('follow'), false);
	});

	it('omits Arc emit rules when revising goals', () => {
		const system = stablePrefix('Guard', identity, verbs, { includeWatches: true, omitArc: true });
		assert.match(system, /You are Guard/);
		assert.match(system, /Watch language/);
		assert.equal(system.includes('Arc JSON'), false);
		assert.equal(system.includes('Arc text'), false);
		assert.equal(system.includes('Available verbs'), false);
		assert.equal(system.includes('JSON shape'), false);
	});

	it('lists the conversation oldest first', () => {
		const block = conversationBlock([
			'Me: That costs 10 gold.',
			'Forager: Will FireMushroom do.',
		]);
		assert.equal(block, `${CONVERSATION_HEADER}\nMe: That costs 10 gold.\nForager: Will FireMushroom do.`);
		const user = volatileBlock({ conversation: ['Me: Yes.', 'Forager: Ok.'] });
		assert.ok(user.includes(`${CONVERSATION_HEADER}\nMe: Yes.\nForager: Ok.`));
		assert.equal(conversationBlock([]), '');
	});

	it('puts goals and pinned memory in the user block', () => {
		const user = volatileBlock({
			senses: { environment: 'a damp hall' },
			goals: [{ text: 'Go to EastGate', priority: 1 }],
			pinned: [{
				id: 'mem_1',
				category: 'episodic',
				text: 'the key is hidden',
				tags: [],
				timestamp: 0,
				lastAccessed: 0,
				pinned: true,
			}],
		});
		assert.match(user, /Goals \(highest first\)/);
		assert.match(user, /Go to EastGate/);
		assert.match(user, /Pinned memories/);
		assert.match(user, /the key is hidden/);
		assert.match(user, /a damp hall/);
		assert.equal(user.includes('Available verbs'), false);
		assert.equal(user.includes('see_map'), false);
	});

	it('lists recalled unpinned facts', () => {
		const user = volatileBlock({
			senses: { environment: 'a hall' },
			recalled: [{
				id: 'mem_2',
				category: 'episodic',
				text: 'BridgeKeeper wants FireMushroom for the bridge fee',
				tags: ['BridgeKeeper'],
				timestamp: 0,
				lastAccessed: 0,
			}],
		});
		assert.match(user, /You remember:/);
		assert.match(user, /BridgeKeeper wants FireMushroom/);
	});

	it('shows the articles for a failure under its result', () => {
		const user = volatileBlock({
			lastResult: { ok: false, verb: 'go_to', reason: 'no way to Angler: Bridge is raised' },
			lastResultArticles: 'Bridge: BridgeKeeper lowers it.',
		});
		assert.match(user, /Last verb result: go_to failed — no way to Angler: Bridge is raised\n {2}Bridge: BridgeKeeper lowers it\./);
	});

	it('lists a one-shot think-about note', () => {
		const user = volatileBlock({
			senses: { environment: 'a hall' },
			thinkAbout: 'how to open EastGate',
		});
		assert.match(user, /You asked to think about: how to open EastGate/);
	});

	it('picks the think line by reasoning state', () => {
		const lines = { on: 'Reason briefly.', off: 'Answer at once.' };
		assert.match(stablePrefix('Guard', identity, verbs, { thinkInstructions: lines }), /Reason briefly\./);
		const off = stablePrefix('Guard', identity, verbs, { thinkInstructions: lines, thinking: false });
		assert.match(off, /Answer at once\./);
		assert.equal(off.includes('Reason briefly.'), false);
		assert.equal(stablePrefix('Guard', identity, verbs, { thinking: false }).includes('Think in 5 sentences'), false);
	});

	it('names observe and the watch verbs only when they are on offer', () => {
		const bare = stablePrefix('Guard', identity, verbs, { includeWatches: true });
		assert.equal(bare.includes('observe tool'), false);
		assert.equal(bare.includes('Standing:'), false);
		const full = stablePrefix('Guard', identity, verbs, { includeWatches: true, watchesWritable: true, canObserve: true });
		assert.match(full, /Standing: watch\(name, expr\) \/ unwatch\(name\)\./);
		assert.match(full, /the observe tool/);
	});

	it('lists named watches and tells the model to add, edit, or remove', () => {
		const user = volatileBlock({
			senses: { environment: 'a glen' },
			pinnedWatches: { hurt: 'isHurt(me)' },
			watches: { theft: 'some(events.filter("theft").nearby(16))' },
			watchesWritable: true,
		});
		assert.match(user, /Required watches/);
		assert.match(user, /hurt: isHurt\(me\)/);
		assert.match(user, /theft: some/);
		assert.match(user, /watch\(name, expr\) adds or replaces a watch; unwatch\(name\) drops it\./);
		assert.match(user, /Required watches \(hurt\) stay/);
		assert.equal(user.includes('addWatches'), false);
	});

	it('uses the configured you pictogram in the see_map hint', () => {
		const system = stablePrefix('Guard', identity, verbs, { canSeeMap: true, youSymbol: '🎯' });
		assert.match(system, /🎯 = you/);
		assert.equal(system.includes('❌ = you'), false);
		assert.match(seeMapHint('🎯'), /🎯 = you/);
	});

	it('teaches recall for world knowledge without stuffing articles into the prefix', () => {
		const system = stablePrefix('Guard', identity, verbs, {
			canSeeMap: true,
			canRecallKnowledge: true,
		});
		assert.match(system, /recall also searches what you know of the world/);
		assert.match(system, /Call recall, then see_map/);
		assert.match(system, /recall answers any question/);
		assert.match(system, /Never ask anyone until recall cannot find it/);
		assert.match(system, /Then try different words/);
		assert.equal(system.includes('There is no Forest'), false);
		assert.equal(system.includes('Being surrounded'), false);
		assert.equal(system.includes('filter("Tree"), never filter("trees")'), false);
		assert.ok(system.length < 5000, `standing prefix ${system.length} chars`);
		const knowledgeOnly = stablePrefix('Guard', identity, verbs, { canRecallKnowledge: true });
		assert.match(knowledgeOnly, /Call recall, or wander\(until\)/);
		assert.match(knowledgeOnly, /Never ask anyone until recall cannot find it/);
		assert.equal(knowledgeOnly.includes('see_map is a tool'), false);
	});

	it('a host example and verb line replace the stock crowd ones', () => {
		const catalog = registerStockCollectiveVerbs(registerStockVerbs(new VerbRegistry()));
		catalog.add('shoot', { args: { target: 'id' }, help: 'needs a clear line of sight' });
		const verbs = catalog.view(['issue', 'when', 'law', 'unlaw', 'loop', 'smite']);
		const stock = stablePrefix('Guard', identity, verbs, { arcFormat: 'text' });
		assert.match(stock, /Issue looping programs with a bunch of when/);
		assert.match(stock, /shoot\(target\) — needs a clear line of sight/);
		assert.match(stock, /unlaw\(name\) — drops that law/);
		assert.match(stock, /Example:\nissue\(\n\twho=units\.filter\("Guard"\),/, 'laid out as blocks, like the rule asks');
		const system = stablePrefix('Guard', identity, verbs, {
			arcFormat: 'text',
			verbInstructions: 'Hold the line.',
			arcExample: 'issue(who=units.filter("Archer"), arc=loop(shoot(others.filter("enemy").minBy(u => u.hp))))',
		});
		assert.match(system, /Hold the line\./);
		assert.equal(system.includes('Issue looping programs'), false);
		assert.ok(system.endsWith('Example: issue(who=units.filter("Archer"), arc=loop(shoot(others.filter("enemy").minBy(u => u.hp))))'));
		assert.match(system, /Prefer law for any reaction that should apply to more than one unit/);
		assert.match(system, /Answer immediately with only the Arc text/);
		assert.match(system, /No JSON, no prose/);
		assert.equal(system.includes('Arc JSON'), false);
		const example = system.match(/Example: (.+)$/);
		assert.ok(example);
		assert.equal(parseArc(example[1], verbs)[0].args.who, 'units.filter("Archer")');
	});

	it('shows a collective the same examples as JSON when it writes JSON, and each parses back', () => {
		const catalog = registerStockCollectiveVerbs(registerStockVerbs(new VerbRegistry()));
		catalog.add('shoot', { args: { target: 'id' }, help: 'needs a clear line of sight' });
		const verbs = catalog.view(['issue', 'when', 'law', 'unlaw', 'loop', 'choose', 'smite']);
		for (const arcFormat of ['json', 'schema'] as const) {
			const stock = stablePrefix('Guard', identity, verbs, { arcFormat });
			assert.match(stock, /Answer immediately with only the Arc JSON, \{"steps":\[…\]\}/);
			assert.equal(stock.includes('No JSON, no prose'), false);
			assert.match(stock, /Give each issue as a step of its own\./);
			assert.equal(stock.includes('Join several issue with ;'), false);
			assert.equal(stock.includes('\twho='), false, 'no block layout in JSON');
			const example = stock.match(/Example: (\{"steps":\[\{"verb":"issue".*\]\})$/);
			assert.ok(example, 'the stock issue example is Arc JSON');
			const arc = parseArc(example[1], verbs);
			assert.deepEqual(arc.map((step) => step.verb), ['issue', 'issue']);
			assert.equal(arc[0].args.who, "units.filter('Guard')");
			const choose = stock.match(/choose takes a goal and its choices, each a list of steps under its name, as in:\n(\{"steps".*\})\n/);
			assert.ok(choose, 'the choose example is Arc JSON');
			assert.equal(parseArc(choose[1], verbs)[0].verb, 'issue');
			const host = stablePrefix('Guard', identity, verbs, { arcFormat, arcExample: 'issue(who=units.filter("Archer"), arc=loop(shoot(others.filter("enemy").minBy(u => u.hp))))' });
			const hosted = host.match(/Example: (\{"steps".*\})$/);
			assert.ok(hosted, 'the host example is shown as Arc JSON too');
			assert.equal(parseArc(hosted[1], verbs)[0].args.who, "units.filter('Archer')");
		}
	});

	it('issue and law rules appear when the kit has crowd verbs', () => {
		const catalog = registerStockCollectiveVerbs(registerStockVerbs(new VerbRegistry()));
		catalog.add('slash', { args: { target: 'id' } });
		const verbs = catalog.view(['issue', 'when', 'law', 'unlaw', 'loop', 'smite']);
		const system = stablePrefix('Guard', identity, verbs, { arcFormat: 'text' });
		assert.match(system, /issue\(who, arc\) assigns a sticky program/);
		assert.match(system, /who is YOUR roster/);
		assert.match(system, /units\.filter\("Witch"\)/);
		assert.match(system, /allUnits is one identical program/);
		assert.match(system, /Join several issue with ;/);
		assert.match(system, /Each issue arc is that unit's full chain/);
		assert.match(system, /law\(who\?, watch, arc, name\?\) is a standing reaction/);
		assert.match(system, /when\(watch, arc\) is this job's interrupt/);
		assert.match(system, /Omitted who = units/);
		assert.match(system, /Nested arc verbs/);
		assert.match(system, /slash\(target\)/);
		assert.equal(system.includes('when(who'), false);
		assert.match(system, /Answer immediately with only the Arc text/);
		assert.equal(system.includes('Arc JSON'), false);
	});

	it('solo law has no who', () => {
		const verbs = registerStockVerbs(new VerbRegistry()).withoutArg('law', 'who');
		const system = stablePrefix('Guard', identity, verbs);
		assert.match(system, /law\(watch, arc, name\?\) is a standing reaction/);
		assert.equal(system.includes('law(who'), false);
		assert.equal(system.includes('allUnits'), false);
		assert.equal(system.includes('Omitted who'), false);
	});

	it('omits verb instructions the kit does not grant', () => {
		const verbs = registerStockVerbs(new VerbRegistry(), 'say', 'wait');
		const system = stablePrefix('Guard', identity, verbs, { canSeeMap: true, canRecallKnowledge: true });
		assert.match(system, /wait\(until\)/);
		assert.match(system, /Available verbs: say\(text, to\?\) — one short sentence, wait\(seconds\?, until\?\)/);
		assert.equal(system.includes('wander'), false);
		assert.equal(system.includes('go_to'), false);
		assert.equal(system.includes('pick_up'), false);
		assert.equal(system.includes('follow'), false);
		assert.equal(system.includes('remember('), false);
		assert.equal(system.includes('think('), false);
		assert.equal(system.includes('set_identity'), false);
		assert.equal(system.includes('use('), false);
		assert.equal(system.includes('give('), false);
		assert.equal(system.includes('examine'), false);
		assert.match(system, /Call recall, then see_map\. A second look/);
		assert.match(system, /Never ask where something is until see_map cannot find it/);
		assert.equal(system.includes('or wander(until)'), false);
	});

	it('lists required and extra sightFocus in the user block', () => {
		const user = volatileBlock({
			senses: { environment: 'a square' },
			pinnedSightFocus: ['isHurt(it)'],
			sightFocus: ['isNear(it, Player)'],
			sightFocusWritable: true,
		});
		assert.match(user, /Required sightFocus/);
		assert.match(user, /isHurt\(it\)/);
		assert.match(user, /Current sightFocus/);
		assert.match(user, /isNear\(it, Player\)/);
		assert.match(user, /focus\(expr\) lists what matches first in sight/);
		assert.equal(user.includes('"sightFocus"'), false);
	});
});

describe('choose in prompts', () => {
	const all = registerStockVerbs(new VerbRegistry());

	it('teaches choose to a character that has it', () => {
		const text = stablePrefix('Guard', {}, all, { arcFormat: 'text' });
		assert.match(text, /choose\(goal, name=arc, …\) — a fast model picks one by name/);
		assert.match(text, /as in:\nloop\(\n\tchoose\(\n\t\t"why you choose",\n\t\twander=wander\(\),\n\t\twait=wait\(\),\n\t\),\n\)\n/, 'a block, every choice named');
		const json = stablePrefix('Guard', {}, all);
		assert.match(json, /choose takes a goal and its choices, each a list of steps under its name, as in:\n\{"steps":\[\{"verb":"loop","arc":\[\{"verb":"choose","goal":"why you choose","choices":\{"wander":\[\{"verb":"wander"\}\],"wait":\[\{"verb":"wait"\}\]\}\}\]\}\]\}\nA fast model runs the one that fits right now/);
		const example = json.match(/as in:\n(\{"steps".*\})\n/);
		assert.ok(example);
		assert.equal(parseArc(example[1], all)[0].verb, 'loop');
	});

	it('says nothing of choose when it is withheld', () => {
		const kit = all.view(all.list().map((spec) => spec.name).filter((name) => name !== 'choose'));
		assert.equal(stablePrefix('Guard', {}, kit, { arcFormat: 'text' }).includes('choose'), false);
	});

	it('teaches a collective whose kit grants choose to issue it in a loop', () => {
		const catalog = registerStockCollectiveVerbs(registerStockVerbs(new VerbRegistry()));
		catalog.add('attack', { args: { target: 'id?' } });
		const text = stablePrefix('Dawn', {}, catalog.view(['issue', 'loop', 'choose', 'attack']), { arcFormat: 'text' });
		assert.match(text, /as in:\nissue\(\n\twho=units,\n\tarc=loop\(\n\t\tchoose\(\n\t\t\t"why you choose",\n\t\t\tattack=attack\(\),\n/);
	});

	it('never offers choose to a collective whose kit lacks it, even among nested arc verbs', () => {
		const catalog = registerStockCollectiveVerbs(registerStockVerbs(new VerbRegistry()));
		const kit = catalog.view(['issue', 'when', 'loop', 'law', 'unlaw']);
		const text = stablePrefix('Dawn', {}, kit, { arcFormat: 'text' });
		assert.match(text, /Nested arc verbs/);
		assert.equal(text.includes('choose'), false);
	});

	it('does not mention loop or unlaw unless the kit grants them', () => {
		const catalog = registerStockVerbs(new VerbRegistry());
		const choose = stablePrefix('Guard', {}, catalog.view(['choose', 'wait', 'wander']), { arcFormat: 'text' });
		assert.match(choose, /a fast model picks one by name/);
		assert.equal(choose.includes('loop'), false);
		const law = stablePrefix('Guard', {}, catalog.view(['law', 'wait']));
		assert.equal(law.includes('unlaw'), false);
		const watches = stablePrefix('Guard', {}, catalog.view(['say', 'wait']), { includeWatches: true });
		assert.equal(watches.includes('go_to'), false);
		assert.equal(watches.includes('doing(u'), false);
		const earshot = 'Who is in range right now. Who you can say(to) is this list. Pass to to check one name before you arc a say. Out of range: error, no speech; get closer first.';
		const names = ['say', 'wander', 'go_to', 'earshot'];
		assert.equal(docsFor(earshot, 'earshot', new Set(['wait', 'earshot']), names).includes('say'), false);
		assert.match(docsFor(earshot, 'earshot', new Set(['say', 'earshot']), names), /say\(to\)/);
	});
});
