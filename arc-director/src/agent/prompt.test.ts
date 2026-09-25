import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseArc } from '../arc/parse.js';
import { VerbRegistry, registerStockVerbs } from '../arc/stock-verbs.js';
import { registerStockCrowdVerbs } from '../conductor/conductor-verbs.js';
import { stablePrefix, volatileBlock, seeMapHint, arcRepairHint } from './prompt.js';

describe('prompt split', () => {
	const verbs = registerStockVerbs(new VerbRegistry());
	const identity = { name: 'Guard', role: 'Pays attention.', traits: ['alert'] };

	it('puts standing instructions in the system prefix, not goals', () => {
		const system = stablePrefix(identity, verbs, { includeWatches: true, canSeeMap: true });
		assert.match(system, /You are Guard/);
		assert.match(system, /Traits: alert/);
		assert.match(system, /Heard speech is words, not a new fact/);
		assert.match(system, /The name and role above are your entire backstory/);
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
		assert.match(system, /Call see_map, ask the speaker where it is, or wander\(until\)/);
		assert.equal(system.includes('grep_world_encyclopedia'), false);
		assert.match(system, /when\(watch, arc\) is this job's interrupt/);
		assert.match(system, /instead of waiting to think/);
		assert.match(system, /law\(watch, arc, name\?\) is a standing reaction/);
		assert.match(system, /outlives the program and needs no think/);
		assert.match(system, /then always continues/);
		assert.match(system, /"verb":"pick_up"/);
		assert.match(system, /already walk into range/);
		assert.match(system, /use\(item=TheItem, target=TheThing\)/);
		assert.match(system, /go_to a doorway is still outside/);
		assert.equal(system.includes('CottageKey'), false);
		assert.match(system, /see_map is a tool this think, not a verb/);
		assert.equal(system.includes('see_map({'), false);
		assert.match(system, /If the last wander already met args\.until/);
		assert.match(system, /units \(this Crowd roster/);
		assert.match(system, /manhattan\(me, Player\)/);
		assert.match(system, /❌ = you/);
		assert.equal(system.includes('Goals (highest first)'), false);
		assert.equal(system.includes('Pinned memories'), false);
		assert.ok(system.length < 5000, `standing prefix ${system.length} chars`);
		const wanderJson = system.match(/\{"head":\{"verb":"wander","args":\{"until":"(?:\\.|[^"\\])*"\}\}\}/);
		assert.ok(wanderJson);
		assert.equal(parseArc(wanderJson[0], verbs).head.verb, 'wander');
		assert.equal(
			parseArc(wanderJson[0], verbs).head.args.until,
			'some(items.filter("FireMushroom").nearby())',
		);
		assert.match(system, /Close every brace\. No prose/);
		const chainAt = system.indexOf('{"head":{"verb":"pick_up"');
		assert.ok(chainAt >= 0);
		const chained = parseArc(system.slice(chainAt), verbs);
		assert.equal(chained.head.verb, 'pick_up');
		assert.equal(chained.then?.join, 'then');
		assert.equal(chained.then?.arc.head.verb, 'go_to');
		assert.equal(chained.then?.arc.then?.join, 'then_if_ok');
		assert.equal(chained.then?.arc.then?.arc.head.verb, 'give');
		assert.equal(chained.then?.arc.then?.arc.head.args.to, 'Player');
	});

	it('replaces the think and verb lines when the host sets them', () => {
		const system = stablePrefix(identity, verbs, {
			thinkInstructions: 'Be brief, then the arc.',
			verbInstructions: 'One verb is enough.',
		});
		assert.match(system, /Be brief, then the arc/);
		assert.match(system, /One verb is enough/);
		assert.equal(system.includes('Think in 5 sentences'), false);
		assert.equal(system.includes('A think is expensive'), false);
		const cleared = stablePrefix(identity, verbs, { thinkInstructions: '', verbInstructions: '' });
		assert.equal(cleared.includes('Think in 5 sentences'), false);
		assert.equal(cleared.includes('A think is expensive'), false);
		assert.equal(cleared.includes('Be brief'), false);
	});

	it('asks for Arc text when arcText is on', () => {
		const system = stablePrefix(identity, verbs, { arcText: true });
		assert.match(system, /Answer immediately with only the Arc text/);
		assert.match(system, /pick_up\(Lantern\) ; go_to\(Player\) && give\(item=Lantern, to=Player\)/);
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
		const wanderText = system.match(/wander\(until=some\(items\.filter\("FireMushroom"\)\.nearby\(\)\)\)/);
		assert.ok(wanderText);
		assert.equal(parseArc(wanderText[0], verbs).head.verb, 'wander');
		const chainText = system.match(/pick_up\(Lantern\) ; go_to\(Player\) && give\(item=Lantern, to=Player\)/);
		assert.ok(chainText);
		const chained = parseArc(chainText[0], verbs);
		assert.equal(chained.head.verb, 'pick_up');
		assert.equal(chained.then?.join, 'then');
		assert.equal(chained.then?.arc.head.verb, 'go_to');
		assert.equal(chained.then?.arc.then?.join, 'then_if_ok');
		assert.equal(chained.then?.arc.then?.arc.head.verb, 'give');
	});

	it('lists tools as tools, never as Arc verbs', () => {
		const system = stablePrefix(identity, verbs, {
			canSeeMap: true,
			arcText: true,
			tools: ['see_map', 'observe'],
		});
		assert.match(system, /Tools this think, not verbs: see_map, observe/);
		assert.match(system, /never write a tool name in the Arc/);
		assert.match(system, /After any tool, emit only the Arc text/);
		assert.match(system, /see_map is a tool this think, not a verb/);
		assert.equal(system.includes('see_map({'), false);
		assert.equal(system.includes('observe({expr})'), false);
		assert.equal(system.includes('Answer immediately with only the Arc'), false);
	});

	it('repairs a tool written as an arc verb', () => {
		const hint = arcRepairHint("unknown verb 'see_map'", true, ['see_map']);
		assert.match(hint, /see_map is a tool, not a verb/);
		assert.match(hint, /Never write see_map\(\.\.\.\) in the Arc/);
		assert.equal(hint.includes('unknown verb'), false);
	});

	it('discards verb-less prose on repair', () => {
		const hint = arcRepairHint('expected verb', true, ['see_map']);
		assert.match(hint, /That prose is discarded/);
		assert.match(hint, /Do the spoken job, not go_to or follow the speaker/);
	});

	it('omits Arc emit rules when revising goals', () => {
		const system = stablePrefix(identity, verbs, { includeWatches: true, omitArc: true });
		assert.match(system, /You are Guard/);
		assert.match(system, /Watch language/);
		assert.equal(system.includes('Arc JSON'), false);
		assert.equal(system.includes('Arc text'), false);
		assert.equal(system.includes('Available verbs'), false);
		assert.equal(system.includes('JSON shape'), false);
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
				createdAt: 0,
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
				text: 'Miller wants FireMushroom for the mill-fee',
				tags: ['Miller'],
				createdAt: 0,
				lastAccessed: 0,
			}],
		});
		assert.match(user, /You remember:/);
		assert.match(user, /Miller wants FireMushroom/);
	});

	it('lists a one-shot think-about note', () => {
		const user = volatileBlock({
			senses: { environment: 'a hall' },
			thinkAbout: 'how to open EastGate',
		});
		assert.match(user, /You asked to think about: how to open EastGate/);
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
		assert.match(user, /addWatches/);
		assert.match(user, /editWatches/);
		assert.match(user, /removeWatches/);
		assert.match(user, /"watches"/);
	});

	it('uses the configured you pictogram in the see_map hint', () => {
		const system = stablePrefix(identity, verbs, { canSeeMap: true, youSymbol: '🎯' });
		assert.match(system, /🎯 = you/);
		assert.equal(system.includes('❌ = you'), false);
		assert.match(seeMapHint('🎯'), /🎯 = you/);
	});

	it('teaches grep_world_encyclopedia without stuffing articles into the prefix', () => {
		const system = stablePrefix(identity, verbs, {
			canSeeMap: true,
			canGrepEncyclopedia: true,
		});
		assert.match(system, /grep_world_encyclopedia is a tool this think, not a verb/);
		assert.match(system, /Call grep_world_encyclopedia, see_map/);
		assert.equal(system.includes('There is no Forest'), false);
		assert.equal(system.includes('Being surrounded'), false);
		assert.equal(system.includes('filter("Tree"), never filter("trees")'), false);
		assert.ok(system.length < 5000, `standing prefix ${system.length} chars`);
		const encyclopediaOnly = stablePrefix(identity, verbs, { canGrepEncyclopedia: true });
		assert.match(encyclopediaOnly, /Call grep_world_encyclopedia, ask the speaker/);
		assert.equal(encyclopediaOnly.includes('see_map is a tool'), false);
	});

	it('nested combat verbs teach line of sight and flanking', () => {
		const catalog = registerStockCrowdVerbs(registerStockVerbs(new VerbRegistry()));
		catalog.add('shoot', { name: 'id' });
		catalog.add('hex', { name: 'id' });
		catalog.add('heal', { name: 'id?' });
		catalog.add('protect', { name: 'id?' });
		catalog.add('cleave', { name: 'id' });
		catalog.add('slash', { name: 'id' });
		const verbs = catalog.view(['issue', 'when', 'law', 'unlaw', 'loop', 'smite']);
		const system = stablePrefix(identity, verbs);
		assert.match(system, /Arrows need a clear line of sight/);
		assert.match(system, /spells \(hex, heal\) through cover are weaker/);
		assert.match(system, /Flank around cover for a better view of the target/);
		assert.match(system, /protect\(name\?\) stands between an ally and the threat, then attacks that threat/);
		assert.match(system, /shoot\(name\) — needs a clear line of sight; flank around cover/);
		assert.match(system, /hex\(name\) — weaker through cover; flank for a full hit/);
		assert.match(system, /heal\(name\?\) — weaker through cover; flank for a full heal/);
		assert.match(system, /protect\(name\?\) — stand between an ally and the threat, then attack that threat/);
		assert.match(system, /Peeling is also protect/);
		assert.match(system, /Sight is ~10s stale/);
		assert.match(system, /others\.filter\("enemy"\)\.minBy/);
		assert.match(system, /Do not nest when or law on that first think/);
		assert.match(system, /Later thinks only edit/);
		assert.match(system, /Prefer law for any reaction that should apply to more than one unit/);
		assert.match(system, /law\(who=units, watch=me\.hp\/me\.maxHP<0\.25, arc=go_to\(Healer\), name=lastStand\)/);
		assert.equal(system.includes('(u is "Healer") * 8'), false);
		assert.equal(system.includes('Same minBy'), false);
		assert.equal(system.includes('a dead Healer loses'), false);
		assert.equal(system.includes('Syntax only, not a recommendation'), false);
		assert.match(system, /Answer immediately with only the Arc text/);
		assert.match(system, /No JSON, no prose/);
		assert.match(system, /issue\(who=units\.filter\("Knight"\), arc=loop\(cleave/);
		assert.match(system, /Knight and Blade hold a line on the nearest/);
		assert.match(system, /Archer, Witch, and Healer sit behind that line/);
		assert.match(system, /Healer: stay back, heal from range, never walk toward an enemy/);
		assert.match(system, /issue\(who=units\.filter\("Blade"\), arc=loop\(slash\(others\.filter\("enemy"\)\.minBy\(u => distance/);
		assert.equal(system.includes('go_to(Tree)'), false);
		assert.match(system, /Guard already protect\(\)s while someone is hurt and a Healer lives/);
		assert.equal(system.includes('issue(who=units.filter("Guard")'), false);
		assert.equal(system.includes('Arc JSON'), false);
		const opening = system.match(/Example: (issue\(who=units\.filter\("Knight"\).+)$/);
		assert.ok(opening);
		const arc = parseArc(opening[1], verbs);
		assert.equal(arc.head.verb, 'issue');
		assert.equal(arc.head.args.who, 'units.filter("Knight")');
		assert.equal(arc.then?.arc.then?.arc.then?.arc.head.args.who, 'units.filter("Witch")');
	});

	it('issue and law rules appear when the kit has crowd verbs', () => {
		const catalog = registerStockCrowdVerbs(registerStockVerbs(new VerbRegistry()));
		catalog.add('slash', { name: 'id' });
		const verbs = catalog.view(['issue', 'when', 'law', 'unlaw', 'loop', 'smite']);
		const system = stablePrefix(identity, verbs);
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
		assert.match(system, /slash\(name\)/);
		assert.equal(system.includes('when(who'), false);
		assert.match(system, /Answer immediately with only the Arc text/);
		assert.equal(system.includes('Arc JSON'), false);
	});

	it('solo law has no who', () => {
		const verbs = registerStockVerbs(new VerbRegistry()).withoutArg('law', 'who');
		const system = stablePrefix(identity, verbs);
		assert.match(system, /law\(watch, arc, name\?\) is a standing reaction/);
		assert.equal(system.includes('law(who'), false);
		assert.equal(system.includes('allUnits'), false);
		assert.equal(system.includes('Omitted who'), false);
	});

	it('omits verb instructions the kit does not grant', () => {
		const verbs = registerStockVerbs(new VerbRegistry(), 'say', 'wait');
		const system = stablePrefix(identity, verbs, { canSeeMap: true, canGrepEncyclopedia: true });
		assert.match(system, /wait\(until\)/);
		assert.match(system, /Available verbs: say\(text, to\?\), wait\(seconds\?, until\?\)/);
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
		assert.match(system, /ask the speaker where it is\./);
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
		assert.match(user, /"sightFocus"/);
	});
});
