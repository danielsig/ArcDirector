# ArcDirector

A runtime for LLM-powered characters: arcs, memory, perception, talk, a priority think queue, local HTTP inference, and the common world verbs (moving, fetching, giving, trading). The host supplies the world through a few callbacks. This package has no renderer, physics, or UI; positions are the host's number arrays (1D, 2D, or 3D) and never reach a model.

```
pnpm test
pnpm demo      # live model, or ARC_DIRECTOR_MOCK=1
```

## Getting started

1. `new ArcDirector()` starts empty.
2. Chain `with…` (one subsystem) and `add…` (lists). Order does not matter.
3. `await start()` is the only assemble step (wires characters and their minds,
   probes the model, checks kit names).
4. `tick(dt, now)` each game frame. Do not call it while AI is paused.

```ts
const director = await new ArcDirector<CharacterCtx>()
	.withLMStudioInference()
	.addStockVerbs()
	.withDefaultKit({ verbs: STOCK_VERBS })
	.withWorld<GameObject>({
		// Queries
		find: (id) => scene.byID(id),                                // the only place an id becomes an entity
		getPose: (go) => go.pose(),                                  // { point: [x, z], facing?, right? }
		getPathGraph: (go) => scene.steps(go),                       // (point) => [{ point, cost?, blocked? }, …]
		getDescription: (go, target) => scene.describe(go, target),
		// Commands
		steerToward: (go, point) => go.headToward(point),            // a position; true once there
		moveItem: ({ character, item, to }) => scene.handOver(character, item, to),
		useItem: (go, item, target) => scene.use(go, item, target),
	})
	.addSense('scene', {
		description: 'What you can see. Names only.',
		gather: (ctx) => ctx.paragraph,
	})
	.withContext((id) => host.ctx(id))
	.addCharacter({
		id: 'Fern',
		mind: {},
		identity: { role: 'Watcher', traits: ['alert'] },
		memories: [{ text: 'I keep watch over the gate.', tags: ['backstory'], pinned: true }],
	})
	.addCharacter({ id: 'Player' })
	.start();

director.tick(dt, now);
```

`start()` returns `Promise<this>`. Every other chain method returns `this`. After a successful `start()`, `with*` throws `Error('ArcDirector already started')`. Lists stay open: `addCharacter` / `removeCharacter`, `addCollective` / `removeCollective`, `addStockVerbs` / `addVerb` / `removeVerbs`, `addSense` / `addTool` / `removeSense` / `removeTool`. A failed start (no model, unknown kit name) may be retried; success then `start()` again is a no-op.

`start({ ignoreMissing: true })` logs unknown names via `onLog` instead of throwing.

Three things run the show:

| | |
|--|--|
| `Character` | Runs arcs in the world: an NPC, the Player, a soldier. It holds its `persona` and `tags`. |
| `Mind` | Writes arcs with the model. A field on a character (`character.mind`), so it can be swapped. It holds no story of its own. |
| `Collective` | Characters sharing one mind: a party, a hive. Its mind's arcs run on its `commander`, or on the collective itself when it has none. |

A `Persona` is who someone is and what they know: identity, goals, memories, names for others, watches and sight focus. A character or a collective has one; its mind only reads and writes it, so dropping or swapping a mind loses nothing. `Character` and `Collective` both extend `ArcRunner`, the arc-running base.

A character with `mind` settings thinks; one without (the Player above) is driven by the host: it runs laws and kit verbs through the same handlers, never calls the model, and never has the mind-only verbs (`MIND_ONLY_VERBS`: think, remember, goals, identity, watches, focus). Drive it with `director.character(id).enact(parseArc(text, character.activeVerbs()))`.

Scripts with no frame loop may use `runLoop(hz)` (returns a stop function). Games must not; they already have a tick.

---

## Subsystems

Each `with*` sets or replaces one slot. Omit the ones you do not need. The happy path omits `.withPriorityQueue()` (priority is the default). Stock verbs are opt-in via `addStockVerbs()`.

### Inference

How chat happens. `start()` rejects if there is no model (`onLog` can print it).

| | |
|--|--|
| `withLMStudioInference(opts?)` | Default `http://127.0.0.1:1234/v1`, flash-attn load, pick a loaded chat model, set `vision`. Pass `baseURL: '/inference/v1'` when a page proxies LM Studio |
| `withOllamaInference(opts?)` | Default `http://127.0.0.1:11434/v1`; pass `baseURL` if yours differs |
| `withHttpInference(opts)` | Any OpenAI-compat base URL |
| `withFakeInference(chat?)` | Tests; default canned `go_to` of a PascalCase name |
| `withInference(provider)` | Your own `chat` / `embed` |

Do not wrap HTTP in a second in-flight queue. The mind queue’s `inFlight` is the cap. `.onLog` wraps chat once (timings + content) so the host does not wrap `chat`.

Live: `setModel`, `model`, `vision`, `catalog`, `infer`.

Inference opts: `baseURL`, `model`, `apiKey`, `enableThinking`, `reasoningEffort`, `batchThinks`, `batchWait`. If you omit `apiKey`, `ARC_DIRECTOR_API_KEY` or `OPENAI_API_KEY` is used. Thinking/CoT is off unless `enableThinking` is true. When it is off, the last message is an assistant prefill that skips the reasoning channel: an empty `<redacted_thinking>` block, or the model's Harmony `to=user` header when `applyPromptTemplate` is set (same method as LM Studio's imageVision plugin). `reasoning` / `reasoning_effort` are sent only when `/api/v1/models` lists that option for the model (`low` when thinking is on and allowed; `on`/`off` for binary models; omitted when the catalog has no reasoning config). The default chat model is whichever catalog id `modelGrade` ranks highest (active params nearest 4B, then total size nearest 20B). An explicit `model` still wins. Native LM Studio load reuses a matching instance and unloads extra copies of it. Parallel thinkers are a queue cap, not load copies. If the preferred model is not already loaded, every other loaded instance is unloaded first so it has VRAM; a failed load unloads any remaining residents and retries. `batchThinks` / `batchWait` are scheduling (same as the queue); the queue's values win if both are set. `onLog` gets the outbound JSON **before** each model call (message bodies in fences below it; images as images, not base64), then the reply.

### Mind queue

Who thinks next. Default is priority (watch / verb scores + recency).

| | |
|--|--|
| `withPriorityQueue(opts?)` | Highest score first |
| `withSimpleQueue(opts?)` | FIFO |
| `withQueue(instance)` | Your `MindQueue` |

`tick(dt, now)` is **sync**. Sample catalogs, `queue.tick`, buffer ready minds. `batchThinks` (default true) holds new starts while any think is in flight — a new prompt's prefill stalls decode of the rest — then starts up to `maxParallel` together when idle, or after `batchWait` seconds (default 20, same clock as `now`). Set `batchThinks: false` to fill a free slot immediately. HTTP and `enact` continue across frames. `dt` / `now` are **game time**.

`mayThink` (on queue opts): idle / live arc / major / watch score. If a live arc exists and think is allowed, the director stops that character (`abortArc(id)`: its moves and waits, then `onAbortArc`) and skips that mind this frame.

In-flight chat is occupancy of a mind-id slot. `mind.abortThink()`, `director.abortThink(id)`, and `queue.abortThink(id)` trip that slot's `AbortSignal`. Removing a character or collective, dropping a mind (a join, `character.mind = …`), `setAiOn(false)`, `drop`, and vacating a commander abort as a side effect. A completed reply is discarded if the slot was aborted before enact.

### Verbs

| | |
|--|--|
| `addStockVerbs(...verbs)` | Registers stock verbs; the library runs them (world verbs through `withWorld`). No args = all of them. Pass names to opt in to a subset: `addStockVerbs(...STOCK_MOVE_VERBS)` is `go_to` / `follow` / `wander`; `STOCK_ITEM_VERBS` is `use` / `pick_up` / `drop` / `give` / `examine`; `STOCK_MIND_VERBS` is `say` / `wait` / `remember` / `think` / `set_goal` / `drop_goal` / `set_identity` / `watch` / `unwatch` / `focus` / `unfocus`; `STOCK_ARC_VERBS` is `law` / `unlaw` / `when` / `loop` (spread last into `STOCK_VERBS`); `STOCK_TRADE_VERBS` is `buy` / `sell`, registered with the rest but kept out of `STOCK_VERBS` so a kit grants them only where there is trade. Same name again is skipped. |
| `addStockCollectiveVerbs(...verbs)` | Schema only for `issue` / `tag` / `untag` / `spread` / `circle` / `hold_line`. Registering does not grant; the collective's kit does. |
| `addVerb(name, { args?, help?, handler? })` | Schema + optional world function. The handler's `args` are typed from `args` (`{ item: 'id', offer: 'number?' }` gives `{ item: string; offer?: number }`); a stock verb's are typed from its stock args. `help` is one line shown after the verb in the prompt's verb list (`shoot(target) — needs a clear line of sight`); stock verbs carry theirs the same way. Same name again binds/replaces the handler; a host handler replaces a stock one. |
| `removeVerbs(...names)` | Drop catalog schemas and named handlers. Missing names are skipped. Empty rest is a no-op. |
| `withDefaultKit(kit)` | Object or `(ctx) => kit` used when a character or collective spec omits `kit`, a collective's characters too. Same fetch-every-tick rules. |
| `withVerbGate(fn)` | Runs before every host verb with the full `VerbCall`. Return a result to refuse the step (a cutscene, a won fight); `undefined` lets it run. |
| `onVerb(fn)` | Catch-all for verbs with no handler of their own. |
| `withVerbs(registry)` | Replace the whole registry |

The catalog is shared (`addStockVerbs` / `addVerb` / `removeVerbs`). What a character or collective may use is its **kit**, fetched every tick: a plain object (mutate it, or use getters) or `(ctx) => kit`. Registering a verb does not grant it. `withDefaultKit` is the common grant; a spec's `kit` overrides it. Fetching every tick is cheap; **changing** the grant is not, because the verb list is in the system prefix ([Prompt prefix](#prompt-prefix)).

```ts
type Kit = { verbs?: string[]; senses?: string[]; tools?: string[] };

director.withDefaultKit({ verbs: STOCK_VERBS });
director.addCharacter({ id: 'Holt', mind: {} }); // default kit
director.addCharacter({ id: 'Baker', mind: {}, kit: vendorKit }); // same object; mutate later
director.addCharacter({ id: 'Cook', mind: {}, kit: (ctx) => kitFor(ctx) }); // callback
```

Every character and collective needs a kit, its own or the default one, and a fixed kit must name some `verbs`; `start()` throws otherwise. A collective's kit is what its mind may write; each of its characters runs steps with its own kit, and the roster tells the mind what one cannot do. `senses` / `tools` omitted = all registered senses / tools; `[]` = none. `start()` also throws if a kit grants a stock world verb whose `withWorld` part is missing (and no host handler or `onVerb` covers it), or names a verb, sense, or tool that is not registered (`recall` / `observe` always; `earshot` with talk; `see_map` with map and vision; `grep_world_encyclopedia` with `withEncyclopedia`).

**Senses** are English always in the user block (`scene`, inventory, events). **Tools** are on-demand (`recall`, `observe`, `see_map`, `grep_world_encyclopedia`). Kit `senses` / `tools` lists are allowlists over what you registered, not extra gatherers.

Prompt, JSON schema, and parse use the kit of the mind's owner. A step whose verb is not available fails closed. `character.verbs` is the catalog; `character.activeVerbs()` is this tick. Assign `character.kit` when the grant actually changes, not every frame.

Handlers receive a **`VerbCall`**: `{ verb, args, character, ctx, units?, score, holds, goTo, goToPoint, wait }`. `character` runs the step; `ctx` is `withContext(character.id)`, and a step whose character has no context fails with `not in this scene` before any handler runs (a collective acting with no commander is told to issue it to one of its characters). `units` is set when a formation verb runs once on a set. The arc running now is `character.arc` / `character.verbIndex`; the mind's last arc is `mind.lastArc`.

The library does the mind's half of every verb, so handlers only move the world:

- **`id` args are real ids.** The model may write its own name for a character (see Names) or an expression that picks one (`cleave(others.filter("enemy").minBy(u => u.hp))`); the mind turns names into ids as it reads the reply, and an expression becomes the id it picks. An expression that picks no one fails with that reason before the handler runs. Plain names the library does not know pass through for the host to judge (`no such place Cottag`).
- **`watch` args are checked, then asked.** Bad syntax or leftover English (`filter("trees")`) fails before the host runs. `call.holds('until')` says whether the watch holds now; `call.score('until', point)` asks how well it would fit if this character stood at `point` (how `wander` picks where to go).
- **Moving and waiting are the library's.** `call.goTo(target, within?)` moves this character into reach of `target`, following it as it moves; `call.goToPoint(at, within?)` moves it to a point; `call.wait(seconds)` lets game time pass. All three end, interrupted, when the step is aborted. A host verb that needs to be somewhere first (`steal`, `heal`) awaits one of them and keeps only its own rules.
- **Mind-internal verbs never reach the host:** `remember`, `think`, `set_goal`, `drop_goal`, `set_identity`, `watch`, `unwatch`, `focus`, `unfocus`, `say` when TalkNet is attached, and `wait`: game time passes until `seconds` (default 1, or 20 with `until`) or until the `until` watch holds. An aborted arc ends the wait. Bind your own `wait` handler only if waiting must do something in your world.

Arg kinds are `id`, `string`, `text`, `watch`, `expr`, `law`, `number`, `string[]`, `arc` (add `?` for optional). `expr` is any other expression (`issue(who=units.filter("Archer"))`) and `law` a law's name; a mind keeps every `id`, `watch`, `expr`, `law` and `arc` arg in ids. `text` is prose: unquoted, it runs to the closing `)` or to the next `, key=` of that verb, so commas and apostrophes need no quotes (`say(Hello there, BridgeKeeper's friend, to=Player)`). Use it for any arg a model fills with a sentence.

### Perception

Senses every think in the user block; tools on demand. `addSense` / `addTool` replace the same name and stay open after `start()`.

| | |
|--|--|
| `withSight({ look, limit, unitName })` | Stock sense `sight`. `look` returns a `Sight` of `SeenObject[]` (`point` vectors). `limit` is the default max **irreducible sight clauses** after `sightFocus` order. A spec's `sightLimit` overrides. `unitName` is the leftover distance unit (`m`, `pace`, `foot`); omit for `pace`. Omit `look` to set only the cap; omit `limit` for no cap. |
| `withInventory(look)` | Stock sense `carrying`. callback returns an `Inventory` bag. The list ends by saying nothing else is carried, so a role that often has something does not imply it has it now. |
| `withEncyclopedia(pages, { mentions? })` | Stock tool `grep_world_encyclopedia`. `pages` is `{ name, aliases?, text }[]` or `(ctx) => pages`. Articles also come to a mind unasked: a name or alias said or heard lately brings its article under short-term memory (at most `mentions` per think, default 2, 0 for none; not again for 5 thinks). Mark things a character carries with `item: true`: their mention also says whether this mind carries one ("FireMushroom (you carry none)"), every time, so a claim in talk sits next to the truth for speaker and listener, and a name in a failed verb's reason brings its article under that result. `crowdEncyclopedia({ name, tag, inside })` builds a leftover-crowd article from `formatSight` (a bunch around you). Query leftover English (`trees`, `house`) or a spoken place (`forest`) for the Capitalized type. Empty query lists names. Articles stay out of the standing prefix. |
| `withLineOfSight((aID, bID) => boolean)` | One occlusion callback for sight, talk `canSee`, and watch `hasSightline`. |
| `addSense(name, spec)` | Host-only sense. `spec` is `{ description, gather }`. |
| `addTool(name, spec)` | `spec` is `{ description, parameters, handler }`. |
| `removeSense(...names)` | Missing names are skipped. Empty rest is a no-op. |
| `removeTool(...names)` | Same. |

`Sight.self.id` is the name. Noun is `id`. Omit `withLineOfSight` and everything in `look()` is seen. Omit `addTool` and the host adds no tools. Built-in `recall` / `observe` / `see_map` / `grep_world_encyclopedia` still appear when those subsystems are on.

### Context and kernels

The library knows characters and collectives by **id**; a mind goes by its owner's. It does not know your `World`.

- **`withContext((id) => ctx)`:** the context a character acts in: `TCtx`, whatever the game wants it to hold. Perception `gather(ctx)`, kernels, kits, and verb handlers get it. A mind senses through its voice's context. Generic parameters follow one rule: they start with `T` (`TCtx`, `TEntity`, `TArgs`), so a slot the host fills never reads like a library type.
- **`withKernels((ctx, point?) => kernels)`:** what a mind knows for watches (`me`, `others`, `items`, `isHurt(me)`, `inventory`). When `point` is set, a verb is asking what if this character stood there: answer as if it did (who it would see from there). The library always `buildCatalog`. Director owns each character's `SampleCache` (overwrites `cache`; you do not commit it). It also overwrites `hasHeard` / `prev` from that mind, `canSee` when `withLineOfSight` is set, and all geometry (`distance`, `nearby`, `isFacing`, `isLeft`, `pathDistance`, `manhattan`, …) from `withWorld` poses and routes, so kernels never measure space.

Verbs need objects. Watches need measurements. Same `ctx`, two jobs.

### World

`withWorld<TEntity>(world)` is the game's world as the stock verbs need it. `TEntity` is the game's own type for things in its world (a GameObject, an ECS entity, a record); the library never looks inside one. **`find(id)` is the only place an id becomes an entity**, and every other part receives entities, so the game never looks anything up twice. When `find` returns `undefined`, the verb fails with "no such …" or "… is gone" before any other part is called. Items stay ids (`item`, and `examine`'s target): which Bread is meant depends on whose pack it is in, and that is the game's call.

**Queries** (`find`, `get…`, `up`) only read the world and may be called any time, often. **Commands** (`steerToward`, `moveItem`, `useItem`, `trade`) change it. Each part unlocks verbs:

| Part | Kind | Unlocks |
|--|--|--|
| `find(id)`, `getPose(entity)` | query | watch geometry: `distance`, `nearby`, `isFacing`, `isLeft` / `isRight`, `manhattan`, … |
| `getPathGraph(character)`, `steerToward(character, point)` | query, command | `go_to`, `follow`, `wander`, the collective formations (`spread`, `circle`, `hold_line`), `pathDistance` / `isReachable`, `call.goTo` |
| `getDescription(character, target)` | query | `examine` |
| `moveItem({ character, item, to? })` | command | `pick_up`, `drop`, `give` |
| `useItem(character, item, target?)` | command | `use` |
| `trade({ character, side, other, item, quantity, price? })` | command | `buy`, `sell` |

- **Positions and directions are number arrays**, in world space and in whatever dimension the game uses: `[x]`, `[x, z]`, `[x, y, z]`. A position is always called `point`; a direction is named for where it points (`facing`, `right`, `up`) and is a unit vector. `getPose` returns `{ point, facing?, right? }`, so left and right mean what the game means. A 3D game can set `up` (default `[0, 1, 0]`) for formations.
- **Earshot is not reach.** Someone can be in talking range and still unreachable (across a river, on the phone). The earshot sense marks them with the same blockers a failed move names: `Angler (unreachable, blocked on the way: Bridge is raised)`. A failed move remembers whom it could not reach (`ArcResult.unreachable`); an arc that opens with the same verb toward them is refused in the same think while the way is still blocked, and goes through once it opens. A think whose reply never became a valid arc, even after repairs, ends nothing that would wake the mind again, so it thinks again with `think failed — your reply was not a valid Arc: …` as its last result.
- **Routes are the library's.** `getPathGraph(character)` is called once per search and returns the neighbors of any position: as many `{ point, cost?, blocked? }` steps as there are. Grid cells, navmesh polygons, a weighted waypoint network, or a line: the library runs A* over whatever it gets. The position asked about need not be a node: a route starts where the character stands and arrives through the steps out of the destination (taken backwards), so a network returns the waypoints in sight of an arbitrary position. Characters differ (a child fits a gap a knight does not), so the graph is per character. `cost` defaults to the step's length and must not be less; raise it to route around crowds or rough roads. A `blocked` step ("EastDoor is locked — you carry IronKey") is avoided. With no open way, the move fails naming every blocker that leads there, cheapest first, so a mind facing two locked doors learns about both and can pick the one it holds the key to. Say in the reason what this character could do about it.
- **The library moves characters; the game animates them.** While a character moves, `steerToward(character, point)` is called every tick with the position of the next waypoint (never a direction), or `null` to stand, and returns whether the character is at `point` by the motor's own measure. Speed, collisions, animation, and how close counts as there stay in the game, so the library needs no notion of units. A character that makes no progress gets a new route, then fails with `stuck`. Without `getPathGraph` / `steerToward`, characters do not move: `call.goTo` succeeds only when already in reach.
- **`getReach(character, target)`** is how close a character must be to act on `target` and to count as there (default 1). A building can return its half-width, so arriving inside counts.
- **Trades say which side asked.** `side` is what `character` does (`buy` or `sell`) and `other` is the party across the counter. `buy` and `sell` take `quantity` (default 1); `price` is the total for all of them, when the mind named one.
- **World rules stay in the game.** `moveItem`, `useItem`, and `trade` change the world and return `{ ok, reason? }`. Refuse with a reason the mind can act on ("Chest is locked", "Mira will not go below 5 gold") and announce what happened with `pushEvent`, as the game does when the player acts. The library moves into reach first, and checks nothing the game knows better.
- **Stopping a character:** `director.abortArc(id)` ends its moves and waits now and calls `onAbortArc`.

### Names

By default every mind calls a character by its id. `withNames({ seen })` lets the host decide what each mind calls each character, per observer:

```ts
director.withNames({
	seen: (observer, target) => (
		target.tags?.includes('enemy') ? 'EnemyKnight' : target.id
	),
});
```

`observer` is `{ id, ctx }` (the mind's owner, and its voice's `withContext` result). `target` is what the mind holds about the character: `{ id, tags?, hp?, maxHP? }` from sight or from kernels. `id` is the only identifier a host gives; return it to call the character by its id. `seen` returns a **base** name and should be a pure function of its arguments. A name is always one observer's label for an id, and only the library writes it (`ExprEntity.name`).

Each persona keeps its own book. The book keeps a name stable, numbers duplicates (`EnemyKnight`, `EnemyKnight2`), remembers old names as aliases, and is saved with the persona because memories quote those names. The library applies it everywhere a name reaches the model: sight, earshot, heard speech, the `see_map` legend, watch-language entities and bindings, a collective's roster, laws, watches, sight focus, and event `who`.

**Arcs, laws, watches and sight focus are stored in ids.** A mind turns its model's names into ids as it reads a reply (`id` args, and the characters named in `watch`, `expr`, `law` and nested `arc` args; prose is never touched), and turns ids back into its own names in every prompt line that shows them. So handlers and kernels only ever deal in real ids, and a law still works after its character moves to a collective whose mind names everyone differently. `mapArc`, `mapExpr`, `idsOf` and `namesOf` do the rewriting.

A stranger is the same mechanism: return `MerchantWithBlueHat` from the target's tags until the mind has been told the name, and the book keeps that label steady with no memo on the host side. Once the policy returns the real id, the old label stays an alias, so memories that quote it still resolve.

Events that mention characters pass real ids in `who` and number them in the text. Each mind reads its own names, and gets them as tags. A mind's own owner or voice named in `who` reads as "you" (or "You" at the start), so write event texts that read in both persons: past tense, as in `{0} gave Bread to {1}`.

```ts
director.pushEvent({ kind: 'Hurt', text: '{0} cleaved {1}', who: ['Brune', 'Helms'], tags: ['hurt'] });
// one party reads "Brune cleaved EnemyKnight", the other "EnemyKnight cleaved Helms"; Helms's party reads "EnemyKnight cleaved you"
```

`director.seen(observerID, target)` gives the same name for text the host writes itself, such as a sight `note`. `observerID` is a character or a collective.

### Talk and map

- **`withTalk(sense, onSpoke?, config?)`:** range and routing. Library routes `say()`. Line of sight is `withLineOfSight`. When an arc ends on a `say`, the speaker waits up to 20 s for an answer before its next think (a watch can end it sooner; a `say` mid-arc never pauses the rest), but only when someone who could answer heard it clearly: the addressee when `to` is set, anyone otherwise. Unheard or muffled speech goes straight on. The say result names who it was for but could not make out the words (`heard by Baker; too far for Guard to make out the words: get closer`), and earshot marks them `too far to make out your words`. A `say` whose content words (stemmed) mostly repeat a line everyone it is for already heard clearly is refused before anyone hears it: "they already heard you say that". `hasHeard` is true only for speech meant for this mind.
- **`withMap(sense)`:** host paints `see_map` pictures and marks characters, things and places by `id`; library stamps a legend in the mind's own names (no coordinates). Omitted unless vision is on.
- **`withEncyclopedia(pages)`:** host type docs; minds `grep_world_encyclopedia(query)` instead of stuffing every type into the standing prefix.

### Characters

`addCharacter(spec: CharacterSpec)` before or after `start()`. `removeCharacter(id)` removes a character for good, on its own or from its collective. Ids are one namespace across characters and collectives; a duplicate throws.

```ts
type CharacterSpec = {
	id: string;
	mind?: MindSettings; // give it a mind of its own; omit for a character the host drives
	tags?: string[];
	kit?: Kit | ((ctx) => Kit); // fetched every tick; omit = withDefaultKit
	laws?: LawSpec[];
	// persona
	identity?: { role?: string; traits?: string[] };
	goals?: Goal[];
	memories?: MemoryDraft[];
	watches?: WatchInput;
	pinnedWatches?: WatchInput;
	watchesWritable?: boolean;
	pinnedSightFocus?: string[];
	sightFocus?: string[];
	sightFocusWritable?: boolean;
	maxSightFocus?: number;
	sightLimit?: number;
};

type MindSettings = {
	skipHeartbeat?: boolean;
	skipMajor?: boolean;
	rank?: number; // tie-break after watch score
	heartbeat?: number;
	strategicInterval?: number;
};
```

`withMindDefaults(settings)` sets what every new mind starts from; a spec's `mind` wins. `director.character(id)`, `characters()`, `collective(id)`, `collectives()`, `minds()`, `exportCast()` / `restoreCast(cast)`, `pushEvent` (each mind once). `restoreCast` before `start()` keeps the save and builds the cast from it as `start()` wires everything.

The character's `id` is its name. A mind introduces itself by its owner's id (`You are Fern.`). `role` is an optional plain tag (`Herbalist`) that hosts can also accept as an address. Backstory goes in pinned `memories`. `set_identity(role?, traits?)` never renames. Identity is who they are. Do not rewrite role or traits to recap a mood, an order, or this think. That belongs in goals and events ([Prompt prefix](#prompt-prefix)).

A host may also build a mind itself and hand it over: `character.mind = new Mind({ rank: 2 })`. The director wires the model and the queue when it attaches.

### Collectives

Characters sharing one mind. `addCollective(spec)` takes the collective's own kit, laws and persona fields, its mind's settings, its `characters`, and an optional `commander`. The mind's arcs run on the commander, the collective's voice; without one the collective (a hive) runs them itself, seeing through all its characters at once (its `me` is a dummy at their average pose, with no carrying).

```ts
const director = await new ArcDirector<CharacterCtx>()
	.withLMStudioInference()
	.addStockVerbs()
	.addStockCollectiveVerbs()
	.withDefaultKit({ verbs: STOCK_VERBS })
	.withSight({ look: (ctx) => host.look(ctx), limit: 16 })
	.withContext((id) => host.ctx(id))
	.addCollective({
		id: 'MarketHive',
		identity: { role: 'Hive' },
		pinnedSightFocus: ['isHurt(it)', 'isNear(it, Player)'],
		kit: { verbs: [...STOCK_VERBS, ...STOCK_COLLECTIVE_VERBS] },
		characters: [{ id: 'Mira', tags: ['Guard'] }],
		laws: [{ name: 'flee', who: 'units.filter(u => !u.busy)', watch: 'isHurt(me)', arc: 'go_to(Keep)' }],
	})
	.start();

const hive = director.collective('MarketHive')!;
hive.addCharacter({ id: 'Tomas', tags: ['Shopper'] }); // a new character, in the hive
hive.removeCharacter('Tomas'); // gone for good, as director.removeCharacter
```

**`issue(who, arc)` is instantaneous.** It assigns sticky programs and returns `ok` without waiting for characters to move, talk, or finish. Join several `issue` with `;` so later ones still run. `&&` `;` `||` *inside* `arc=` sequence that character. `then_if_ok` after `issue` means orders assigned, not characters finished. To wait on them from the thinker: `wait(until=...)` over the roster.

`who=` is an expr on `units` (the roster less the commander; `allUnits` is everyone), not `others`. Issue by tag. A character's spec tags travel with it; a tag the mind adds with `tag` is stored `` `${collective.id}:${short}` `` and dropped when the character leaves. Exprs and prompts use the short name. Formations (`spread` / `circle` / `hold_line`) run once on the set and must be the `issue` arc head. Inner `me` in `arc=` / law `watch=` is that character. Each character runs what it is issued with its own kit; the roster tells the mind which of the collective's verbs it cannot run.

**Laws.** `law` / `unlaw` are standing emergencies (no LLM) that preempt when `watch` holds. A collective's own laws reach its characters by `who`. A character's own laws live on its collective as `Tom.flee`: the prefix is the filter, so they take no `who` and reach only Tom. Each group holds at most `maxLaws`, and the collective's own laws outrank its characters'. Law names hold no `.`; ids may, since the prefix ends at the last one. A `law(...)` step run by a character who is not the commander writes its own `Tom.` law. Running laws and `when`s are tracked by the law or step itself, so renaming one never restarts it.

**Moving characters.** Characters change collectives through two setters; the arc a character is running keeps running across all of them.

| | |
|--|--|
| `character.collective = c` | Moves it straight into `c` from any other collective. Its own mind goes (its settings are kept), its laws move in as `Tom.*`, the old collective's tags and commander post are dropped. |
| `character.collective = null` | Leaves. It thinks with a fresh mind from its kept settings, or the host drives it if it never had any. Its laws lose their prefix; laws that need a collective (`units`, `allUnits`) are dropped, and its new mind is told which. |
| `character.mind = m` | Its own mind from now on, out of any collective. A collective's mind means joining that collective. `null` hands it to the host and forgets its settings. Another character's mind throws. |

The collectives involved hear "Tom joined" / "Tom left", and a character that left is told what it is still doing for the collective it left. `removeCollective(id)` moves every character out first, so each ends up on its own. `onCommanderVacant((collective, character) => …)` fires when a commander leaves or is removed; name a successor with `collective.commander = …`.

**Memory handover.** After a move, one model call fixes the memories of everyone involved: what went stale in a collective left, and what a character or the collective it joined should now remember. Moves within `ticks` director ticks share one call (a character moving twice is one journey, first `from` to last `to`), and characters without an identity are skipped. The call takes the next free think slot, never stops a think, and nothing waits for it; pinned memories are never touched. It is on by default: `withMemoryHandover({ ticks?, handover? })` widens the window or swaps in your own `Handover = (journeys) => Promise<MemoryEdit[]>`, and `handover: false` turns it off.

### Prompt prefix

Each think is two messages. The **system** message is identity, standing instructions, and the kit’s verb list (plus a `see_map` hint when vision is on). The **user** message is everything that is supposed to change: scene, carrying, events, goals, pinned memory, watches, last verb.

Local servers (LM Studio, llama.cpp, Ollama) keep a **KV cache**: the attention state for a run of tokens. If the next request starts with the same tokens as a recent one, they reuse that state and skip the work. Reuse only holds while the tokens match from the start. The first token that differs, they recompute from there through the end, including the long user block you meant to be cheap. One early edit costs a full prompt reload.

The standing lines are yours to replace:

| | |
|--|--|
| `withThinkInstructions({ on?, off? })` | The think line, by reasoning state. The prompt follows the live reasoning switch (`setThinking`). `on` defaults to "Think in 5 sentences, then emit the arc."; `off` defaults to nothing, since the prompt already asks for the Arc alone. |
| `withVerbInstructions(text)` | The verb-chain line. For a collective the default also asks for looping programs; this replaces both. A host's standing doctrine goes here. |
| `withArcExample(arc)` | The Example that closes the prompt. Small models copy it, so make it valid and paren-balanced. |
| `withRepair({ retries?, temperature? })` | Repair turns after a bad arc (default 0) and the temperature from the second repair on (default 0.4; the first stays at 0). |
| `withToolRounds(n)` | Tool rounds a think may spend before it must emit the Arc (default 6, `DEFAULT_TOOL_ROUNDS`; small models need several lookups in a row). `0` offers no tools. The same tool with the same arguments twice in one think is refused, not rerun. |
| `withStalled(fn)` | Whether a finished arc stalled, which stretches that mind's heartbeat (default: failed or interrupted). |

Tool hints (`see_map`, `grep_world_encyclopedia`, `observe`) appear only on thinks where that tool is actually offered.

Keep the system side still across thinks:

- **Identity:** lasting who. A new role is a life change, not “I am angry” or “Player told me to wait.” The model is already told not to rewrite identity to recap a moment; the host should not either.
- **Kit:** lasting grant. Returning the same kit every tick is fine. Flipping verbs, senses, or tools every tick (gag for one line, vendor only while the player looks, unconscious = empty kit) busts the prefix for that mind. A gag or a stall that lasts a scene is one change, then leave it. Unconscious should skip the think (`mayThink`), not rewrite the kit for a frame.
- **Vision / `see_map` / you-mark:** leave them on or off for the session. The library already keeps tools listed (`tool_choice: none`) on arc turns so follow-ups *inside* a think share a prefix.

`addVerb` / `removeVerbs` rewrite the shared verb catalog. `addTool` / `removeTool` change the tool list on the request. Same cost as changing the kit if those lists are in the prefix.

---

## Full example

```ts
const director = await new ArcDirector<CharacterCtx>()
	.withQueue(new MyMindQueue())
	.withInference(myProvider)
	.addStockVerbs()
	.withWorld(host.world)
	.addVerb('steal', {
		args: { item: 'id', from: 'id' },
		help: 'goes to them first',
		handler: async (call) => {
			const near = await call.goTo(call.args.from);
			return near.ok ? host.steal(call.ctx, call.args.item, call.args.from) : near;
		},
	})
	.withDefaultKit({ verbs: [...STOCK_VERBS, 'buy', 'steal'] })
	.withSight({ look: (ctx) => host.look(ctx) })
	.withInventory((ctx) => host.inventory(ctx))
	.withLineOfSight((a, b) => host.canSee(a, b))
	.withKernels((ctx) => host.kernels(ctx))
	.withTalk(host.talkSense)
	.withMap(host.mapSense)
	.withContext((id) => host.ctx(id))
	.onAbortArc((id) => host.stopCasting(id))
	.onLog((entry) => hud.push(entry))
	.addCharacter({
		id: 'Captain',
		mind: { rank: 1 },
		identity,
		goals,
		pinnedWatches: { hurt: 'isHurt(me)' },
	})
	.start();
```

---

## Mind (low-level)

`soloCharacter({...})` builds a character with a mind of its own and no director, for unit tests and scripts. Getting started does not use it.

`Mind<TCtx>` writes arcs for its owner, a character or a collective. `tick(gameTime)` may revise goals (strategic) and emit one `Arc` (tactical), which its voice enacts when that voice has an executor and `autoEnact` is on. `thinkNow({ about?, enact? })` thinks once now. `arcText` skips the JSON goals pass so the only chat is the text arc. The voice's `verbIndex` is the 0-based step currently running inside `enact`.

### When tactical runs

| Condition | Effect |
|-----------|--------|
| First `tick` | Always thinks |
| `lastResult.interrupted` | Thinks |
| Pending event with `major: true` | Thinks |
| `heartbeat <= 0` | Thinks (the queue already picked this mind) |
| Else | Thinks if `gameTime - lastTacticalTimestamp >= heartbeat` |

Defaults: `heartbeat` 0 under a director (its queue paces thinks; 30 in `soloCharacter`), `strategicInterval` 180. `strategicInterval <= 0` disables the periodic pass.

Tactical: assemble senses → optional memory intrusion → tools (`recall`, `observe`, `earshot`, `see_map` when the host maps and the model can see, `grep_world_encyclopedia` when `withEncyclopedia` is set, plus host tools) up to `toolRoundCap` → `Arc` (JSON, or `go_to() && wait()` text when `arcText` is on). System vs user split is under [Prompt prefix](#prompt-prefix).

### Options

| | Default | |
|--|---------|--|
| `model` | first preferred | Chat model id |
| `embedModel` | none | Optional embeddings |
| `toolRoundCap` | 6 | Tool turns before the arc must appear; 0 offers no tools |
| `arcRetryCap` | 0 | Extra turns after a bad arc |
| `intrusionThreshold` / `intrusionCooldown` | 0.55 / 45 | Unbidden memory into the prompt |
| `recallK` | 5 | Default `recall` hit count |
| `hideObserve` | false | Omit the built-in `observe` tool |
| `map` | none | Host snapshots for `see_map` |
| `encyclopedia` | none | Host type articles for `grep_world_encyclopedia` |
| `vision` | heuristic | `true` / `false` for image input |

`maxGoals` (default 5), watches, sight focus and their writable flags live on the `Persona`.

`pushEvent` queues text for the next think (`major` wakes immediately; speech is major only when it is to the listener, names them, or is said to everyone and heard clearly, so talk between others is overheard without waking anyone; `remember` also files it as an episodic memory; `timestamp` defaults to now). `remember(text, tags)` writes a memory into the owner's persona. `toJSON` / `Mind.fromJSON` round-trip the mind's settings and thinking state; the persona is saved with its owner.

---

## Think queue (details)

Each tick: accumulate time → sample watches every `watchInterval` (0.25) → emit rows every `processInterval` (1) → buffer ready minds. With `batchThinks` (default true) the director starts a wave of up to `maxParallel` (default 2) only when `inFlight` is 0, or after `batchWait` seconds (default 20) if someone is still generating. `batchThinks: false` fills a free slot as soon as one opens. Set these on `withPriorityQueue` or `withHttpInference` (queue wins if both set). Walking an arc does not count as in flight. Reasons: `watch`, `major`, `verb`, `heartbeat`.

`mayThink` is optional. Omit it and a live arc blocks a new think. The callback gets `mindID`, `reason`, `score`, `rankedScore`, the live `arc` (or `null`), and `verbs` on that arc.

Watch score: boolean true → `trueScore` (0.51); numbers in 0–1 used as-is; `> 1` clamps to 1 and scolds. Score must exceed `epsilon` (0.05) to enqueue.

Priority ranking multiplies that score by a recency scale: just after a think it is `trueScore` (0.51); it lerps to 1 by `heartbeatStart / 2` (1.5s at the default 3). Never-thought minds stay at 1.

Heartbeat (per mind): a low-priority (0.001) pulse every `heartbeatStart` (3s), clamped `[heartbeatMin, heartbeatMax]` (3–300). Interval is fixed unless you set `heartbeatAdjust: 'auto'` (stretch on stall, shrink otherwise) or a callback.

---

## Watches

Standing conditions against a `Catalog` from `HostKernels`. Dict: short **name** → **expr**.

**Pinned** watches (`pinnedWatches`) are host-authored. The LLM cannot add over, edit, or remove them. Extra watches live in `watches`. When `watchesWritable` and the kit grants them, the model edits extras with `watch(name, expr)` (add or replace) and `unwatch(name)`; `focus(expr)` / `unfocus(expr)` do the same for `sightFocus` under `sightFocusWritable`. A pinned name fails with a reason. They are ordinary steps, so they run in arc order: in `go_to(Gate) && watch(...)` the watch is added only if `go_to` succeeds.

Language looks like JS calls; it is not a JS subset. Bindings: `me`, `others`, `items`, plus host names (`bindings`). `hasHeard` and `prev` come from the mind when you go through `ArcDirector` (`prev.me` / `prev.secondsAgo` / `prev.verbs`: last think, or spawn freeze if they have never thought). Pass `prev` yourself only to standalone `buildCatalog`.

```
hasHeard || some(others.nearby().approaching())
isHurt(me)
isNear(me, Other, 16)
distance(me, Target)
i is "marked"
```

| | |
|--|--|
| Relations | `distance`, `isNear`, `isReachable`, `isApproaching`, `isDeparting`, `hasSightline`, `hasJustSeen`, `hasLostSight`, `facing`, `isFacing`, `isBehind` |
| List filters | `others.nearby()`, `.nearby(16)`, `others.reachable()`, `.approaching()`, `.departing()` |
| Lists | `filter` / `find` / `some` / `all`, `map`, `sortBy`, `count`, `includes`, `first`, `max` / `min`, `sum`, `avg`, `reduce` |
| Logic | `&&` / `\|\|`, `*`, ternary, `??` (absent only), `!` / `!!` |
| Host extras | `hp` / `maxHP`, `isHurt`, `isHPFalling`; `isCarrying` / `wasCarrying` / `hasJustReceived` / `hasJustLost` (only if `inventory`); `isOpen` / `hasJustOpened` |

Identifiers: leading acronyms are lowercase (`id`, `hp`, `npc`); later in a name they stay caps (`maxHP`, `npcID`).

`observe({ expr })` evaluates once and stringifies. Standing conditions belong in watches.

---

## Catalog kernels

`buildCatalog(host)` wires natives from what you pass. Omit a kernel and those functions are absent. `withKernels` is the public path; `buildCatalog` stays for tests.

```ts
type HostKernels = {
	me: ExprEntity;
	others: ExprEntity[];
	items: ExprEntity[];
	cache: SampleCache;           // director injects this
	bindings?: Record<string, ExprVal>;
	hostFns?: Record<string, NativeFn>;
	distance?: (a, b) => number | undefined;            // director: from withWorld
	nearRadius?: number;
	point?: (who) => number[] | undefined;              // director: manhattan / chebyshev / inSquare
	listCap?: number;                                   // a collective's who= caps at roster size
	pathDistance?: (a, b) => number | undefined;        // director: route length; undefined = no way
	canSee?: (a, b) => boolean;                         // director overwrites when withLineOfSight
	facing?: (a, b) => number;                          // director: from withWorld
	inventory?: (who) => ExprEntity[];
	hp?: (who) => { hp: number; maxHP: number } | undefined;
	isOpen?: (who) => boolean | undefined;
	hasHeard?: boolean;           // director injects
	prev?: {                      // director injects (last think; spawn freeze if never)
		secondsAgo?: number;
		me: ExprEntity;
		verbs?: {
			secondsAgo: number;
			isOk: boolean;
			reason: string;
			verb: string;
		}[];
	};
	stringifiers?: Stringifiers;
};
```

Space enters expressions only through these callbacks. Under `ArcDirector` they come from `withWorld` (and `canSee` from `withLineOfSight`); `buildCatalog` alone takes them as given.

---

## Arcs

```ts
{ head: { verb: 'go_to', args: { target: 'Keep' } }, then?: { join, arc } }
```

Joins: `then_if_ok` (`&&`), `then` (`;`), `then_if_err` (`||`). Chain as far as the next verbs are known. A think is expensive — emit that whole chain this think, not one verb and not only the first step of a spoken then-order. `then` still runs after a failed `pick_up` (already holding). `think()` is always moved to the end. `wait(seconds?, until?)` parks; `until` is a one-shot watch.

Arc text is read forgivingly, because small models slip: extra `)`, `.` or `,` after a step are dropped; closers missing at the very end are supplied; two steps with no join between them are joined with `;`. A reply that stopped at the token cap (`ChatResponse.truncated`) is never parsed; it goes to a repair turn. An `issue` that swallowed the next `issue` (a closer missing mid-line) is rejected.

`ArcResult`: `{ ok, interrupted?, reason?, verb? }`.

### Follow-up think

After an arc, `enqueueArc` uses the **highest** score among steps **after** the last `wait(until)`. Failure is at least 0.3. Stock verbs have the scores below; give your own verbs theirs with `verbScores` (`{ steal: 0.95 }`), which also overrides. 0 means no follow-up on success.

| Verb | Score |
|------|------:|
| `go_to` | 0.8 |
| `use` | 0.65 |
| `give` / `buy` / `sell` / `pick_up` | 0.6 |
| `drop` | 0.55 |
| `think(about)` | 0.55 |
| `set_goal` / `remember` | 0.45 |
| `think()` | 0.35 |
| `wander` | 0.3 |
| `say` | 0.25 |
| `drop_goal` | 0.2 |
| `wait` / `rest` / `follow` | 0 |

---

## Memory

`MemoryStore`: episodic / semantic / identity. Pinned rows skip eviction and go in the user block. Each think also injects `recallK` (5) unpinned hits not already in the prompt (short-term lines are skipped before the top 5 are taken) scored by cosine (if embeddings exist) plus lexical overlap and tag hits, so speech and `remember()` facts show up without a tool call. Episodic cap `maxEpisodic` (256). Heard speech is copied into a short-term buffer (last 8 lines) and into episodic memory with name tags. Sight names persist as last-seen semantic rows. `remember(content)` writes semantic memory. `intrusion` may inject one extra unbidden row.

---

## Talk

`TalkNet` is name-only. Implement `TalkSense`: `inRange`, `others`, optional `canSee`, `clearHear`, `names`, `face`, `approach`.

Each think, the prompt lists who is in talking range. `say(to)` is only valid for those names. Out of range, the library does not speak; it feeds `sayRangeHint` so the model gets closer first. Out of clear-hear range, text is muffled, and if the listener comes within clear-hear range during the next `rehear` seconds (`TalkConfig`, default 8), the line arrives again in full ("…, now clear"). Heard lines are kept as episodic memory.

---

## Map

`see_map` is a **tool**, not an Arc verb. It is omitted unless **both** are set: a host `map.snapshot` and `vision`. Arg `zoom` is 0..1 (1 close, 0 whole land). The host paints; the library stamps symbols and returns a legend of names only, no coordinates. Default you-mark is `❌`. Never write `see_map(...)` in the arc.

If `toolRoundCap` is 0, no tools are offered, see_map included.

`grep_world_encyclopedia` is the same kind of tool for **types**. Host pages are `{ name, aliases?, text }`, or `crowdEncyclopedia({ name, tag, inside })` which stringifies a bunch of that tag and distills leftover English plus surround-sense (being inside a spoken place). Query leftover English (`trees`, `house`) or a spoken place (`forest`); empty query lists names. Articles are not in the standing prefix. Never write `grep_world_encyclopedia(...)` in the arc.

---

## Perception helpers

- `formatSight(sight: Sight)` writes what character is seeing.
- `crowdEncyclopedia({ name, tag, inside })` stringifies a bunch of `tag` around you and writes the leftover-crowd article.
- `formatInventory(bag)` writes what character is carrying.

> [!NOTE]
> Use `withSight` / `withInventory` rather than calling these functions.


---

## Layout

```
src/
  index.ts           public API
  director/          ArcDirector facade, CharacterSpec, CollectiveSpec, VerbCall
  character/         ArcRunner, Character, Persona, NameBook, watches, sight focus
  mind/              Mind, prompts, name/id translation, TalkNet, map, encyclopedia
  collective/        Collective, its verbs, who, tags, memory handover
  think/             MindQueue: ThinkQueue, SimpleQueue
  expr/              watch language, catalog, stringify
  arc/               verbs, parse, validate, runArc, laws
  world/             HostWorld, routes, moving characters, stock world verbs, watch geometry
  memory/            MemoryStore
  perception/        optional scene English
  inference/         HTTP chat, fake, presets, model catalog
  scripts/           demo + fixtures
  testing/           test fixtures (an open grid world)
```
