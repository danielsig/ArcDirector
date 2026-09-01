# ArcDirector

A multi-agent runtime for LLM-powered characters: planning, memory, perception, talk, a priority think queue, and local HTTP inference. The host supplies the world. This package has no renderer, physics, coordinates, or UI.

```
pnpm test
pnpm demo      # live model, or ARC_DIRECTOR_MOCK=1
```

## Getting started

1. `new ArcDirector()` starts empty.
2. Chain `with…` (one subsystem) and `add…` (lists). Order does not matter.
3. `await start()` is the only assemble step (wires agents, probes the model,
   checks kit names).
4. `tick(dt, now)` each game frame. Do not call it while AI is paused.

```ts
const director = await new ArcDirector<HostCtx>()
	.withLMStudioInference()
	.addStockVerbs()
	.withDefaultKit({ verbs: STOCK_VERBS })
	.onVerb(host.do)
	.addSense('scene', {
		description: 'What you can see. Names only.',
		gather: (ctx) => ctx.paragraph,
	})
	.withContext((id) => host.ctx(id))
	.addAgent({
		id: 'Watcher',
		identity: {
			name: 'Watcher',
			role: 'Pays attention.',
			traits: ['alert'],
		},
	})
	.start();

director.tick(dt, now);
```

`start()` returns `Promise<this>`. Every other chain method returns `this`. After a successful `start()`, `with*` throws `Error('ArcDirector already started')`. Lists stay open: `addAgent` / `removeAgent`, `addStockVerbs` / `addVerb` / `removeVerbs`, `addSense` / `addTool` / `removeSense` / `removeTool`. A failed start (no model, unknown kit name) may be retried; success then `start()` again is a no-op.

`start({ ignoreMissing: true })` logs unknown names via `onLog` instead of throwing.

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

Inference opts: `baseURL`, `model`, `apiKey`, `enableThinking`, `reasoningEffort`, `thinkingBudget`, `batchThinks`, `batchWait`. If you omit `apiKey`, `ARC_DIRECTOR_API_KEY` or `OPENAI_API_KEY` is used. Thinking/CoT is off unless `enableThinking` is true. A `thinkingBudget` caps CoT tokens when thinking is on. Preferred chat model is Muse Glimmer (speculative decode). Native LM Studio load reuses a matching instance and unloads extra copies of it. Parallel thinkers are a queue cap, not load copies. If the preferred model is not already loaded, every other loaded instance is unloaded first so it has VRAM; a failed load unloads any remaining residents and retries. `batchThinks` / `batchWait` are scheduling (same as the queue); the queue's values win if both are set.

### Mind queue

Who thinks next. Default is priority (watch / verb scores + recency).

| | |
|--|--|
| `withPriorityQueue(opts?)` | Highest score first |
| `withSimpleQueue(opts?)` | FIFO |
| `withQueue(instance)` | Your `MindQueue` |

`tick(dt, now)` is **sync**. Sample catalogs, `queue.tick`, buffer ready minds. `batchThinks` (default true) holds new starts while any think is in flight — a new prompt's prefill stalls decode of the rest — then starts up to `maxParallel` together when idle, or after `batchWait` seconds (default 20, same clock as `now`). Set `batchThinks: false` to fill a free slot immediately. HTTP and `enact` continue across frames. `dt` / `now` are **game time**.

`mayThink` (on queue opts): idle / live plan / major / watch score. If a live plan exists and think is allowed, the director calls `onAbortPlan(id)` and skips that mind this frame (host motor interrupt).

Standalone `withPriorityQueue()` spread helpers remain for `new Agent({...})` tests. They are not the documented path.

### Verbs

| | |
|--|--|
| `addStockVerbs(...verbs)` | Schema only. No args = all stock verbs. Pass names to opt in to a subset: `addStockVerbs(...STOCK_MOVE_VERBS)` is `go_to` / `follow` / `wander`; `STOCK_ITEM_VERBS` is `use` / `equip` / `unequip` / `pick_up` / `drop` / `give` / `examine`; `STOCK_MIND_VERBS` is `say` / `wait` / `remember` / `think` / `set_goal` / `drop_goal` / `set_identity`. Same name again is skipped. |
| `addVerb(name, args, handler?)` | Schema + optional world function. Same name again binds/replaces the handler. |
| `removeVerbs(...names)` | Drop catalog schemas and named handlers. Missing names are skipped. Empty rest is a no-op. |
| `withDefaultKit(kit)` | Object or `(ctx) => kit` used when `addAgent` omits `kit`. Same fetch-every-tick rules. |
| `onVerb(fn)` | Catch-all. Typical: `addStockVerbs().onVerb(host.do)` |
| `withVerbs(registry)` | Replace the whole registry |

The catalog is shared (`addStockVerbs` / `addVerb` / `removeVerbs`). What a mind may use is its **kit**, fetched every tick: a plain object (mutate it, or use getters) or `(ctx) => kit`. Registering a verb does not grant it. `withDefaultKit` is the common grant; per-agent `kit` overrides it. Fetching every tick is cheap; **changing** the grant is not, because the verb list is in the system prefix ([Prompt prefix](#prompt-prefix)).

```ts
type Kit = { verbs?: string[]; senses?: string[]; tools?: string[] };

director.withDefaultKit({ verbs: STOCK_VERBS });
director.addAgent({ id: 'Holt' }); // default kit
director.addAgent({ id: 'Baker', kit: vendorKit }); // same object; mutate later
director.addAgent({ id: 'Cook', kit: (ctx) => kitFor(ctx) }); // callback
```

`verbs` omitted or `[]` = none. `senses` / `tools` omitted = all registered senses / tools; `[]` = none. `start()` throws if a kit names a verb, sense, or tool that is not registered (`recall` / `observe` always; `earshot` with talk; `see_map` with map and vision).

**Senses** are English always in the user block (`scene`, inventory, events). **Tools** are on-demand (`recall`, `observe`, `see_map`). Kit `senses` / `tools` lists are allowlists over what you registered, not extra gatherers.

Prompt, JSON schema, and parse use the kit. A step whose verb is not available fails closed. `agent.verbs` is the catalog; `agent.activeVerbs()` is this tick. Assign `agent.kit` when the grant actually changes, not every frame.

Handlers receive a **`VerbCall`**: `{ verb, args, agent, ctx }`. The full plan is on `agent.lastPlan` / `agent.planIndex`, not on the call. Per-verb handlers ignore `verb`; `addVerb('give', { item: 'id', to: 'id' }, host.give)` already bound the name.

Mind-internal verbs never hit the host: `remember`, `think`, `set_goal`, `drop_goal`, `set_identity`, and `say` when TalkNet is attached.

### Perception

Senses every think in the user block; tools on demand. `addSense` / `addTool` replace the same name and stay open after `start()`.

| | |
|--|--|
| `withSight(look)` | Stock sense `sight`. callback returns a `Sight` of `SeenObject[]` (`at` vectors). |
| `withInventory(look)` | Stock sense `carrying`. callback returns an `Inventory` bag. |
| `withLineOfSight((aID, bID) => boolean)` | One occlusion callback for sight, talk `canSee`, and watch `hasSightline`. |
| `addSense(name, spec)` | Host-only sense. `spec` is `{ description, gather }`. |
| `addTool(name, spec)` | `spec` is `{ description, parameters, handler }`. |
| `removeSense(...names)` | Missing names are skipped. Empty rest is a no-op. |
| `removeTool(...names)` | Same. |

`Sight.self.id` is the name. Noun is `id`. Omit `withLineOfSight` and every body in `look()` is seen. Omit `addTool` and the host adds no tools. Built-in `recall` / `observe` / `see_map` still appear when those subsystems are on.

### Context and kernels

The library knows minds by **id**. It does not know your `World`.

- **`withContext((id) => ctx)`:** find this mind’s body. Perception `gather(ctx)` and verb handlers use it.
- **`withKernels((ctx) => kernels)`:** measurements for watches (`isHurt(me)`, `others.nearby()`). The library always `buildCatalog`. Director owns each agent’s `SampleCache` (overwrites `cache`; you do not commit it). It also overwrites `hasHeard` / `prevThought` / `prevActions` from that mind, and `canSee` when `withLineOfSight` is set.

Verbs need objects. Watches need measurements. Same `ctx`, two jobs.

### Talk and map

- **`withTalk(sense, onSpoke?, config?)`:** range and routing. Library routes `say()`. Line of sight is `withLineOfSight`.
- **`withMap(sense)`:** host paints `see_map` pictures; library stamps a name legend (no coordinates). Omitted unless vision is on.

### Agents

`addAgent(spec: AgentSpec)` before or after `start()`. `removeAgent(id)` drops a live mind.

```ts
type AgentSpec = {
	id: string;
	identity: { name: string; role: string; traits?: string[] };
	goals?: Goal[];
	memories?: MemoryDraft[];
	watches?: WatchInput;
	pinnedWatches?: WatchInput;
	watchesWritable?: boolean;
	skipHeartbeat?: boolean;
	skipMajor?: boolean;
	rank?: number; // tie-break after watch score
	kit?: Kit | ((ctx) => Kit); // fetched every tick; omit = withDefaultKit
};
```

`director.agent(id)`, `director.agents()`, `exportAgents` / `restoreAgents`, `pushEvent`.

Identity is who they are. Do not rewrite name, role, or traits to recap a mood, an order, or this think. That belongs in goals and events ([Prompt prefix](#prompt-prefix)).

### Prompt prefix

Each think is two messages. The **system** message is identity, standing instructions, and the kit’s verb list (plus a `see_map` hint when vision is on). The **user** message is everything that is supposed to change: scene, carrying, events, goals, pinned memory, watches, last action.

Local servers (LM Studio, llama.cpp, Ollama) keep a **KV cache**: the attention state for a run of tokens. If the next request starts with the same tokens as a recent one, they reuse that state and skip the work. Reuse only holds while the tokens match from the start. The first token that differs, they recompute from there through the end, including the long user block you meant to be cheap. One early edit costs a full prompt reload.

Keep the system side still across thinks:

- **Identity:** lasting who. A new role is a life change, not “I am angry” or “Player told me to wait.” The model is already told not to rewrite identity to recap a moment; the host should not either.
- **Kit:** lasting grant. Returning the same kit every tick is fine. Flipping verbs, senses, or tools every tick (gag for one line, vendor only while the player looks, unconscious = empty kit) busts the prefix for that mind. A gag or a stall that lasts a scene is one change, then leave it. Unconscious should skip the think (`mayThink`), not rewrite the kit for a frame.
- **Vision / `see_map` / you-mark:** leave them on or off for the session. The library already keeps tools listed (`tool_choice: none`) on plan turns so follow-ups *inside* a think share a prefix.

`addVerb` / `removeVerbs` rewrite the shared verb catalog. `addTool` / `removeTool` change the tool list on the request. Same cost as changing the kit if those lists are in the prefix.

---

## Full example

```ts
const director = await new ArcDirector<HostCtx>()
	.withQueue(new MyMindQueue())
	.withInference(myProvider)
	.addStockVerbs()
	.addVerb('give', { item: 'id', to: 'id' }, host.give)
	.addVerb('steal', { item: 'id', from: 'id' }, host.steal)
	.withDefaultKit({ verbs: [...STOCK_VERBS, 'steal'] })
	.onVerb(({ verb }) => ({ ok: false, verb, reason: `unhandled ${verb}` }))
	.withSight((ctx) => host.look(ctx))
	.withInventory((ctx) => host.inventory(ctx))
	.withLineOfSight((a, b) => host.canSee(a, b))
	.withKernels((ctx) => host.kernels(ctx))
	.withTalk(host.talkSense)
	.withMap(host.mapSense)
	.withContext((id) => host.ctx(id))
	.onAbortPlan((id) => host.interrupt(id))
	.onLog((entry) => hud.push(entry))
	.addAgent({
		id: 'Captain',
		identity,
		goals,
		pinnedWatches: { hurt: 'isHurt(me)' },
	})
	.start();
```

---

## Agent (low-level)

`new Agent({...})` is for unit tests and advanced hosts. Getting started does not use it.

`Agent<HostCtx>` is one mind. `tick(gameTime)` may revise goals (strategic) and emit one `ActionPlan` (tactical). If `execute` is set, `tick` walks the plan unless `autoEnact` is false. `enact` needs `execute`. `planIndex` is the 0-based step currently running inside `enact`.

### When tactical runs

| Condition | Effect |
|-----------|--------|
| First `tick` | Always thinks |
| `lastResult.interrupted` | Thinks |
| Pending event with `major: true` | Thinks |
| `heartbeat <= 0` | Thinks (the queue already picked this mind) |
| Else | Thinks if `gameTime - lastTacticalAt >= heartbeat` |

Defaults: `heartbeat` 30, `strategicInterval` 180. `strategicInterval <= 0` disables the periodic pass.

Tactical: assemble senses → optional memory intrusion → tools (`recall`, `observe`, `earshot`, `see_map` when the host maps and the model can see, plus host tools) up to `toolRoundCap` → JSON `ActionPlan`. System vs user split is under [Prompt prefix](#prompt-prefix).

### Options

| | Default | |
|--|---------|--|
| `model` | first preferred | Chat model id |
| `embedModel` | none | Optional embeddings |
| `toolRoundCap` | 2 | Tool turns before the plan must appear |
| `planRetryCap` | 0 | Extra turns after a bad plan |
| `maxGoals` | 5 | Trim by priority |
| `intrusionThreshold` / `intrusionCooldown` | 0.55 / 45 | Unbidden memory into the prompt |
| `recallK` | 5 | Default `recall` hit count |
| `hideObserve` | false | Omit the built-in `observe` tool |
| `map` | none | Host snapshots for `see_map` |
| `vision` | heuristic | `true` / `false` for image input |
| `watches` / `pinnedWatches` | `{}` | Name → expr dicts |
| `watchesWritable` | true | LLM may add / edit / remove extra watches |

`pushEvent` queues text for the next think (`major` wakes immediately). `remember(text, tags)` writes episodic memory. `toJSON` / `fromJSON` round-trip identity, goals, memory, watches, and last plan.

---

## Think queue (details)

Each tick: accumulate time → sample watches every `watchInterval` (0.25) → emit rows every `processInterval` (1) → buffer ready minds. With `batchThinks` (default true) the director starts a wave of up to `maxParallel` (default 2) only when `inFlight` is 0, or after `batchWait` seconds (default 20) if someone is still generating. `batchThinks: false` fills a free slot as soon as one opens. Set these on `withPriorityQueue` or `withHttpInference` (queue wins if both set). Walking a plan does not count as in flight. Reasons: `watch`, `major`, `action`, `heartbeat`.

`mayThink` is optional. Omit it and a live plan blocks a new think. The callback gets `npcID`, `reason`, `score`, `rankedScore`, the live `plan` (or `null`), and `verbs` on that plan.

Watch score: boolean true → `trueScore` (0.51); numbers in 0–1 used as-is; `> 1` clamps to 1 and scolds. Score must exceed `epsilon` (0.05) to enqueue.

Priority ranking multiplies that score by a recency scale: just after a think it is `trueScore` (0.51); it lerps to 1 by `heartbeatStart / 2` (1.5s at the default 3). Never-thought minds stay at 1.

Heartbeat (per mind): a low-priority (0.001) pulse every `heartbeatStart` (3s), clamped `[heartbeatMin, heartbeatMax]` (3–300). Interval is fixed unless you set `heartbeatAdjust: 'auto'` (stretch on stall, shrink otherwise) or a callback.

---

## Watches

Standing conditions against a `Catalog` from `HostKernels`. Dict: short **name** → **expr**.

**Pinned** watches (`pinnedWatches`) are host-authored. The LLM cannot add over, edit, or remove them. Extra watches live in `watches`. When `watchesWritable`, the plan JSON may include `addWatches` / `editWatches` / `removeWatches`, or replace extras with `"watches": { … }`.

Language looks like JS calls; it is not a JS subset. Bindings: `me`, `others`, `items`, plus host names (`bindings`). `hasHeard`, `prevThought`, and `prevActions` come from the mind when you go through `ArcDirector` (unabsorbed `HeardSpeech`, last think, last `ActionResult`). Pass them yourself only to standalone `buildCatalog`.

```
hasHeard || some(others.nearby().approaching())
isHurt(me)
isNear(me, Other, 16)
distance(me, Target)
i is "marked"
```

| | |
|--|--|
| Relations | `distance`, `isNear`, `isApproaching`, `isDeparting`, `hasSightline`, `hasJustSeen`, `hasLostSight`, `facing`, `isFacing`, `isBehind` |
| List filters | `others.nearby()`, `.nearby(16)`, `.approaching()`, `.departing()` |
| Lists | `filter` / `find` / `some` / `all`, `map`, `sortBy`, `count`, `includes`, `first`, `max` / `min`, `sum`, `avg`, `reduce` |
| Logic | `&&` / `\|\|`, `*`, ternary, `??` (absent only), `!` / `!!` |
| Host extras | `hp` / `maxHP`, `isHurt`, `isHPFalling`; `isCarrying`; `isOpen` / `hasJustOpened` |

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
	distance?: (a, b) => number | undefined;
	nearRadius?: number;
	canSee?: (a, b) => boolean;   // director overwrites when withLineOfSight
	facing?: (a, b) => number;
	inventory?: (who) => ExprEntity[];
	hp?: (who) => { hp: number; maxHP: number } | undefined;
	isOpen?: (who) => boolean | undefined;
	hasHeard?: boolean;           // director injects
	prevThought?: { secondsAgo: number }; // director injects
	prevActions?: {               // director injects
		secondsAgo: number;
		isOk: boolean;
		reason: string;
		verb: string;
	}[];
	stringifiers?: Stringifiers;
	stringifierKind?: (entity) => StringifierKind;
};
```

Space enters expressions only through host callbacks (`distance`, `facing`, `canSee`).

---

## Plans

```ts
{ head: { verb: 'go_to', args: { name: 'Target' } }, then?: { join, plan } }
```

Joins: `then_if_ok` (`&&`), `then` (`;`), `then_if_err` (`||`). At most four steps. `think()` is always moved to the end. `wait(seconds?, for?)` parks; `for` is a one-shot watch.

`ActionResult`: `{ ok, interrupted?, reason?, verb? }`.

### Follow-up think

After a plan, `enqueuePlan` uses the **highest** score among steps **after** the last `wait(for)`. Failure is at least 0.3. Override with `actionScores`. 0 means no follow-up on success.

| Verb | Score |
|------|------:|
| `steal` | 0.95 |
| `go_to` | 0.8 |
| `use` | 0.65 |
| `give` / `buy` / `sell` / `pick_up` | 0.6 |
| `drop` | 0.55 |
| `think(about)` | 0.55 |
| `equip` / `unequip` | 0.5 |
| `set_goal` / `remember` | 0.45 |
| `think()` | 0.35 |
| `wander` | 0.3 |
| `say` | 0.25 |
| `drop_goal` | 0.2 |
| `wait` / `rest` / `follow` | 0 |

---

## Memory

`MemoryStore`: episodic / semantic / identity. Pinned rows skip eviction and go in the user block. Each think also injects `recallK` (5) unpinned hits scored by cosine (if embeddings exist) plus lexical overlap and tag hits, so speech and `remember()` facts show up without a tool call. Episodic cap `maxEpisodic` (256). Heard speech is copied into a short-term buffer (last 8 lines) and into episodic memory with name tags. Sight names persist as last-seen semantic rows. `remember(content)` writes semantic memory. `intrusion` may inject one extra unbidden row.

---

## Talk

`TalkNet` is name-only. Implement `TalkSense`: `inRange`, `others`, optional `canSee`, `clearHear`, `names`, `face`, `approach`.

Each think, the prompt lists who is in talking range. `say(to)` is only valid for those names. Out of range, the library does not speak; it feeds `sayRangeHint` so the model can `go_to` them. Out of clear-hear range, text is muffled.

---

## Map

`see_map({ zoom })` is omitted unless **both** are set: a host `map.snapshot` and `vision`. `zoom` is 0..1 (1 close, 0 whole land). The host paints; the library stamps symbols and returns a legend of names only, no coordinates. Default you-mark is `❌`.

If `toolRoundCap` is 0, an enabled see_map still gets **one** tool round.

---

## Perception helpers

- `formatSight(sight: Sight)` writes what character is seeing.
- `formatInventory(bag)` writes what character is carrying.

> [!NOTE]
> Use `withSight` / `withInventory` rather than calling these functions.


---

## Layout

```
src/
  index.ts           public API
  director/          ArcDirector facade, AgentSpec, VerbCall
  agent/             Agent, prompts, TalkNet, runPlan
  think/             MindQueue: ThinkQueue, SimpleQueue
  expr/              watch language, catalog, stringify
  action/            verbs, parse, validate
  memory/            MemoryStore
  perception/        optional scene English
  inference/         HTTP chat, fake, presets, model catalog
  scripts/           demo + fixtures
```
