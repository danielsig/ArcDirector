import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseArc } from '../arc/wire.js';
import { VerbRegistry, STOCK_VERB_DEFS } from '../arc/stock-verbs.js';
import { STOCK_COLLECTIVE_VERB_DEFS } from '../collective/collective-verbs.js';
import { DEFAULT_THINK_INSTRUCTIONS, stablePrefix, thinkLine, volatileBlock, conversationBlock, conversationHeader, seeMapHint, arcRepairHint, failedPart } from './prompt.js';
import { docsFor } from '../arc/schema.js';

describe('prompt split', () => {
	const verbs = new VerbRegistry().addAll(STOCK_VERB_DEFS);
	const identity = { role: 'Watcher', traits: ['alert'] };

	it('names the agent by its id, with its role when it has one', () => {
		assert.match(stablePrefix('Fern', identity, verbs), /\nYou are Fern\. Role: Watcher\.\n/);
		assert.match(stablePrefix('Forager', {}, verbs), /\nYou are Forager\.\n\nSteps run in order/);
	});

	it('tells every mind with one kit the same thing first, so a server caches one prompt for all of them', () => {
		const fern = stablePrefix('Fern', identity, verbs, { includeWatches: true, canRecallKnowledge: true });
		const forager = stablePrefix('Forager', {}, verbs, { includeWatches: true, canRecallKnowledge: true });
		const shared = fern.slice(0, fern.indexOf('You are Fern'));
		assert.ok(forager.startsWith(shared));
		assert.ok(shared.length > fern.length * 0.9, 'all but who it is');
	});

	it('puts a host system note in the prefix, after who the mind is', () => {
		const system = stablePrefix('Baker', identity, verbs, { systemNote: 'Call recall to read the ledger.' });
		const role = system.indexOf('Role: Watcher.');
		const note = system.indexOf('Call recall to read the ledger.');
		assert.ok(role >= 0 && note > role);
		assert.equal(stablePrefix('Baker', identity, verbs).includes('ledger'), false);
	});

	it('shows give and offer moving the host currency, and says nothing about money without one', () => {
		const system = stablePrefix('Baker', identity, verbs, { arcFormat: 'text', currency: 'shells' });
		assert.ok(system.includes('give(item=shells, to=Player, quantity=5) pays 5 shells; saying so does not.'));
		assert.ok(system.includes('In an offer, shells counts like any item: {"shells":5}.'));
		assert.equal(/pays|shells/.test(stablePrefix('Baker', identity, verbs, { arcFormat: 'text' })), false);
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
		assert.match(system, /NEVER write `think` in the steps; only inside if\/else or a choose choice\./);
		assert.equal(system.includes('Think in 5 sentences'), false, 'the think line is in the user message');
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
		assert.equal(system.match(/A spoken place that is not a Capitalized or \*starred\* name/g)?.length, 1, 'the place rule once, in the arc rules');
		assert.equal(system.includes('recall also searches'), false);
		assert.match(system, /when\(watch, arc\) is this job's interrupt/);
		assert.match(system, /instead of waiting to think/);
		assert.match(system, /law\(watch, arc, name\?\) is a standing reaction/);
		assert.match(system, /outlives the program and needs no think/);
		assert.match(system, /"then" joins the next step: "if_ok" \(the default\) only when it must not run if this one failed, else "always"; "if_failed" runs it only on failure/);
		assert.match(system, /"verb":"pick_up"/);
		assert.match(system, /pick_up\(item, from\?\) — goes to it first/);
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
		assert.ok(system.length < 6850, `standing prefix ${system.length} chars`);
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
		const chainAt = system.indexOf('{"steps":[\n\t{"verb":"pick_up"');
		assert.ok(chainAt >= 0);
		const chained = parseArc(system.slice(chainAt, system.indexOf('\n]}', chainAt) + 3), verbs);
		assert.deepEqual(chained.map((step) => step.verb), ['pick_up', 'give']);
		assert.equal(chained[0].then, undefined);
		assert.equal(chained[1].args.to, 'Player');
	});

	it('replaces the verb line when the host sets it, and keeps the think line out of the system prefix', () => {
		const system = stablePrefix('Guard', identity, verbs, { verbInstructions: 'One verb is enough.' });
		assert.match(system, /One verb is enough/);
		assert.equal(system.includes('A think is expensive'), false);
		assert.equal(system.includes('Think in 5 sentences'), false);
		assert.equal(stablePrefix('Guard', identity, verbs, { verbInstructions: '' }).includes('A think is expensive'), false);
	});

	it('teaches while with the kit\'s own verbs: no say without one, in text or JSON', () => {
		const quiet = verbs.view(verbs.list().map((spec) => spec.name).filter((name) => name !== 'say' && name !== 'follow'));
		const text = stablePrefix('Guard', identity, quiet, { arcFormat: 'text' });
		assert.ok(text.endsWith('\n\nSteps run in order: each starts once the one before has ended. && runs the next only if it succeeded, || only if it failed.'), 'only how steps join');
		assert.equal(stablePrefix('Guard', identity, quiet, { arcFormat: 'json' }).includes('"while"'), false);
		const json = stablePrefix('Guard', identity, verbs, { arcFormat: 'json' });
		assert.match(json, /\n\t\t"while":\[\{"verb":"say","text":"This way"\}\]\n/, 'one say, indented');
		assert.equal((json.match(/"verb":"say"/g) ?? []).length <= 2, true);
		assert.equal(stablePrefix('Guard', identity, verbs.view(verbs.list().map((spec) => spec.name).filter((name) => name !== 'follow')), { arcFormat: 'text' }).includes('or a follow'), false);
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
		// How steps run comes last, its while example indented.
		assert.ok(system.endsWith('\n\nSteps run in order: each starts once the one before has ended. && runs the next only if it succeeded, || only if it failed. A while B runs B during A: go_to(Gate) while say("This way") speaks while walking. B can be a block: follow(Bram) while { say("Come") ; say("Hurry") }. What comes after arriving goes on the next line:\ngo_to(Gate) while say("This way")\ngo_to(Well)\nwhile binds tighter than && and ||: go_to(Gate) while say("This way") && go_to(Well) walks on to Well only once it got to Gate.\nA may be a loop or a follow; this says it as the loop starts:\nloop {\n\tgo_to(Mill)\n\tgo_to(Barn)\n} while say("Off I go")'));
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
		assert.equal(system.match(/Never ask where something is/g)?.length, 1, 'said once, where it says to look');
		assert.equal(system.includes('Looking for a thing or place? wander'), false);
	});

	it('lists tools as tools, never as Arc verbs', () => {
		const system = stablePrefix('Guard', identity, verbs, {
			canSeeMap: true,
			arcFormat: 'text',
			tools: ['see_map', 'observe'],
		});
		assert.match(system, /Tools this think: see_map, observe\./);
		assert.match(system, /see_map and observe are tools, not verbs: call them as tools, never in the Arc\./);
		assert.equal(system.match(/not verbs/g)?.length, 1, 'said once, beside the verb list');
		assert.match(system, /Never guess a fact a tool can check/);
		assert.match(system, /never repeat a call/);
		assert.equal(system.includes('with "Bread"'), false);
		const lookup = stablePrefix('Guard', identity, verbs, { arcFormat: 'text', tools: ['observe', 'recall'] });
		assert.equal(lookup.includes('Bread'), false, 'no worked lookup of world knowledge where the world has none');
		assert.match(lookup, /Look it up once; if recall finds nothing, ask someone who might know./);
		const knowing = stablePrefix('Guard', identity, verbs, { arcFormat: 'text', tools: ['observe', 'recall'], canRecallKnowledge: true });
		assert.match(knowing, /Call recall with "Bread"/);
		assert.equal(knowing.match(/Look it up once/g)?.length, 1, 'said once, in the knowledge hint');
		assert.match(lookup, /Available verbs: [^\n]*\. observe and recall are tools, not verbs: call them as tools, never in the Arc\./, 'right after the verbs');
		assert.match(lookup, /NEVER write `think` in the steps; only inside if\/else/);
		const call = (toolArgs?:Map<string, string | undefined>):string => stablePrefix('Guard', identity, verbs, { arcFormat: 'schema', tools: ['earshot', 'observe'], toolArgs });
		assert.match(call(new Map([['earshot', undefined], ['observe', 'expr']])), /Call one by replying \{"tool":"observe","expr":"…"\}\./, 'the first tool that takes an argument');
		assert.match(call(), /Call one by replying \{"tool":"earshot", …its arguments\}\./, 'no argument it cannot know');
		assert.equal(stablePrefix('Guard', identity, new VerbRegistry().addAll(STOCK_VERB_DEFS, 'go_to', 'if'), { arcFormat: 'text' }).includes('NEVER write `think`'), false, 'not without think');
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

	it('tells a bodiless mind that a verb of its units runs through command', () => {
		const hive = new VerbRegistry().addAll(STOCK_VERB_DEFS).addAll(STOCK_COLLECTIVE_VERB_DEFS, 'command').view(['command', 'wait']);
		const hint = arcRepairHint("unknown verb 'say'", 'json', [], hive);
		assert.match(hint, /say is for your units, run through a command whose arc contains say/);
		assert.match(arcRepairHint("unknown verb 'dance'", 'json', [], hive), /not a valid Arc/);
	});

	it('tells a commander with a body of its own that a verb of its units is theirs, not its', () => {
		const hive = new VerbRegistry().addAll(STOCK_VERB_DEFS).addAll(STOCK_COLLECTIVE_VERB_DEFS, 'command').view(['command', 'wait']);
		const hint = arcRepairHint("unknown verb 'say'", 'text', [], hive, '', true);
		assert.match(hint, /^say is your units' verb, not yours: command\(who\) \{ say\(…\) \}\. Keep this conversation\./);
		assert.equal(hint.includes('no body'), false);
	});

	it('quotes only the failed part of a reply that has begun to run, not the steps that run', () => {
		const reply = 'go_to(Well) && fill(item=Bucket, from=Well) && give(item=Bucket, to=Bram)';
		assert.equal(failedPart(reply, 'fill'), ', at: fill(item=Bucket, from=Well) && give(item=Bucket, to=Bram)');
		assert.equal(failedPart(`say("Hi")\n\tgo_to(Well) || fill(item=Bucket)`, 'Bucket'), ', at: fill(item=Bucket)');
		assert.equal(failedPart(reply, undefined), '', 'nothing to point at');
	});

	it('discards verb-less prose on repair', () => {
		const hint = arcRepairHint('expected verb', 'text', ['see_map'], new VerbRegistry().addAll(STOCK_VERB_DEFS));
		assert.match(hint, /That prose is discarded/);
		assert.match(hint, /Do the spoken job, not go_to or follow the speaker/);
		const bare = arcRepairHint('expected verb', 'text', ['see_map'], new VerbRegistry().addAll(STOCK_VERB_DEFS, 'say', 'wait'));
		assert.match(bare, /Do the spoken job\./);
		assert.equal(bare.includes('go_to'), false);
		assert.equal(bare.includes('follow'), false);
	});

	it('omits Arc emit rules when revising goals', () => {
		const system = stablePrefix('Guard', identity, verbs, { includeWatches: true, omitArc: true });
		assert.match(system, /You are Guard/);
		assert.match(system, /Watches are Arc expressions/);
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
		assert.equal(block, `${conversationHeader(false)}\nMe: That costs 10 gold.\nForager: Will FireMushroom do.`);
		const user = volatileBlock({ conversation: ['Me: Yes.', 'Forager: Ok.'] });
		assert.ok(user.includes(`${conversationHeader(false)}\nMe: Yes.\nForager: Ok.`));
		assert.equal(conversationBlock([]), '');
	});

	it('points the conversation at sight only when sight is shown below it', () => {
		const sighted = volatileBlock({ conversation: ['Ash: A wolf!'], senses: { sight: 'Ash 2 paces in front of you.' } });
		assert.ok(sighted.includes(`${conversationHeader(true)}\nAsh: A wolf!`));
		assert.match(conversationHeader(true), /is a claim, not the world: what sight below shows is the world now; never repeat a claim it does not show\. Never say/);
		// A strategic think shows no senses; a kit without the sight sense, or a sight with nothing in it, shows none below.
		for (const senses of [undefined, { carrying: 'You carry nothing.' }, { sight: '' }]) {
			const user = volatileBlock({ conversation: ['Ash: A wolf!'], senses });
			assert.ok(user.includes(`${conversationHeader(false)}\nAsh: A wolf!`), JSON.stringify(senses));
			assert.equal(user.includes('sight below'), false, JSON.stringify(senses));
		}
		assert.match(conversationHeader(false), /is a claim, not the world\. Never say/);
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
				knownBy: [],
				category: 'episodic',
				text: 'BridgeKeeper wants FireMushroom for the bridge fee',
				tags: ['BridgeKeeper'],
				timestamp: 0,
			}],
		});
		assert.match(user, /You remember:/);
		assert.match(user, /BridgeKeeper wants FireMushroom/);
	});

	it('shows the articles for a failure under its result', () => {
		const user = volatileBlock({
			lastResult: { status: 'failed', verb: 'go_to', reason: 'no way to Angler: Bridge is raised' },
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

	it('picks the think line by reasoning state: the stock one only while reasoning, none in the compact style', () => {
		const lines = { on: 'Reason briefly.', off: 'Answer at once.' };
		assert.equal(thinkLine(true, lines), 'Reason briefly.');
		assert.equal(thinkLine(false, lines), 'Answer at once.');
		assert.equal(thinkLine(true), DEFAULT_THINK_INSTRUCTIONS);
		assert.equal(thinkLine(false), '');
		assert.equal(thinkLine(true, {}, true), '');
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

	it('tells recall from observe when observe is offered', () => {
		const system = stablePrefix('Guard', identity, verbs, { canRecallKnowledge: true, canObserve: true, includeWatches: true });
		assert.match(system, /recall answers what you know; observe answers what is true in the world now/);
		assert.match(system, /observe tool evaluates any expr on what you can make out now, farther off than you see .*Whoever it cannot make out, get closer to./);
	});

	it('teaches recall for world knowledge without stuffing articles into the prefix', () => {
		const system = stablePrefix('Guard', identity, verbs, {
			canSeeMap: true,
			canRecallKnowledge: true,
		});
		assert.match(system, /recall also searches what you know of the world/);
		assert.match(system, /Query a name, or a plain word or spoken place to learn its Capitalized name/);
		assert.match(system, /recall answers any question/);
		assert.match(system, /Look it up once; if recall finds nothing, ask someone who might know./);
		assert.equal(system.includes('different words'), false);
		assert.equal(system.includes('There is no Forest'), false);
		assert.equal(system.includes('Being surrounded'), false);
		assert.equal(system.includes('filter("Tree"), never filter("trees")'), false);
		assert.ok(system.length < 6520, `standing prefix ${system.length} chars`);
		const knowledgeOnly = stablePrefix('Guard', identity, verbs, { canRecallKnowledge: true });
		assert.equal(knowledgeOnly.match(/A spoken place that is not a Capitalized or \*starred\* name/g)?.length, 1, 'the place rule once, in the arc rules');
		assert.match(knowledgeOnly, /Look it up once; if recall finds nothing, ask someone who might know./);
		assert.equal(knowledgeOnly.includes('see_map is a tool'), false);
	});

	it('a host example and verb line replace the stock crowd ones', () => {
		const catalog = new VerbRegistry().addAll(STOCK_VERB_DEFS).addAll(STOCK_COLLECTIVE_VERB_DEFS);
		catalog.add('shoot', { args: { target: 'id' }, help: 'needs a clear line of sight' });
		const verbs = catalog.view(['command', 'when', 'law', 'unlaw', 'loop', 'smite']);
		const stock = stablePrefix('Guard', identity, verbs, { arcFormat: 'text' });
		assert.match(stock, /Give units looping programs with a bunch of when/);
		assert.match(stock, /shoot\(target\) — needs a clear line of sight/);
		assert.match(stock, /unlaw\(name\) — drops that law/);
		assert.match(stock, /Example:\ncommand\(units\.filter\("Guard"\)\) \{\n\tgo_to\(Keep\)\n\}/, 'laid out as blocks, like the rule asks');
		const system = stablePrefix('Guard', identity, verbs, {
			arcFormat: 'text',
			verbInstructions: 'Hold the line.',
			arcExample: 'command(who=units.filter("Archer"), arc=loop(shoot(others.filter("enemy").minBy(u => u.hp))))',
		});
		assert.match(system, /Hold the line\./);
		assert.equal(system.includes('Give units looping programs'), false);
		assert.ok(system.includes('Example: command(who=units.filter("Archer"), arc=loop(shoot(others.filter("enemy").minBy(u => u.hp))))\nYou are Guard'), 'the example ends the rules; who it is comes after');
		assert.match(system, /Prefer law for any reaction that should apply to more than one unit/);
		assert.match(system, /Answer immediately with only the Arc text/);
		assert.match(system, /No JSON, no prose/);
		assert.equal(system.includes('Arc JSON'), false);
		const example = system.match(/Example: (.+)\nYou are /);
		assert.ok(example);
		assert.equal(parseArc(example[1], verbs)[0].args.who, 'units.filter("Archer")');
	});

	it('shows a collective the same examples as JSON when it writes JSON, and each parses back', () => {
		const catalog = new VerbRegistry().addAll(STOCK_VERB_DEFS).addAll(STOCK_COLLECTIVE_VERB_DEFS);
		catalog.add('shoot', { args: { target: 'id' }, help: 'needs a clear line of sight' });
		const verbs = catalog.view(['command', 'when', 'law', 'unlaw', 'loop', 'choose', 'smite']);
		for (const arcFormat of ['json', 'schema'] as const) {
			const stock = stablePrefix('Guard', identity, verbs, { arcFormat });
			assert.match(stock, /Answer immediately with only the Arc JSON, \{"steps":\[…\]\}/);
			assert.equal(stock.includes('No JSON, no prose'), false);
			assert.match(stock, /"then" joins the next step/);
			assert.equal(stock.includes('\twho='), false, 'no block layout in JSON');
			const example = stock.match(/Example:\n(\{"steps":\[\n[\s\S]*?\n\]\})\nYou are /);
			assert.ok(example, 'the stock command example is Arc JSON');
			const arc = parseArc(example[1], verbs);
			assert.deepEqual(arc.map((step) => step.verb), ['command', 'command']);
			assert.equal(arc[0].args.who, "units.filter('Guard')");
			const choose = stock.match(/choose takes a goal and its choices, each a list of steps under its name, as in:\n(\{"steps"[\s\S]*?\n\]\})\n/);
			assert.ok(choose, 'the choose example is Arc JSON');
			assert.equal(parseArc(choose[1], verbs)[0].verb, 'command');
			const host = stablePrefix('Guard', identity, verbs, { arcFormat, arcExample: 'command(who=units.filter("Archer"), arc=loop(shoot(others.filter("enemy").minBy(u => u.hp))))' });
			const hosted = host.match(/Example:\s+(\{"steps"[\s\S]*?\})\nYou are /);
			assert.ok(hosted, 'the host example is shown as Arc JSON too');
			assert.equal(parseArc(hosted[1], verbs)[0].args.who, "units.filter('Archer')");
		}
	});

	it('command and law rules appear when the kit has crowd verbs', () => {
		const catalog = new VerbRegistry().addAll(STOCK_VERB_DEFS).addAll(STOCK_COLLECTIVE_VERB_DEFS);
		catalog.add('slash', { args: { target: 'id' } });
		const verbs = catalog.view(['command', 'when', 'law', 'unlaw', 'loop', 'smite']);
		const system = stablePrefix('Guard', identity, verbs, { arcFormat: 'text' });
		assert.match(system, /command\(who, arc\) assigns a sticky program/);
		assert.match(system, /who is YOUR roster/);
		assert.match(system, /units\.filter\("Witch"\)/);
		assert.match(system, /allUnits is one identical program/);
		assert.match(system, /Each command arc is that unit's full chain/);
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
		const verbs = new VerbRegistry().addAll(STOCK_VERB_DEFS).withoutArg('law', 'who');
		const system = stablePrefix('Guard', identity, verbs);
		assert.match(system, /law\(watch, arc, name\?\) is a standing reaction/);
		assert.equal(system.includes('law(who'), false);
		assert.equal(system.includes('allUnits'), false);
		assert.equal(system.includes('Omitted who'), false);
	});

	it('omits verb instructions the kit does not grant', () => {
		const verbs = new VerbRegistry().addAll(STOCK_VERB_DEFS, 'say', 'wait');
		const system = stablePrefix('Guard', identity, verbs, { canSeeMap: true, canRecallKnowledge: true, tools: ['see_map', 'recall'] });
		assert.match(system, /wait\(until\)/);
		assert.match(system, /Available verbs: say\(text, to\?, as\?\) — one short sentence; as one of whisper\/sing\/laugh\/sob\/sigh\/scream\/shout, wait\(seconds\?, until\?\)/);
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
		assert.match(system, /Match the legend \(❌ = you\)\. A second look soon/);
		assert.match(system, /Call see_map first\. Never ask where something is until see_map cannot find it/);
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

	it('says once what runs beside the program, naming only the verbs given', () => {
		const block = (say:string | undefined, beside:string[]):string => volatileBlock({ program: { steps: 'program.arc', keep: 'pass()', say, beside } });
		const all = block('say("…")', ['law', 'watch', 'remember']);
		assert.match(all, /\nprogram\.arc\nTo speak and keep it running, reply with only the say: say\("…"\)\. A law, watch or remember runs beside it too\.$/);
		assert.equal(all.match(/beside/g)?.length, 1, 'one form, not a rule and an example');
		assert.match(block('say("…")', []), /reply with only the say: say\("…"\)\.$/);
		assert.match(block(undefined, ['law', 'watch']), /\nA law or watch runs beside it, and it keeps running\.$/);
		assert.equal(/say|beside/.test(block(undefined, [])), false, 'no verb the kit lacks');
	});
});

describe('choose in prompts', () => {
	const all = new VerbRegistry().addAll(STOCK_VERB_DEFS);

	it('teaches choose to a character that has it', () => {
		const text = stablePrefix('Guard', {}, all, { arcFormat: 'text' });
		assert.match(text, /choose\(goal, name=arc, …\) — a fast model picks one by name/);
		assert.match(text, /as in:\nloop\(until=!some\(others\)\) \{\n\tchoose\("why you choose"\) \{\n\t\twander: wander\(\)\n\t\twait: wait\(\)\n\t\toffer: offer\(\)\n\t\}\n\}\n/, 'a block, every choice named');
		const json = stablePrefix('Guard', {}, all);
		assert.match(json, /choose takes a goal and its choices, each a list of steps under its name, as in:\n\{"steps":\[\n\t\{"verb":"loop",\n\t\t"arc":\[\n\t\t\t\{"verb":"choose","goal":"why you choose",\n\t\t\t\t"choices":\{\n\t\t\t\t\t"wander":\[\{"verb":"wander"\}\],\n\t\t\t\t\t"wait":\[\{"verb":"wait"\}\],\n\t\t\t\t\t"offer":\[\{"verb":"offer"\}\]\n\t\t\t\t\}\n\t\t\t\}\n\t\t\],\n\t\t"until":"!some\(others\)"\n\t\}\n\]\}\nA fast model runs the one that fits right now/);
		const example = json.match(/as in:\n(\{"steps"[\s\S]*?\n\]\})\n/);
		assert.ok(example);
		assert.equal(parseArc(example[1], all)[0].verb, 'loop');
		assert.equal(/[}\]]{6}/.test(example[1]), false, 'no long closing run for a small model to recite');
	});

	it('says nothing of choose when it is withheld', () => {
		const kit = all.view(all.list().map((spec) => spec.name).filter((name) => name !== 'choose'));
		assert.equal(stablePrefix('Guard', {}, kit, { arcFormat: 'text' }).includes('choose'), false);
	});

	it('teaches a collective whose kit grants choose to command it in a loop, ending on no more than two closers', () => {
		const catalog = new VerbRegistry().addAll(STOCK_VERB_DEFS).addAll(STOCK_COLLECTIVE_VERB_DEFS);
		catalog.add('attack', { args: { target: 'id?' } });
		const text = stablePrefix('Dawn', {}, catalog.view(['command', 'loop', 'choose', 'attack']), { arcFormat: 'text' });
		assert.match(text, /as in this command body:\nloop\(until=!some\(others\)\) \{\n\tchoose\("why you choose"\) \{\n\t\tattack: attack\(\)\n\t\twander: wander\(\)\n\t\twait: wait\(\)\n\t\}\n\}\n/);
	});

	it('never offers choose to a collective whose kit lacks it, even among nested arc verbs', () => {
		const catalog = new VerbRegistry().addAll(STOCK_VERB_DEFS).addAll(STOCK_COLLECTIVE_VERB_DEFS);
		const kit = catalog.view(['command', 'when', 'loop', 'law', 'unlaw']);
		const text = stablePrefix('Dawn', {}, kit, { arcFormat: 'text' });
		assert.match(text, /Nested arc verbs/);
		assert.equal(text.includes('choose'), false);
	});

	it('does not mention loop or unlaw unless the kit grants them', () => {
		const catalog = new VerbRegistry().addAll(STOCK_VERB_DEFS);
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

describe('compact prompts', () => {
	const verbs = new VerbRegistry().addAll(STOCK_VERB_DEFS).add('smite', { args: { target: 'id' }, help: '2 damage, 6 paces' });
	const identity = { role: 'Watcher', traits: ['alert'] };
	const opts = { includeWatches: true, watchesWritable: true, canObserve: true, canRecallKnowledge: true, tools: ['recall', 'observe'], systemNote: 'The north is at war.' };

	it('leaves out the standing rules and the stock verbs\' help, and keeps what this game says', () => {
		const full = stablePrefix('Fern', identity, verbs, opts);
		const compact = stablePrefix('Fern', identity, verbs, { ...opts, style: 'compact' });
		assert.ok(compact.length < full.length / 2, `${compact.length} of ${full.length}`);
		for (const rule of ['Watches are Arc expressions', 'recall answers', 'Your name, role, and pinned memories', 'stays within distance until your next arc']) {
			assert.match(full, new RegExp(rule));
			assert.equal(compact.includes(rule), false, rule);
		}
		assert.match(compact, /smite\(target\) — 2 damage, 6 paces/);
		assert.match(compact, /follow\(target, distance\?\)/);
		assert.match(compact, /Tools: recall, observe\./);
		assert.match(compact, /\nYou are Fern\. Role: Watcher\.\nThe north is at war\.\nTraits: alert\.\n\nSteps run in order: each starts once the one before has ended\. Steps in a step's "while" run during it: a say in a go_to's "while" speaks while walking/);
	});

	it('shortens the volatile headers and drops their standing hints', () => {
		const block = volatileBlock({ recent: ['saw Ash'], conversation: ['Ash: hi'], watchesWritable: true, sightFocusWritable: true, compact: true });
		assert.match(block, /^Short-term memory:\n- saw Ash\n\nCurrent Conversation:\nAsh: hi$/);
		assert.equal(conversationBlock(['Ash: hi']).startsWith(conversationHeader(false)), true);
	});
});

describe('constraints in help lines', () => {
	const identity = { role: 'Guard', traits: [] };

	it('says each constraint once, after the verb\'s own help, naming only the verbs this mind has', () => {
		const verbs = new VerbRegistry().addAll(STOCK_VERB_DEFS, 'go_to', 'say', 'wait', 'loop', 'law')
			.constrain('wait', 'seconds', { max: 10 }, 'law.arc')
			.constrain('wait', 'seconds', { min: 1, integer: true })
			.constrain('law', 'arc', { not: ['law', 'command'], maxSteps: 6, depth: 0 })
			.constrain('loop', 'arc', { subverbs: ['go_to', 'wait', 'wander'] })
			.constrain('go_to', 'target', { names: ['Keep', 'Gate'] });
		const system = stablePrefix('Guard', identity, verbs);
		assert.match(system, /go_to\(target\) — target one of Keep\/Gate, /);
		assert.match(system, /wait\(seconds\?, until\?\) — until fails if not met within seconds \(default 20\); seconds a whole number and at least 1; seconds at most 10 inside a law, /);
		assert.match(system, /loop\(arc, through\?, until\?, times\?, unbreakable\?\) — [^,]*,[^—]*; arc only go_to\/wait, /);
		assert.match(system, /law\(who\?, watch, arc, name\?, times\?, until\?, rearm\?\) — standing reaction until unlaw; no extra think; arc without law and at most 6 steps and with no arc inside/);
		const solo = stablePrefix('Guard', identity, verbs.view(['go_to', 'wait']));
		assert.match(solo, /wait\(seconds\?, until\?\) — until fails if not met within seconds \(default 20\); seconds a whole number and at least 1\./, 'no law, no word of one');
	});
});
