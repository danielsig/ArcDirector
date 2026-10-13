# ArcDirector

**NPCs that think, plan, and act in your browser game, powered by local LLMs.**

You bring the world: a Three.js scene, a Babylon level, an ECS, or a grid of tiles. ArcDirector brings the cast. Characters look around, remember what happened, talk to each other and to the player, form goals, and then *do things*: walk across the map, pick things up, hand them over, haggle at a stall, fight as a squad. You write no behavior trees and no dialogue scripts.

## How it works

### The NPC Loop

1. **Perception:** ArcDirector puts your game scene into words for the local LLM.
2. **Planning:** The LLM responds with an `Arc`, a program for one or more NPCs to follow.
3. **Action:** ArcDirector runs the `Arc` to control NPCs in your game.

### Features

- **Arcs:** NPCs can be scripted by LLMs on the fly with complex programs.
- **Conditions:** `Arc`s support conditional behavior and loops.
- **Expressions:** LLMs can write powerful expressions to detect specific conditions.
- **Personality:** NPCs behave according to their backstory, role, traits, goals, and memories.
- **Perception:** Stringifiers compact your game world into a single paragraph for the LLM.
- **Map:** LLMs can look at a map of the game world (if vision capable).
- **Inventory:** LLMs can view the inventory of the character.
- **Knowledge:** LLMs can recall what the game tells them about the world, alongside their own memories.
- **Memory:** Long term memories form on the fly and can be recalled later.
- **Recovery:** The LLM recovers from failures by correcting its `Arc`s.
- **Feedback:** Relevant knowledge and memories are automatically injected based on context.
- **Watches:** NPCs can use Expressions as conditions that trigger thinking.
- **Laws:** NPCs can use `Laws` to react instantly to specific conditions.
- **Verbs:** `Arc`s are composed of `Verb`s that are executed in sequence.
- **Kit:** NPCs can be assigned a "Kit", a set of senses, verbs, and tools they can use.
- **Stock Verbs:** Each game has its own verbs but ArcDirector has these built in:
  - Movement: `go_to`, `follow`, `flee`, `wander` (uses built-in A* pathfinding)
  - Item: `use`, `pick_up`, `drop`, `give`, `examine`.
  - Mind: `say`, `wait`, `remember`, `think`, `set_goal`, `drop_goal`, `set_identity`, `watch`, `unwatch`, `focus`, `unfocus`.
  - Arc: `law`, `unlaw`, `when`, `loop`.
  - System One: `choose` (see below).
  - Trade: `offer` (both buying and selling uses this verb).
  - Collective: `issue`, `tag`, `untag`, `spread`, `circle`, `hold_line`.
- System One
  - Works with the `choose` verb to make decisions.
  - Jev or any local System One model can be used to make ~50ms decisions.
  - LLMs can be used as System One fallbacks at ~100-200ms per decision.
  - LLMs can program NPCs to be controlled by System One models.

## Example `Arc`

NPC tasked with fetching water from the "Well" using a "Bucket" and giving it to "Mira".

```arc
go_to("Bucket") &&
pick_up("Bucket") &&
go_to("Well") &&
use("Bucket", "Well") &&
go_to("House") &&
go_to("Mira") &&
say("Here's your water, Mira.", to="Mira")
```

This then gets executed by the NPC in your game.
If there's an issue, an error, or the NPC gets stuck, it will find a way to get the job done.

## Why ArcDirector

**It runs on the player's GPU** via LM Studio, Ollama, or any OpenAI-compatible endpoint. Small local models are a design goal: names are used instead of coordinates, a forgiving `Arc` parser, syntax errors are repaired by the LLM, and prompts are laid out so the KV cache survives between calls. There are no per-token bills and no cloud dependency unless that's your preference.

**It fits any engine.** No renderer, no physics, no UI. A position is just a number array (`[x]`, `[x, z]` or `[x, y, z]`), and it never reaches the LLM. A handful of optional callbacks can be used to make ArcDirector fully aware of your game world and how to navigate it and interact with it.

**Your game keeps the rules.** Every verb ends in your code. Refuse one with a reason ("Mira will not take less than 5 gold for bread") and the NPC adapts its next `Arc` accordingly. An NPCs's kit caps what each NPC can do, and the LLM cannot overwrite memories, nor watches (conditions that trigger thinking) nor laws (conditions that trigger `Arc`s) that you've marked as pinned.

**It's cheap to run.** The LLM is only called when an NPC has something to decide. Watches and laws are evaluated locally every tick, and System One makes split-second picks. When several NPCs need the LLM at once, a priority queue serves the most urgent first and batches the rest to keep a single GPU busy. Multiple NPCs can be controlled by a single LLM as well (see Collectives below).

- **Talk:** hearing range, muffled speech, line of sight, and waiting for an answer. NPCs overhear each other without being woken by it.
- **Names per observer:** An NPC with the ID "Bob" can appear to another NPC as `MerchantWithBlueHat` until Bob introduces himself. Game code only ever sees real ids, but NPCs wouldn't be very realistic if they magically knew everyone's names.
- **Collectives:** one LLM commands a squad or a whole market crowd, issues orders by tag, and moves NPCs in formations. NPCs can join, leave and change sides, and their memories are updated to match.
- **Save / load:** `exportCast()` / `restoreCast()` saves every NPC's memories, goals, names and laws.
- **Full visibility:** `onLog` shows every prompt, tool call, reply and System One pick, so you can see why your blacksmith thought it could make a wooden spoon out of steel.

## Who it's for

**Vibe-coding a Three.js game and want AI NPCs in it?** Chain a few `with…` calls, point it at LM Studio, call `director.tick(dt, now)` in your render loop, and your scene has a living cast. The stock verbs work as soon as you connect the world.

**Building a real game that ships in the browser?** It is strict TypeScript with zero rendering dependencies. Every piece can be replaced: queue, inference, verbs, senses, tools, prompt lines, memory handover. You get typed verb handlers, saves that round-trip the whole cast, and fail-closed validation at `start()`. Most of the expensive design work is done for you: prompt-prefix stability, per-model parallelism, abort semantics, and unreachable-target reasoning.

> ArcDirector is experimental and not yet released. The API still changes freely; see the example host in `game/` for a full integration.

## Getting started

Five words to know:

|              |                                                                   |
| ------------ | ----------------------------------------------------------------- |
| `Verb`       | An action characters can perform, e.g. `go_to`, `say`, `pick_up`. |
| `Arc`        | A short program of `Verb`s issued to characters by a `Mind`.      |
| `Mind`       | The module that generates `Arc`s.                                 |
| `Character`  | A single NPC controlled by a single `Mind`.                       |
| `Collective` | Several NPCs controlled by a single `Mind`.                       |

1. `new ArcDirector()` starts empty.
2. Chain `with…` (one subsystem) and `add…` (lists). Order does not matter.
3. `await start()` is the only assemble step (wires characters and their minds,
  probes the model, checks kit names).
4. `tick(dt, now)` each game frame. Do not call it while AI is paused.

```ts
const director = await new ArcDirector<CharacterCtx>()
	.addLMStudioInference()
	.addStockVerbs()
	.withDefaultKit({ verbs: STOCK_VERBS })
	// Provide callbacks that unlock the stock verbs and sight
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
	.withSight({ limit: 16 })
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

A `Persona` is who someone is and what they know: identity, goals, memories, names for others, watches and sight focus. A character or a collective has one; its mind only reads and writes it, so dropping or swapping a mind loses nothing. `Character` and `Collective` both extend `ArcRunner`, the arc-running base.

A character with `mind` settings thinks; one without (e.g. Player) is driven by the host: it runs laws and kit verbs through the same handlers, never calls the model, and never has the mind-only verbs (`MIND_ONLY_VERBS`: think, remember, goals, identity, watches, focus). Drive it with `director.character(id).enact(parseArc(text, character.activeVerbs()))`.

Scripts with no frame loop may use `runLoop(hz)` (returns a stop function). Games must not; they already have a tick.

---

## Subsystems

Each `with*` sets or replaces one slot. Omit the ones you do not need. The happy path omits `.withPriorityQueue()` (priority is the default). Stock verbs are opt-in via `addStockVerbs()`.

### Inference

How chat happens. A director talks to any number of chat **servers** and any number of **models** on them, each by name; a mind thinks with the model its settings name (`mind: { model: 'qwen' }`), else the default. `start()` rejects if a mind has no model (`onLog` can print it). Every `add*` / `remove*` function on ArcDirector works before and after `start()`.

|                                             |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `addLMStudioInference(opts?)`               | Server `lmstudio` (or `name`). Default `http://127.0.0.1:1234/v1`, flash-attn load. Pass `baseURL: '/inference/v1'` when a page proxies LM Studio                                                                                                                                                                                                                                                                                                                                |
| `addOllamaInference(opts?)`                 | Server `ollama` (or `name`). Default `http://127.0.0.1:11434/v1`                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `addHttpInference(opts)`                    | Server `http` (or `name`): any OpenAI-compat base URL                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `addFakeInference(chat?, { name? })`        | Server `fake` for tests; its model id is `fake`. Default canned `go_to` of a PascalCase name                                                                                                                                                                                                                                                                                                                                                                                     |
| `addInference(name, provider, { vision? })` | Your own `chat` / `embed`, or your own System One `pick` (below)                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `removeInference(name)`                     | Drops server `name`, chat or System One, and every model on it. Runners assigned a System One that went have none until it is added again                                                                                                                                                                                                                                                                                                                                        |
| `addModel(name, spec?)`                     | A model: `{ inference?, id?, decision?, contextLength?, thinking?, reasoningEffort?, maxParallel? }`. `decision` makes it System One `name` instead (below). `inference` defaults to the first server; `id` to that server's pick (LM Studio: the loaded chat model `modelGrade` ranks highest); `maxParallel` (default 2) caps thinks on this model alone. The same name again replaces it. With no model added, `start()` adds the first server's pick, named after the server |
| `removeModel(name)`                         | Minds assigned it think with the default                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `setDefaultModel(name)`                     | The model of every mind without an assignment. Default: the first added                                                                                                                                                                                                                                                                                                                                                                                                          |
| `modelID(name?)`                            | The server's id for that model, or the default's; `''` until its server answered                                                                                                                                                                                                                                                                                                                                                                                                 |
| `withEmbeddings({ inference?, id })`        | The one model every memory and recall query is embedded with, so memories stay comparable whatever a mind thinks with. Without it, recall matches text                                                                                                                                                                                                                                                                                                                           |
| `withArcFormat(format)`                     | How minds write an Arc: `'text'` (`go_to(Keep) && wait()`, read forgivingly), `'json'` (the default: `{"steps":[…]}`) or `'schema'` (that JSON, but the server must follow a fixed reply schema; a think goes to `/v1/chat/completions` and its tools are replies, `{"tool":"recall","query":"Bread"}`, not native calls). Collectives follow it. Live: `setArcFormat(format)`, `arcFormat`                                                                                      |


**System One** models are fast models that pick one of a `choose`'s arcs by name; they never write arcs. The director holds them by name, a spec's `systemOne` assigns one, and a runner without an assignment uses the default. A runner left with none never sees `choose`.


|                                                                     |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `addJevInference(opts?)`                                            | TypeSafe's Jev, named `jev` unless `name` says otherwise. Posts `{ state, model, questions: { pick: { type: 'choice', … } } }` to `baseURL` (default `/systemone`, a page proxy that adds the key; the library never reads it). `model` default `jev-latest`; `headers` for a host with no proxy. Any System One endpoint works, LM Studio's `/v1/systemone` too; a `baseURL` ending in `/decisions` is asked in OpenAI's Decisions format                                                                                                                                            |
| `addModel(name, { decision: true, inference?, id?, maxParallel? })` | A local System One. A decision model (LM Studio's `decision` type, e.g. `ggml-org/Laya-GGUF`) answers through its server's `/v1/systemone`; any other model is a chat model that scores the choices. They go out as lettered options, the answer is one token with reasoning off, and the declared letter it scores highest wins (its log probabilities; the letter it answered where a server returns none). Omit `id` for the server's chat pick, which is loaded already: give it the chat model's `contextLength` too, so the two never reload it. It is never the minds' default |
| `benchSystemOne(systemOne, cases?)`                                 | How well a System One decides: `DECISION_BENCH` (tactics, survival, social, puzzle) by default, each case in both choice orders, so a model that favors a slot scores half. Right answers per skill, mean ms per pick, and failures                                                                                                                                                                                                                                                                                                                                                   |
| `addInference(name, systemOne)` | Your own `pick` |
| `setDefaultSystemOne(name)`| The System One to use when a runner has none |


Every `add*` works before or after `start()`; the same name again replaces it.

When a runner's own System One fails or names no choice, every other System One is asked in the order added, then the runner's chat model; one that failed is skipped for 30 s. Every pick goes to `onLog` under the character's id: goal, state, choices, the answer and who gave it, time, and every miss. A cast of only standing-`choose` characters (no minds, no collectives) starts with `addJevInference()` alone; anything else needs chat inference too.

Do not wrap HTTP in a second in-flight queue. The mind queue’s `inFlight` is the cap. `.onLog` wraps chat once (timings + content) so the host does not wrap `chat`.

Live: `infer` (timings). Change a model's settings by adding it again under the same name; a mind never changes them.

Server opts: `baseURL`, `apiKey`, `enableThinking`, `reasoningEffort`, `load` (the last three are defaults a model's own settings override). If you omit `apiKey`, `ARC_DIRECTOR_API_KEY` or `OPENAI_API_KEY` is used. Thinking/CoT is off unless `enableThinking` is true. When it is off, the last message is an assistant prefill that skips the reasoning channel: an empty `<redacted_thinking>` block, or the model's Harmony `to=user` header when `applyPromptTemplate` is set (same method as LM Studio's imageVision plugin). A schema request skips that prefill: llama.cpp feeds the assistant message to the JSON grammar, and `<` empties the stack. The effort goes as `reasoning_effort` on chat completions (`off` is `"none"`, the only value that turns Gemma's reasoning off there) and as `reasoning: { effort }` on the responses API, and only when `/api/v1/models` lists that option for the model (`low` when thinking is on and allowed; `on`/`off` for binary models; omitted when the catalog has no reasoning config). A context overflow retries with the effort at `"none"` and a 512-token answer. A `schema` request (see `withArcFormat`) is LM Studio / llama.cpp specific: its grammar uses a root `anyOf`, `$ref` recursion and optional properties, none of which is OpenAI-strict; its schema is not counted as prompt when the answer is capped to the slot, and the logs show it by name. A model's first request loads it (LM Studio), with its own `contextLength`; a loaded copy that no longer fits its settings is reloaded. Native LM Studio load reuses a matching instance and unloads extra copies of it. Parallel thinkers are a per-model cap, not load copies. Models configured on one server stay loaded together; anything else loaded is unloaded to make VRAM room, and a failed load unloads any remaining residents and retries. `onLog` gets the outbound JSON **before** each model call (message bodies in fences below it; images as images, not base64), then the reply.

### Mind queue

Who thinks next. Default is priority (watch / verb scores + recency).


|                            |                     |
| -------------------------- | ------------------- |
| `withPriorityQueue(opts?)` | Highest score first |
| `withSimpleQueue(opts?)`   | FIFO                |
| `withQueue(instance)`      | Your `MindQueue`    |


`tick(dt, now)` is **sync**. Sample catalogs, `queue.tick`, buffer ready minds. `batchThinks` (default true) holds new starts on a model while any think on it is in flight — a new prompt's prefill stalls decode of the rest — then starts up to that model's `maxParallel` together when it is idle, or after `batchWait` seconds (default 20, same clock as `now`). Set `batchThinks: false` to fill a free slot immediately. HTTP and `enact` continue across frames. `dt` / `now` are **game time**.

`mayThink` (on queue opts): idle / live arc / major / watch score. If a live arc exists and think is allowed, the director stops that character (`abortArc(id)`: its moves and waits, then `onAbortArc`) and skips that mind this frame.

In-flight chat is occupancy of a mind-id slot. `mind.abortThink()`, `director.abortThink(id)`, and `queue.abortThink(id)` trip that slot's `AbortSignal`. Removing a character or collective, dropping a mind (a join, `character.mind = …`), `setAiOn(false)`, `drop`, and vacating a commander abort as a side effect. A completed reply is discarded if the slot was aborted before enact.

### Verbs


|                                             |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `addStockVerbs(...verbs)`                   | Registers stock verbs; the library runs them (world verbs through `withWorld`). No args = all of them. Pass names to opt in to a subset: `addStockVerbs(...STOCK_MOVE_VERBS)` is `go_to` / `follow` / `flee` / `wander` (`flee(from, distance?)` takes the cheapest route out of range that keeps wide of them, and ends once `distance` away for 3 s; it defaults to the kernels' `nearRadius`, what `nearby()` counts, and fails asking how far when there is none); `STOCK_ITEM_VERBS` is `use` / `pick_up` / `drop` / `give` / `examine`; `STOCK_MIND_VERBS` is `say` / `wait` / `remember` / `think` / `set_goal` / `drop_goal` / `set_identity` / `watch` / `unwatch` / `focus` / `unfocus`; `STOCK_ARC_VERBS` is `law` / `unlaw` / `when` / `loop`; `choose` (`CHOOSE_VERB`) comes last in `STOCK_VERBS`, withheld from any character or collective without a System One; `STOCK_TRADE_VERBS` is `offer`, registered with the rest but kept out of `STOCK_VERBS` so a kit grants them only where there is trade. Same name again is skipped. |
| `addStockCollectiveVerbs(...verbs)`         | Schema only for `issue` / `tag` / `untag` / `spread` / `circle` / `hold_line`. Registering does not grant; the collective's kit does.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `addVerb(name, { args?, help?, handler? })` | Schema + optional world function. The handler's `args` are typed from `args` (`{ item: 'id', offer: 'number?' }` gives `{ item: string; offer?: number }`); a stock verb's are typed from its stock args. `help` is one line shown after the verb in the prompt's verb list (`shoot(target) — needs a clear line of sight`); stock verbs carry theirs the same way. Same name again binds/replaces the handler; a host handler replaces a stock one.                                                                                                                                                                                                                                                                                                                                                |
| `removeVerbs(...names)`                     | Drop catalog schemas and named handlers. Missing names are skipped. Empty rest is a no-op.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `withDefaultKit(kit)`                       | Object or `(ctx) => kit` used when a character or collective spec omits `kit`, a collective's characters too. Same fetch-every-tick rules.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `withVerbGate(fn)`                          | Runs before every host verb with the full `VerbCall`. Return a result to refuse the step (a cutscene, a won fight); `undefined` lets it run.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `onVerb(fn)`                                | Catch-all for verbs with no handler of their own.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `withVerbs(registry)`                       | Replace the whole registry                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |


The catalog is shared (`addStockVerbs` / `addVerb` / `removeVerbs`). What a character or collective may use is its **kit**, fetched every tick: a plain object (mutate it, or use getters) or `(ctx) => kit`. Registering a verb does not grant it. `withDefaultKit` is the common grant; a spec's `kit` overrides it. Fetching every tick is cheap; **changing** the grant is not, because the verb list is in the system prefix ([Prompt prefix](#prompt-prefix)).

```ts
type Kit = { verbs?: string[]; senses?: string[]; tools?: string[] };

director.withDefaultKit({ verbs: STOCK_VERBS });
director.addCharacter({ id: 'Holt', mind: {} }); // default kit
director.addCharacter({ id: 'Baker', mind: {}, kit: vendorKit }); // same object; mutate later
director.addCharacter({ id: 'Cook', mind: {}, kit: (ctx) => kitFor(ctx) }); // callback
```

Every character and collective needs a kit, its own or the default one, and a fixed kit must name some `verbs`; `start()` throws otherwise. A collective's kit is what its mind may write; each of its characters runs steps with its own kit, and the roster tells the mind what one cannot do. `senses` / `tools` omitted = all registered senses / tools; `[]` = none. `start()` also throws if a kit grants a stock world verb whose `withWorld` part is missing (and no host handler or `onVerb` covers it), or names a verb, sense, or tool that is not registered (`recall` / `observe` always; `earshot` with talk; `see_map` with map and vision).

**Senses** are English always in the user block (`scene`, inventory, events). **Tools** are on-demand (`recall`, `observe`, `see_map`). Kit `senses` / `tools` lists are allowlists over what you registered, not extra gatherers.

Prompt, JSON schema, and parse use the kit of the mind's owner. A step whose verb is not available fails closed. `character.verbs` is the catalog; `character.activeVerbs()` is this tick. Assign `character.kit` when the grant actually changes, not every frame.

Handlers receive a `VerbCall`: `{ verb, args, character, ctx, score, holds, goTo, goToPoint, wait }`. `character` runs the step; `ctx` is `withContext(character.id)`, and a step whose character has no context fails with `not in this scene` before any handler runs. A collective with no commander has no body: its mind is offered only its own verbs and `wait`, which runs on the director's clock; and any other host verb fails with `you are not a character in this scene; issue <verb> to one of your characters`. Its tools and articles look from its first character in the scene, and it gets no earshot (it never speaks). A formation lines up `character.squad`: the characters last issued a program together, this one among them. The arc running now is `character.arc` / `character.verbIndex`; the mind's last arc is `mind.lastArc`.

The library does the mind's half of every verb, so handlers only move the world:

- `id` **args are real ids.** The model may write its own name for a character (see Names) or an expression that picks one (`cleave(others.filter("enemy").minBy(u => u.hp))`); the mind turns names into ids as it reads the reply, and an expression becomes the id it picks. An expression that picks no one fails with that reason before the handler runs. Plain names the library does not know pass through for the host to judge (`no such place Cottag`).
- `watch` **args are checked, then asked.** Bad syntax or leftover English (`filter("trees")`) fails before the host runs. `call.holds('until')` says whether the watch holds now; `call.score('until', point)` asks how well it would fit if this character stood at `point` (how `wander` picks where to go).
- **Moving and waiting are the library's.** `call.goTo(target, within?)` moves this character into reach of `target`, following it as it moves; `call.goToPoint(at, within?)` moves it to a point; `call.wait(seconds)` lets game time pass. All three end, interrupted, when the step is aborted. A host verb that needs to be somewhere first (`steal`, `heal`) awaits one of them and keeps only its own rules.
- **Mind-internal verbs never reach the host:** `remember`, `think`, `set_goal`, `drop_goal`, `set_identity`, `watch`, `unwatch`, `focus`, `unfocus`, `say` when TalkNet is attached, and `wait`: game time passes until `seconds` (default 1, or 20 with `until`) or until the `until` watch holds. An aborted arc ends the wait. Bind your own `wait` handler only if waiting must do something in your world.

Arg kinds are `id`, `string`, `text`, `watch`, `expr`, `law`, `number`, `string[]`, `bundle`, `bundle[]`, `arc` (add `?` for optional). `bundle` is `{ [item: string]: number }`. `expr` is any other expression (`issue(who=units.filter("Archer"))`) and `law` a law's name; a mind keeps every `id`, `watch`, `expr`, `law` and `arc` arg in ids. `text` is prose: unquoted, it runs to the closing `)` or to the next `, key=` of that verb, so commas and apostrophes need no quotes (`say(Hello there, BridgeKeeper's friend, to=Player)`). Use it for any arg a model fills with a sentence.

### Perception

Senses every think in the user block; tools on demand. `addSense` / `addTool` replace the same name and stay open after `start()`.


|                                          |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `withSight({ look, limit, unitName })`   | Stock sense `sight`. `look` returns a `Sight` of `SeenObject[]` (`point` vectors). `limit` is the default max **irreducible sight clauses** after `sightFocus` order. A spec's `sightLimit` overrides. `unitName` is the leftover distance unit (`m`, `pace`, `foot`); omit for `pace`. Omit `look` to set only the cap; omit `limit` for no cap.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `withInventory(look)`                    | Stock sense `carrying`. callback returns an `Inventory` bag. The list ends by saying nothing else is carried, so a role that often has something does not imply it has it now.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `withKnowledge(pages, { mentions? })` | What minds know of the world: `recall` searches these articles beside memory and returns `{ remember, know }` (at most 2 articles, `KNOW_CAP`), so a mind knows the world the way it remembers it. `pages` is `{ name, aliases?, text }[]` or `(ctx) => pages`. Articles also come to a mind unasked: a name or alias said or heard lately brings its article under short-term memory (at most `mentions` per think, default 2, 0 for none; not again for 5 thinks). Mark things a character carries with `item: true`: their mention also says whether this mind carries one ("FireMushroom (you carry none)"), every time, so a claim in talk sits next to the truth for speaker and listener, and a name in a failed verb's reason brings its article under that result. `crowdKnowledge({ name, tag, inside })` builds a leftover-crowd article from `formatSight` (a bunch around you). Query leftover English (`trees`, `house`) or a spoken place (`forest`) for the Capitalized type. Empty query lists the topics known. Articles stay out of the standing prefix. |
| `addSense(name, spec)`                   | Host-only sense. `spec` is `{ description, gather }`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `addTool(name, spec)`                    | `spec` is `{ description, parameters, handler }`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `removeSense(...names)`                  | Missing names are skipped. Empty rest is a no-op.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `removeTool(...names)`                   | Same.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |


`Sight.self.id` is the name. Noun is `id`. Omit `hasLineOfSight` and everything in `look()` is seen. Omit `addTool` and the host adds no tools. Built-in `recall` / `observe` / `see_map` still appear when those subsystems are on.

### Context and kernels

The library knows characters and collectives by **id**; a mind goes by its owner's. It does not know your `World`.

- `withContext((id) => ctx)`**:** the context a character acts in: `TCtx`, whatever the game wants it to hold. Perception `gather(ctx)`, kernels, kits, and verb handlers get it. A mind senses through its voice's context. Generic parameters follow one rule: they start with `T` (`TCtx`, `TEntity`, `TArgs`), so a slot the host fills never reads like a library type.
- `withKernels((ctx, point?) => kernels)`**:** what a mind knows for watches (`me`, `others`, `items`, `isHurt(me)`, `inventory`). When `point` is set, a verb is asking what if this character stood there: answer as if it did (who it would see from there). The library always `buildCatalog`. Director owns each character's `SampleCache` (overwrites `cache`; you do not commit it). It also overwrites `hasHeard` / `prev` from that mind, `canSee` when `hasLineOfSight` is set, and all geometry (`distance`, `nearby`, `isFacing`, `isLeft`, `pathDistance`, `manhattan`, …) from `withWorld` poses and routes, so kernels never measure space.

Verbs need objects. Watches need measurements. Same `ctx`, two jobs.

### World

`withWorld<TEntity>(world)` is the game's world as the stock verbs need it. `TEntity` is the game's own type for things in its world (a GameObject, an ECS entity, a record); the library never looks inside one. `find(id)` **is the only place an id becomes an entity**, and every other part receives entities, so the game never looks anything up twice. When `find` returns `undefined`, the verb fails with "no such …" or "… is gone" before any other part is called. Items stay ids (`item`, and `examine`'s target): which Bread is meant depends on whose pack it is in, and that is the game's call.

**Queries** (`find`, `get…`, `hasLineOfSight`, `canOffer`, `up`) only read the world and may be called any time, often. **Commands** (`steerToward`, `moveItem`, `useItem`, `exchange`) change it. Each part unlocks verbs:


| Part                                                        | Kind           | Unlocks                                                                                                                               |
| ----------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `find(id)`, `getPose(entity)`                               | query          | watch geometry: `distance`, `nearby`, `isFacing`, `isLeft` / `isRight`, `manhattan`, …                                                |
| `getPathGraph(character)`, `steerToward(character, point)`  | query, command | `go_to`, `follow`, `flee`, `wander`, the collective formations (`spread`, `circle`, `hold_line`), `pathDistance` / `isReachable`, `call.goTo` |
| `getDescription(character, target)`                         | query          | `examine`                                                                                                                             |
| `hasLineOfSight(from, to)`                                  | query          | sight, talk `canSee`, and watch `hasSightline`. Omit it and nothing blocks sight                                                     |
| `moveItem({ character, item, to?, quantity? })`             | command        | `pick_up`, `drop`, `give`                                                                                                             |
| `useItem(character, item, target?)`                         | command        | `use`                                                                                                                                 |
| `exchange({ character, other, give, get })`                 | command        | `offer`                                                                                                                               |


- **Positions and directions are number arrays**, in world space and in whatever dimension the game uses: `[x]`, `[x, z]`, `[x, y, z]`. A position is always called `point`; a direction is named for where it points (`facing`, `right`, `up`) and is a unit vector. `getPose` returns `{ point, facing?, right? }`, so left and right mean what the game means. A 3D game can set `up` (default `[0, 1, 0]`) for formations.
- **Earshot is not reach.** Someone can be in talking range and still unreachable (across a river, on the phone). The earshot sense marks them with the same blockers a failed move names: `Angler (unreachable, blocked on the way: Bridge is raised)`. A failed move remembers whom it could not reach (`ArcResult.unreachable`); an arc that opens with the same verb toward them is refused in the same think while the way is still blocked, and goes through once it opens. A think whose reply never became a valid arc, even after repairs, ends nothing that would wake the mind again, so it thinks again with `think failed — your reply was not a valid Arc: …` as its last result.
- **Routes are the library's.** `getPathGraph(character)` is called once per search and returns the neighbors of any position: as many `{ point, cost?, blocked? }` steps as there are. Grid cells, navmesh polygons, a weighted waypoint network, or a line: the library runs A* over whatever it gets. The position asked about need not be a node: a route starts where the character stands and arrives through the steps out of the destination (taken backwards), so a network returns the waypoints in sight of an arbitrary position. Characters differ (a child fits a gap a knight does not), so the graph is per character. `cost` defaults to the step's length and must not be less; raise it to route around crowds or rough roads. A `blocked` step ("EastDoor is locked — you carry IronKey") is avoided. With no open way, the move fails naming every blocker that leads there, cheapest first, so a mind facing two locked doors learns about both and can pick the one it holds the key to. Say in the reason what this character could do about it.
- **The library moves characters; the game animates them.** While a character moves, `steerToward(character, point)` is called every tick with the position of the next waypoint (never a direction), or `null` to stand, and returns whether the character is at `point` by the motor's own measure. Speed, collisions, animation, and how close counts as there stay in the game, so the library needs no notion of units. A character that makes no progress gets a new route, then fails with `stuck`. Without `getPathGraph` / `steerToward`, characters do not move: `call.goTo` succeeds only when already in reach.
- `getReach(character, target)` is how close a character must be to act on `target` and to count as there (default 1). A building can return its half-width, so arriving inside counts.
- **Trades are offers; nothing moves until one is taken.** `offer(to?, give?, get?)` names what this character hands over and what it wants back, each a bundle (`{"gold":5}` or `{"Egg":12, "Milk":3}`). When `to` already offers that or better (an offer made to this character, else a standing one), the character walks until both are within each other's reach (`getReach`, default 1) and it may make an offer to them (`canOffer`), and `exchange` swaps both sides at the maker's terms. Otherwise the offer waits, and the major event wakes `to`'s mind with the reverse offer that accepts it; other terms counter. A new offer to the same character replaces the last one, and both sides empty withdraws it. Without `to` it is a standing offer to anyone, taken in any whole multiple while stock lasts (`Loaf` for `5 gold` sells three for 15); a new one of the same goods reprices it. Seed standing offers with a character spec's `offers`, or `director.offers.post(...)`. `director.offers` (`OfferBook`) is saved with `exportCast`.
- **Who may make an offer** to whom is `canOffer(character, other)`. Without it: `other` in `character`'s sight (`withSight`), else in its line of sight (`hasLineOfSight`), else always. An offer to someone stands only while that holds. Every mind whose kit grants `offer` sees, in every prompt, each standing offer and each offer by or to a character it thinks for, under Open offers.
- **World rules stay in the game.** `moveItem`, `useItem`, and `exchange` change the world and return `{ ok, reason? }`. Refuse with a reason the mind can act on ("Chest is locked", "Mira will not go below 5 gold") and announce what happened with `pushEvent`, as the game does when the player acts. The library moves into reach first, and checks nothing the game knows better.
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

- `withTalk(sense, onSpoke?, config?)`**:** range and routing, per character. Library routes `say()`. A mind hears through every character it thinks for: a collective through each of its characters, once per line, from whichever heard it best. That includes its characters talking to each other; only its own voice's lines are not heard back. A line said to, or naming, any of its characters is meant for it and wakes it, whichever character heard it; only a line to its voice reads `says to you`. A collective never speaks for itself; its commander does, or it issues `say` to one of its characters. Line of sight is `hasLineOfSight`. When an arc's `reply` verb names another character (`say` with `to`, `give`, `offer`), the actor waits up to 20 s at the end of the arc if that character is still nearby. The wait ends when they finish a non-movement verb. A step that names no one, such as `say` without `to`, does not wait, and the rest of the arc still runs first. The say result names who it was for but could not make out the words (`heard by Baker; too far for Guard to make out the words: get closer`), and earshot marks them `too far to make out your words`. A `say` whose content words (stemmed) mostly repeat a line everyone it is for already heard clearly is refused before anyone hears it: "they already heard you say that". `hasHeard` is true only for speech meant for this mind.
- `withMap(sense)`**:** host paints `see_map` pictures and marks characters, things and places by `id`; library stamps a legend in the mind's own names (no coordinates). Omitted unless vision is on.
- `withKnowledge(pages)`**:** host type docs; minds `recall(query)` them beside memory instead of stuffing every type into the standing prefix.



### Characters

`addCharacter(spec: CharacterSpec)` before or after `start()`. `removeCharacter(id)` removes a character for good, on its own or from its collective. Ids are one namespace across characters and collectives; a duplicate throws.

```ts
type CharacterSpec = {
	id: string;
	mind?: MindSettings; // give it a mind of its own; omit for a character the host drives
	choose?: { goal: string; until?: string; [choice: string]: string }; // act by System One instead of a mind
	systemOne?: string | null; // a System One by its director name instead of the default; null for none
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
	skipStart?: boolean; // no think when it joins; it waits for something to happen
	rank?: number; // tie-break after watch score
	heartbeat?: number;
	strategicInterval?: number;
	model?: string; // the configured model it thinks with, by its addModel name; omit for the default
	conversationCap?: number; // letters of Current Conversation, whole messages only; omit for one quarter of the model's context (4 letters per token); 0 shows none
};
```

A spec's `systemOne` (characters and collectives alike) names the System One that picks for it instead of the default; a collective's also picks for every character in it, so `issue(who, loop(choose(...)))` asks the party's own model. `null` means none there. A name the director never added throws when the spec is wired. The kit must still grant `choose`.

A character with `choose` and no mind keeps picking, by System One, among its choices. Each key but `goal` and `until` names a choice; its value is that choice's arc. `until` is a watch that stops the picking while it holds. It runs whenever the character is idle, rests its `cooldown` after a failed pick, and idles while System One is off. In a collective it is the character's own program whenever its commander has issued it nothing, so units fight or work well with no think at all. Bad arcs or watches throw at `start()`; `choose` beside `mind` throws.

```ts
director.addCharacter({
	id: 'Guard',
	choose: {
		goal: 'hold the gate',
		until: 'isHurt(me)',
		hold: 'go_to(EastGate) && wait()',
		slash: 'slash(Raider)',
		stand: 'wait()',
	},
});
```

The verb is the same thing inside a mind's arc: `choose("hold the gate", hold=go_to(EastGate) && wait(), slash(Raider))`. A bare arc is named after its verb and first word (`slash_Raider`); `loop(choose(...), until=watch)` keeps choosing.

The System One reads each choice as whom it is about now, under the runner's names for them: `shoot(others.filter("enemy").minBy(u => u.hp))` reads `shoot(EnemyWitch)`, beside the runner's own hp and each target's hp, distance and side. Among the choices' targets the lowest hp and the nearest are marked (`EnemyWitch 2/12 hp (lowest), 8 away, ahead`), so a small model that matches words instead of comparing numbers still picks right: write goals with those words ("finish the lowest hp", "hit the nearest"). A choice whose first target expression picks no one is left out, and a lone choice left is taken without asking. Write choices that only exist when they make sense (`finish=slash(others.filter(u => u is "enemy" && distance(me, u) < 3).minBy(u => u.hp))`) rather than asking a small model to judge reach.

`withMindDefaults(settings)` sets what every new mind starts from; a spec's `mind` wins. `director.character(id)`, `characters()`, `collective(id)`, `collectives()`, `minds()`, `exportCast()` / `restoreCast(cast)`, `pushEvent` (each mind once). `restoreCast` before `start()` keeps the save and builds the cast from it as `start()` wires everything.

The character's `id` is its name. A mind introduces itself by its owner's id (`You are Fern.`). `role` is an optional plain tag (`Herbalist`) that hosts can also accept as an address. Backstory goes in pinned `memories`. `set_identity(role?, traits?)` never renames. Identity is who they are. Do not rewrite role or traits to recap a mood, an order, or this think. That belongs in goals and events ([Prompt prefix](#prompt-prefix)).

A host may also build a mind itself and hand it over: `character.mind = new Mind({ rank: 2 })`. The director wires the model and the queue when it attaches.

### Collectives

Characters sharing one mind. `addCollective(spec)` takes the collective's own kit, laws and persona fields, its mind's settings, its `characters`, and an optional `commander`. The mind's arcs run on the commander, the collective's voice; without one the collective (a hive) runs them itself, seeing through all its characters at once (its `me` is a dummy at their average pose, with no carrying).

```ts
const director = await new ArcDirector<CharacterCtx>()
	.addLMStudioInference()
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

`issue(who, arc)` **is instantaneous.** It assigns sticky programs and returns `ok` without waiting for characters to move, talk, or finish. Join several `issue` with `;` (`"then":"always"` in JSON) so later ones still run. `&&` `;` `||` *inside* `arc=` sequence that character. `&&` after an `issue` means orders assigned, not characters finished. To wait on them from the thinker: `wait(until=...)` over the roster.

`who=` is an expr on `units` (the roster less the commander; `allUnits` is everyone), not `others`. Issue by tag. A character's spec tags travel with it; a tag the mind adds with `tag` is stored ``${collective.id}:${short}`` and dropped when the character leaves. Exprs and prompts use the short name. Formations (`spread` / `circle` / `hold_line`) are steps like any other, anywhere in a character's arc: each character of the squad it was issued with works out the same slots and walks to its own, and the step ends when it gets there. They need them in each character's kit. Inner `me` in `arc=` / law `watch=` is that character. Each character runs what it is issued with its own kit; the roster tells the mind which of the collective's verbs it cannot run.

**Laws.** `law` / `unlaw` are standing emergencies (no LLM) that preempt when `watch` holds. The prompt lists them as sentences (`- flee (for units.filter("Shopper")): when isHurt(me), run go_to(Keep)`), not arcs, so small models do not copy them back. A collective's own laws reach its characters by `who`. A character's own laws live on its collective as `Tom.flee`: the prefix is the filter, so they take no `who` and reach only Tom. Each group holds at most `maxLaws`, and the collective's own laws outrank its characters'. Law names hold no `.`; ids may, since the prefix ends at the last one. A `law(...)` step run by a character who is not the commander writes its own `Tom.` law. Running laws and `when`s are tracked by the law or step itself, so renaming one never restarts it.

**Moving characters.** Characters change collectives through two setters; the arc a character is running keeps running across all of them.


|                               |                                                                                                                                                                                                                                   |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `character.collective = c`    | Moves it straight into `c` from any other collective. Its own mind goes (its settings are kept), its laws move in as `Tom.*`, the old collective's tags and commander post are dropped.                                           |
| `character.collective = null` | Leaves. It thinks with a fresh mind from its kept settings, or the host drives it if it never had any. Its laws lose their prefix; laws that need a collective (`units`, `allUnits`) are dropped, and its new mind is told which. |
| `character.mind = m`          | Its own mind from now on, out of any collective. A collective's mind means joining that collective. `null` hands it to the host and forgets its settings. Another character's mind throws.                                        |


The collectives involved hear "Tom joined" / "Tom left", and a character that left is told what it is still doing for the collective it left. `removeCollective(id)` moves every character out first, so each ends up on its own. `onCommanderVacant((collective, character) => …)` fires when a commander leaves or is removed; name a successor with `collective.commander = …`.

**Memory handover.** After a move, one model call fixes the memories of everyone involved: what went stale in a collective left, and what a character or the collective it joined should now remember. Moves within `ticks` director ticks share one call (a character moving twice is one journey, first `from` to last `to`), and characters without an identity are skipped. The call takes the next free think slot, never stops a think, and nothing waits for it; pinned memories are never touched. It is on by default: `withMemoryHandover({ ticks?, handover? })` widens the window or swaps in your own `Handover = (journeys) => Promise<MemoryEdit[]>`, and `handover: false` turns it off.

### Prompt prefix

Each think is two messages. The **system** message is identity, standing instructions, and the kit’s verb list (plus a `see_map` hint when vision is on). The **user** message is everything that is supposed to change: scene, carrying, events, goals, pinned memory, watches, last verb.

Local servers (LM Studio, llama.cpp, Ollama) keep a **KV cache**: the attention state for a run of tokens. If the next request starts with the same tokens as a recent one, they reuse that state and skip the work. Reuse only holds while the tokens match from the start. The first token that differs, they recompute from there through the end, including the long user block you meant to be cheap. One early edit costs a full prompt reload.

The standing lines are yours to replace:


|                                          |                                                                                                                                                                                                                                                              |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `withThinkInstructions({ on?, off? })`   | The think line, by reasoning state. The prompt follows the mind's model's `thinking`. `on` defaults to "Think in 5 sentences, then emit the arc."; `off` defaults to nothing, since the prompt already asks for the Arc alone.                               |
| `withVerbInstructions(text)`             | The verb-chain line. For a collective the default also asks for looping programs; this replaces both. A host's standing doctrine goes here.                                                                                                                  |
| `withArcExample(arc)`                    | The Example that closes the prompt, written as Arc text; the JSON formats show it as Arc JSON. Small models copy it, so make it valid and paren-balanced.                                                                                                    |
| `withRepair({ retries?, temperature? })` | Repair turns after a bad arc (default 0) and the temperature from the second repair on (default 0.4; the first stays at 0). Repair turns never reason: the conversation they carry already ran long. A failed think is short-term memory only, never a fact. |
| `withToolRounds(n)`                      | Tool rounds a think may spend before it must emit the Arc (default 6, `DEFAULT_TOOL_ROUNDS`; small models need several lookups in a row). `0` offers no tools. The same tool with the same arguments twice in one think is refused, not rerun.               |
| `withStalled(fn)`                        | Whether a finished arc stalled, which stretches that mind's heartbeat (default: failed or interrupted).                                                                                                                                                      |


Tool hints (`see_map`, `recall` for knowledge, `observe`) appear only on thinks where that tool is actually offered.

Keep the system side still across thinks:

- **Identity:** lasting who. A new role is a life change, not “I am angry” or “Player told me to wait.” The model is already told not to rewrite identity to recap a moment; the host should not either.
- **Kit:** lasting grant. Returning the same kit every tick is fine. Flipping verbs, senses, or tools every tick (gag for one line, vendor only while the player looks, unconscious = empty kit) busts the prefix for that mind. A gag or a stall that lasts a scene is one change, then leave it. Unconscious should skip the think (`mayThink`), not rewrite the kit for a frame.
- **Vision /** `see_map` **/ you-mark:** leave them on or off for the session. The library already keeps tools listed (`tool_choice: none`) on arc turns so follow-ups *inside* a think share a prefix.

`addVerb` / `removeVerbs` rewrite the shared verb catalog. `addTool` / `removeTool` change the tool list on the request. Same cost as changing the kit if those lists are in the prefix.

---



## Full example

```ts
const director = await new ArcDirector<CharacterCtx>()
	.withQueue(new MyMindQueue())
	.addInference('mine', myProvider)
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
	.withDefaultKit({ verbs: [...STOCK_VERBS, 'offer', 'steal'] })
	.withSight({ look: (ctx) => host.look(ctx) })
	.withInventory((ctx) => host.inventory(ctx))
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

`Mind<TCtx>` writes arcs for its owner, a character or a collective. `tick(gameTime)` may revise goals (strategic) and emit one `Arc` (tactical), which its voice enacts when that voice has an executor and `autoEnact` is on. `thinkNow({ about?, enact? })` thinks once now. A strategic pass revises goals first, in the form the mind writes: Arc text (`set_goal`, `drop_goal`, `set_identity`, or nothing) under `text`, JSON `{"goals":[…],"identity"?:{…}}` under `json`, and the same under a fixed `goals` schema under `schema`. The voice's `verbIndex` is the 0-based step currently running inside `enact`.

### When tactical runs


| Condition                        | Effect                                                    |
| -------------------------------- | --------------------------------------------------------- |
| First `tick`                     | Always thinks                                             |
| `lastResult.interrupted`         | Thinks                                                    |
| Pending event with `major: true` | Thinks                                                    |
| `heartbeat <= 0`                 | Thinks (the queue already picked this mind)               |
| Else                             | Thinks if `gameTime - lastTacticalTimestamp >= heartbeat` |


Defaults: `heartbeat` 0 under a director (its queue paces thinks; 30 in `soloCharacter`), `strategicInterval` 180. `strategicInterval <= 0` disables the periodic pass.

Tactical: assemble senses → optional memory intrusion → tools (`recall`, `observe`, `earshot`, `see_map` when the host maps and the model can see, plus host tools; `recall` also searches knowledge when `withKnowledge` is set) up to `toolRoundCap` → `Arc` (`{"steps":[…]}` JSON, or `go_to() && wait()` text under `arcFormat: 'text'`; under `schema` a tool is called in the reply itself). System vs user split is under [Prompt prefix](#prompt-prefix).

### Options


|                                            | Default                |                                                             |
| ------------------------------------------ | ---------------------- | ----------------------------------------------------------- |
| `model`                                    | the director's default | The configured model it thinks with, by its `addModel` name |
| `toolRoundCap`                             | 6                      | Tool turns before the arc must appear; 0 offers no tools    |
| `arcRetryCap`                              | 0                      | Extra turns after a bad arc                                 |
| `intrusionThreshold` / `intrusionCooldown` | 0.55 / 45              | Unbidden memory into the prompt                             |
| `recallK`                                  | 5                      | Default `recall` hit count                                  |
| `hideObserve`                              | false                  | Omit the built-in `observe` tool                            |
| `map`                                      | none                   | Host snapshots for `see_map`                                |
| `knowledge`                                | none                   | Host type articles `recall` searches beside memory          |
| `vision`                                   | heuristic              | `true` / `false` for image input                            |


`maxGoals` (default 5), watches, sight focus and their writable flags live on the `Persona`.

`pushEvent` queues text for the next think (`major` wakes immediately; speech is major only when it is to the listener, names them, or is said to everyone and heard clearly, so talk between others is overheard without waking anyone; `remember` also files it as an episodic memory; `timestamp` defaults to now). `remember(text, tags)` writes a memory into the owner's persona. `toJSON` / `Mind.fromJSON` round-trip the mind's settings and thinking state; the persona is saved with its owner.

---



## Think queue (details)

Each tick: accumulate time → sample watches every `watchInterval` (0.25) → emit rows every `processInterval` (1) → buffer ready minds. With `batchThinks` (default true) the director starts, per model, a wave of up to its `maxParallel` (default 2) only when nothing is generating on it, or after `batchWait` seconds (default 20). `batchThinks: false` fills a free slot as soon as one opens. Set `batchThinks` / `batchWait` on `withPriorityQueue`; `maxParallel` on `addModel`. Walking an arc does not count as in flight. Reasons: `start`, `watch`, `major`, `verb`, `heartbeat`.

Every mind thinks once when it joins (`start`, score 0.5, below a major event), heartbeat or not, so a character that only wakes on events still acts from the first second. `skipStart` turns that off for one that should only react, like a guard who waits to be approached; `withMindDefaults({ skipStart: true })` turns it off for all. Its laws do not wait for that opening think: until a mind has finished one, its voice's laws start as soon as they hold.

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


|              |                                                                                                                                                             |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Relations    | `distance`, `isNear`, `isReachable`, `isApproaching`, `isDeparting`, `hasSightline`, `hasJustSeen`, `hasLostSight`, `facing`, `isFacing`, `isBehind`        |
| List filters | `others.nearby()`, `.nearby(16)`, `others.reachable()`, `.approaching()`, `.departing()`                                                                    |
| Lists        | `filter` / `find` / `some` / `all`, `map`, `sortBy`, `count`, `includes`, `first`, `max` / `min`, `sum`, `avg`, `reduce`                                    |
| Logic        | `&&` / `||`, `*`, ternary, `??` (absent only), `!` / `!!`                                                                                                   |
| Host extras  | `hp` / `maxHP`, `isHurt`, `isHPFalling`; `isCarrying` / `wasCarrying` / `hasJustReceived` / `hasJustLost` (only if `inventory`); `isOpen` / `hasJustOpened` |


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
	canSee?: (a, b) => boolean;                         // director overwrites when hasLineOfSight
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

Space enters expressions only through these callbacks. Under `ArcDirector` they come from `withWorld` (and `canSee` from `hasLineOfSight`); `buildCatalog` alone takes them as given.

---



## Arcs

An `Arc` is a list of steps. A step says which verb, its args, and how it joins the step after it:

```ts
type Step = { verb:string; args:Record<string, StepArg>; then?:'if_ok' | 'always' | 'if_failed' };
type Arc = Step[];
```

`then` is judged from how this step went: `if_ok` (`&&`) runs the next step only if this one succeeded, `always` (`;` or a new line) runs it whatever happened, and `if_failed` (`||`) runs the rest of the steps, as a fallback, only if this one failed. A missing `then` is `if_ok`, and the last step's is ignored, so `a && b || c` with `a` failing runs only `a`: `c` is the fallback for `b`. Text and JSON differ in one default: a bare new line between steps in text is `always`, while a step with no `then` in JSON is `if_ok`. A group, `( … )`, is the step `{ verb: 'group', args: { arc } }`; its result joins like any step's. `group` is not a verb you register, and no verb may have an arg called `verb` or `then`.

In text, `go_to(Keep) && use(item=Lever) || say("It's stuck.")`. In JSON, which the `json` and `schema` formats write, args sit beside `verb` and `then` comes last; a nested arc is a bare list of steps, and `choose` keeps its choices under `choices`:

```json
{"steps":[
  {"verb":"go_to","target":"Keep"},
  {"verb":"use","item":"Lever","then":"if_failed"},
  {"verb":"say","text":"It's stuck.","to":"Forager"}
]}
```

`parseArc(reply, verbs)` reads either (JSON also as a bare list or one step, fenced or after some reasoning; a string where an arc goes is Arc text), `arcToJSON` / `arcFromJSON` / `arcJSONText` are its JSON halves, and `replySchema(catalog, tools)` is the fixed schema of a reply: a call to one tool, or `{"steps":[…]}`, with one branch per verb of the whole catalog (never of one mind's kit, so every mind gets the same bytes; the kit is checked once the reply is read).

Chain as far as the next verbs are known. A think is expensive — emit that whole chain this think, not one verb and not only the first step of a spoken then-order. `always` still runs after a failed `pick_up` (already holding). `think()` is always moved to the end, out of groups too. `wait(seconds?, until?)` parks; `until` is a one-shot watch.

Arc text is read forgivingly, because small models slip: extra `)`, `.` or `,` after a step are dropped; closers missing at the very end are supplied; two steps with no join between them are joined with `;`. A reply that stopped at the token cap (`ChatResponse.truncated`) is never parsed; it goes to a repair turn. An `issue` that swallowed the next `issue` (a closer missing mid-line) is rejected.

`ArcResult`: `{ ok, interrupted?, reason?, verb? }`.

### Follow-up think

After an arc, `enqueueArc` uses the **highest** score among steps **after** the last `wait(until)`. Failure is at least 0.3. Stock verbs have the scores below; give your own verbs theirs with `verbScores` (`{ steal: 0.95 }`), which also overrides. 0 means no follow-up on success. Steps inside a group count too; arcs held in args (`loop`, `when`, a choice) do not.


| Verb                                | Score |
| ----------------------------------- | ----- |
| `go_to`                             | 0.8   |
| `use`                               | 0.65  |
| `give` / `offer` / `pick_up`        | 0.6   |
| `drop`                              | 0.55  |
| `think(about)`                      | 0.55  |
| `flee`                              | 0.5   |
| `set_goal` / `remember`             | 0.45  |
| `think()`                           | 0.35  |
| `wander`                            | 0.3   |
| `say`                               | 0.25  |
| `drop_goal`                         | 0.2   |
| `wait` / `rest` / `follow`          | 0     |


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

`recall` also answers for **types** when `withKnowledge` is set. Host pages are `{ name, aliases?, text }`, or `crowdKnowledge({ name, tag, inside })` which stringifies a bunch of that tag and distills leftover English plus surround-sense (being inside a spoken place). Query leftover English (`trees`, `house`) or a spoken place (`forest`); empty query lists the topics known. Articles are not in the standing prefix.

---



## Perception helpers

- `formatSight(sight: Sight)` writes what character is seeing.
- `crowdKnowledge({ name, tag, inside })` stringifies a bunch of `tag` around you and writes the leftover-crowd article.
- `formatInventory(bag)` writes what character is carrying.

> [!NOTE]
> Use `withSight` / `withInventory` rather than calling these functions.

---



## Development

```
pnpm test
pnpm demo      # live model, or ARC_DIRECTOR_MOCK=1
```

---



## Layout

```
src/
  index.ts           public API
  director/          ArcDirector facade, CharacterSpec, CollectiveSpec, VerbCall
  character/         ArcRunner, Character, Persona, NameBook, watches, sight focus
  mind/              Mind, prompts, name/id translation, TalkNet, map, knowledge
  collective/        Collective, its verbs, who, tags, memory handover
  think/             MindQueue: ThinkQueue, SimpleQueue
  expr/              watch language, catalog, stringify
  arc/               verbs, parse, wire (JSON), validate, runArc, laws
  world/             HostWorld, routes, moving characters, stock world verbs, watch geometry
  memory/            MemoryStore
  perception/        optional scene English
  inference/         HTTP chat, fake, presets, model catalog
  scripts/           demo + fixtures
  testing/           test fixtures (an open grid world)
```

