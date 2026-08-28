# ArcDirector

Game-agnostic and Engine-agnostic LLM powered NPC agents.

Designed to be used with locally running LLMs.

Covers NPC planning, memory, perception, chat, priority queue, reactivity heuristics, and OpenAI-compatible inference. No renderer, no physics, no coordinate system, no UI. The host supplies a world snapshot (as names and expressions) and functions to understand it and functions to execute NPC actions.

```
pnpm test
pnpm demo      # live model, or ARC_DIRECTOR_MOCK=1
```

---

## Host contract

You own the world. This library owns the mind.

| You provide | The library |
|-------------|-------------|
| `InferenceProvider` (HTTP or fake) | Chat + optional embeddings |
| `VerbRegistry` + `execute(step)` | Parse / validate `ActionPlan`, run built-in verbs |
| `PerceptionRecipe` (pushed text + tools) | Prompt assembly, tool rounds, JSON plan |
| `catalog(ctx)` → `buildCatalog(kernels)` | Watch language, `observe({ expr })` |
| Distances, LOS, hp, inventory (optional kernels) | `isNear`, `approaching`, `isHurt`, … |
| `TalkSense` (range / hear / face) | `TalkNet.say` → `HeardSpeech` events |
| `MapSense` + `vision` (optional) | `see_map({ zoom })` — image + name legend, no coordinates |
| A scheduler (`ThinkQueue` or your own) | Who thinks, scored from watches |

Identity of an agent is `id` (string).

---

## Quick start

```ts
const provider = new OpenAICompatProvider(); // ARC_DIRECTOR_BASE_URL or http://127.0.0.1:1234/v1
const verbs = registerCoreVerbs(new VerbRegistry());

const agent = new Agent({
	id: 'Watcher',
	identity: { name: 'Watcher', role: 'Pays attention to who is nearby.', traits: ['alert'] },
	goals: [{ text: 'Stay aware of others', priority: 1 }],
	provider,
	verbs,
	recipe: {
		push: {
			scene: {
				description: 'What you can see. Names only.',
				gather: (ctx) => ctx.paragraph,
			},
		},
		tools: {},
	},
	context: () => host.ctx(),
	execute: (step, ctx) => host.do(step, ctx),
	catalog: (ctx) => buildCatalog(host.kernels(ctx)),
	pinnedWatches: ['isHurt(me)'],
	heartbeat: 0, // ThinkQueue decides when to call tick
});

const plan = await agent.tick(now); // ActionPlan | null
```

`remember`, `set_goal`, `drop_goal`, and `say` (when `TalkNet` is attached) run inside the agent. Every other verb goes to `execute`.

Without `execute`, `tick` still returns a plan; the host runs it later and calls `ingestResult`.

---

## Agent

`Agent<HostCtx>` is one mind. `tick(gameTime)` may revise goals (strategic) and emit one `ActionPlan` (tactical).

### When tactical runs

| Condition | Effect |
|-----------|--------|
| First `tick` | Always thinks |
| `lastResult.interrupted` | Thinks |
| Pending event with `major: true` | Thinks |
| `heartbeat <= 0` | Thinks if no live plan |
| Else | Thinks if `gameTime - lastTacticalAt >= heartbeat` |

Defaults: `heartbeat` 30, `strategicInterval` 180 (same time unit as `gameTime`; typically seconds). `strategicInterval <= 0` disables the periodic pass. Major pending events still trigger a strategic pass (goals; identity only if who they are actually changed).

Tactical: assemble pushed perception → optional memory intrusion → tools (`recall`, `observe`, `earshot`, `see_map` when the host maps and the model can see, plus recipe tools) up to `toolRoundCap` → JSON `ActionPlan`. The same JSON may include lasting `goals` (or `set_goal`). `identity` / `set_identity` is for a rare, lasting who-you-are change, not orders, weather, or nicknames. A new `name` only applies when `role` also changes. Bad plans retry `planRetryCap` times (default 0). Major pending events also trigger a strategic pass that may revise goals (and identity only if needed), even if `strategicInterval` is 0.

### Options

| | Default | |
|--|---------|--|
| `model` | `ARC_DIRECTOR_MODEL` or first preferred | Chat model id |
| `embedModel` | `ARC_DIRECTOR_EMBED_MODEL` | Optional embeddings |
| `toolRoundCap` | 2 | Tool turns before the plan must appear |
| `planRetryCap` | 0 | Extra turns after a bad plan |
| `maxGoals` | 5 | Trim by priority |
| `intrusionThreshold` / `intrusionCooldown` | 0.55 / 45 | Unbidden memory into the prompt |
| `recallK` | 5 | Default `recall` hit count |
| `hideObserve` | false | Omit the built-in `observe` tool |
| `map` | — | Host snapshots for `see_map`. Omitted unless `vision` is also on |
| `vision` | heuristic | `true` / `false` for image input. `false` never offers `see_map` |
| `watches` / `pinnedWatches` | `[]` | See [Watches](#watches) |
| `watchesWritable` | true | LLM may replace non-pinned watches in the plan JSON |

`pushEvent` queues text for the next think (`major` wakes immediately). `remember(text, tags)` writes episodic memory (embeds when the provider can).

`toJSON` / `fromJSON` round-trip identity, goals, memory, watches, and last plan. `fromJSON` merges host `pinnedWatches` with saved pins (host first, no duplicates).

---

## Think queue

`ThinkQueue` picks who may call `agent.tick`. It does not call the model.

```ts
queue.ensure(id);
queue.setWatches(id, agent.effectiveWatches());
queue.setAiOn(id, true);

const catalogs = new Map([[id, buildCatalog(kernels)]]);
const rows = queue.tick(dt, catalogs, httpInFlight);
for (const row of rows) {
	await agents.get(row.npcID)?.tick(now);
	queue.noteResult(row.npcID, stalled);
}
kernels.cache.commit(); // after sampling; approaching / isHPFalling need a previous frame
```

Each tick: accumulate time → sample watches every `watchInterval` (0.25) → emit rows every `processInterval` (1) → at most `maxParallel - inFlight` minds (default `maxParallel` 2). Reasons: `watch`, `major` (`enqueueMajor`), `heartbeat`.

Watch score: boolean true → `trueScore` (0.51); numbers in 0–1 used as-is; `> 1` clamps to 1 and scolds. Score must exceed `epsilon` (0.05) to enqueue.

Ranking multiplies that score by a recency scale: just after a think it is `trueScore` (0.51); it lerps to 1 by `heartbeatStart / 2` (60s at the default 120). Never-thought minds stay at 1. Hosts that keep a ready list should rank with `queue.rankScore(id, row.score)`.

Heartbeat (per mind): starts at `heartbeatStart` (120), clamped `[heartbeatMin, heartbeatMax]` (30–300). After a think, `noteResult(id, stalled)`: `'auto'` stretches the interval when stalled, shrinks when not; or pass a function / `false`.

`inFlight` should count **HTTP** calls only, so a busy provider does not starve the queue.

---

## Watches

Standing conditions. Evaluated against a `Catalog` built from `HostKernels`. The LLM may emit `"watches": ["expr", ...]` on the plan when `watchesWritable`. **Pinned** watches always evaluate, always appear in the prompt as required, and cannot be removed that way.

`effectiveWatches()` = pins then extra, de-duplicated.

Language looks like JS calls; it is not a JS subset. Bindings: `me`, `others`, `items`, plus host names (`bindings`) and optional `hasHeard`, `prevThought`, `prevActions`.

```
hasHeard || some(others.nearby().approaching())
isHurt(me)
isNear(me, Other, 16)
distance(me, Target)         // wrap in clamp / softClamp for a 0–1 score
i is "marked"                // id, name, or tag
```

| | |
|--|--|
| Relations (two entities) | `distance`, `isNear(a, b)` / `isNear(a, b, r)`, `isApproaching`, `isDeparting`, `hasSightline`, `hasJustSeen`, `hasLostSight`, `facing`, `isFacing` (cos > √2/2), `isBehind` |
| List filters | `others.nearby()`, `.nearby(16)`, `.approaching()`, `.departing()` — also `events.filter("alarm").nearby(16)` |
| Lists | `filter` / `find` / `some` / `all` take a predicate **or** a string needle; `map`, `sortBy`, `count`, `includes`, `first`, `max` / `min` / `maxBy` / `minBy`, `sum`, `avg`, `reduce` |
| Logic | `&&` / `\|\|` on bools are and/or; on numbers, min/max. Gate analog with `*`. Ternary `? :`. `??` coalesces **absent** only (keeps `0` and `false`). `!` / `!!`. Dot on absent does not throw. |
| Host extras | `hp` / `maxHP`, `isHurt`, `isHPFalling`; `isCarrying`; `isOpen` / `hasJustOpened` — only if you plugged the kernel |

Identifiers: leading acronyms are lowercase (`id`, `hp`, `npc`); later in a name they stay caps (`maxHP`, `npcID`).

`observe({ expr })` evaluates once and stringifies (host `stringifierKind` + `stringifiers`). Standing conditions belong in watches, not observe.

Commit `SampleCache` after each watch sample so motion / hp / open deltas see a previous value.

---

## Catalog kernels

`buildCatalog(host)` wires natives from what you pass. Omit a kernel and those functions are absent.

```ts
type HostKernels = {
	me: ExprEntity;
	others: ExprEntity[];
	items: ExprEntity[];
	cache: SampleCache;
	bindings?: Record<string, ExprVal>;
	hostFns?: Record<string, NativeFn>;
	distance?: (a, b) => number | undefined;
	nearRadius?: number;          // enables isNear / nearby
	canSee?: (a, b) => boolean;
	facing?: (a, b) => number;    // cosine; else isFacing?: boolean
	inventory?: (who) => ExprEntity[];
	hp?: (who) => { hp: number; maxHP: number } | undefined;
	isOpen?: (who) => boolean | undefined;
	hasHeard?: boolean;
	prevThought?: { secondsAgo: number };
	prevActions?: { secondsAgo: number; isOk: boolean; reason: string; verb: string }[];
	stringifiers?: Stringifiers;
	stringifierKind?: (entity) => StringifierKind; // default `entity`
};
```

`ExprEntity`: `{ id, name?, tags, fields? }`. Space enters expressions only through host callbacks (`distance`, `facing`, `canSee`).

---

## Actions

```ts
{ head: { verb: 'go_to', args: { name: 'Target' } }, then?: { join, plan } }
```

Joins: `then_if_ok` (`&&`), `then` (`;`), `then_if_err` (`||`). At most four chained steps. `runPlan` executes the chain; `interrupted` stops it.

`VerbRegistry.add(name, args)` — arg kinds `id` / `string` / `number` / `string[]`, optional with `?`.

`registerCoreVerbs` is an optional starter set (`go_to`, `follow`, `wander`, `use`, `equip`, `unequip`, `pick_up`, `drop`, `say`, `wait`, `remember`, `set_goal`, `drop_goal`, `set_identity`). Use it or register your own.

`ActionResult`: `{ ok, interrupted?, reason?, verb? }`. Feed it back with `ingestResult` if you ran the plan outside `tick`. Hosts that execute the plan themselves must call `agent.perform(step)` for `remember`, `set_goal`, `drop_goal`, and `set_identity` — those are not world verbs.

---

## Memory

`MemoryStore`: episodic / semantic / identity. Pinned rows skip eviction and go in the system prompt. Episodic cap `maxEpisodic` (256) drops oldest unpinned.

Heard speech (and other non-`action_result` events) is also copied into a **short-term** buffer shown every think: last 8 lines, older ones folded into an `Earlier:` summary. That buffer survives after the one-shot event inbox is drained, so an NPC asked "what did I just say?" still knows. `recall` returns those recent lines first, then scored episodic hits.

`recall` scores cosine × recency + tag hits. `intrusion` may inject one emotional or tag-matching row into the user block (`[unbidden: …]`).

---

## Talk

`TalkNet` is name-only. You implement `TalkSense`: `inRange`, `others`, optional `canSee`, `clearHear`, `names`, `face`, `approach`.

Each think, the prompt lists who is in talking range. `say(to)` is only valid for those names. `canSay(speaker, to)` is the same check without speaking. The `earshot` tool lists names, or `earshot({ to })` returns an error if that name is out of range (no speech).

If the model still emits a `say` plan whose audience is out of range, the library **does not speak**. It feeds the miss back on the same thread (`sayRangeHint`) so the model can `go_to` them and continue. A `go_to` then `say` chain is allowed — only the **head** step is preflighted. Broadcast with nobody nearby also fails closed (`no one in earshot`).

`say(speakerID, text, to?)` delivers `HeardSpeech` events when `canSay` is ok. Out of clear-hear range, text is muffled and listeners are told to `go_to` the speaker. A muffled eavesdrop is not major unless the line names them (`names`, their id, or a short role title). After a successful say, TalkNet may ask the host to face and approach (default on).

Names that are not agents can still be addressed if `inRange` is true.

---

## Map

`see_map({ zoom })` is omitted unless **both** are set: a host `map.snapshot` and `vision` (or a catalog/id that `isVisionModel` accepts). Do not advertise a see_map that comes back text-only.

`zoom` is 0..1: **1** is close around the agent, **0** is the whole loaded land, values in between crop between those. The host paints the picture and supplies marks (`symbol`, `description`, world `x`/`y`). The library stamps unique pictograms and returns a legend `⭐ = you, 🎚️ = MillLever, 🏠 = Cottage` — names only, no coordinates. The tool result is that JSON; a follow-up user message carries the image parts.

If `toolRoundCap` is 0, an enabled see_map still gets **one** tool round (and only the `see_map` tool is advertised). Raise the cap to mix see_map with `recall` / `earshot` / recipe tools.

Plans stay `go_to(MillLever)`. Never put numbers in the legend or the prompt.

---

## Perception helpers

Optional English scene dump for a pusher — not required to use `Agent`.

`describeScene(input)` takes tagged objects with host `describe` callbacks, LOD layers, and relationship stringifiers; it returns prose with quantized distances. Host `distance(a, b)` is the metric; optional `bearing(obj)` fills `DescribeCtx` with relative words (default `away`). Optional `pluralize` labels tag crowds. Default is `basicPluralize` (`city`→`cities`, `city's`→`cities'`, `cactus`→`cacti`, `bus`→`buses`, else append `s`). Hosts import it and wrap irregulars: `pluralize: (w) => w === 'sheep' ? 'sheep' : basicPluralize(w)`. Built-ins: `builtinLodLayers`, `attachmentStringifier`, `proximityPairStringifier`, `tagCrowdStringifier`.

The dump is names and relations. The host owns where things sit.

---

## Inference

`InferenceProvider`: `chat(req)` and optional `embed(texts, model?)`.

| | |
|--|--|
| `OpenAICompatProvider` | `/v1/chat/completions` (+ embeddings). Default base `ARC_DIRECTOR_BASE_URL` or `OLLAMA_HOST` or `http://127.0.0.1:1234/v1`. |
| `withQueue(provider, n)` | Cap in-flight HTTP. |
| `FakeProvider` | Tests; `goToNamedInteractable()` is a canned planner. |
| `fetchModelCatalog` / `pickSingleChatModel` | Prefer an already-loaded chat model. |

Env (all optional): `ARC_DIRECTOR_BASE_URL`, `ARC_DIRECTOR_API_KEY` / `OPENAI_API_KEY`, `ARC_DIRECTOR_MODEL`, `ARC_DIRECTOR_EMBED_MODEL`, `ARC_DIRECTOR_ENABLE_THINKING`, `ARC_DIRECTOR_REASONING_EFFORT`, `ARC_DIRECTOR_THINKING_BUDGET`. Thinking/CoT is off unless you enable it — a thinking budget on every tick is expensive.

---

## Layout

```
src/
  index.ts           public API
  agent/             Agent, prompts, TalkNet, runPlan
  think/             ThinkQueue
  expr/              watch language, catalog, stringify
  action/            verbs, parse, validate
  memory/            MemoryStore
  perception/        optional scene English
  inference/         OpenAI HTTP, fake, model catalog
  scripts/           demo + fixtures
```
