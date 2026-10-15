# ArcDirector

**NPCs that think, plan, and act in your browser game, powered by local LLMs.**

You bring the world: a Three.js scene, a Babylon level, an ECS, or a grid of tiles. ArcDirector brings the cast. Characters look around, remember what happened, talk to each other and to the player, form goals, and then *do things*: walk across the map, pick things up, hand them over, haggle at a stall, fight as a squad. You write no behavior trees and no dialogue scripts.

## How it works

### The NPC loop

1. **Perception:** ArcDirector describes your game scene in words for the local LLM.
2. **Planning:** The LLM replies with an `Arc`, a program for one or more NPCs to follow.
3. **Action:** ArcDirector runs the `Arc` to control the NPCs in your game.

### Features

- **Arcs:** LLMs script NPCs on the fly with complex programs.
- **Conditions:** `Arc`s support conditional behavior and loops.
- **Expressions:** LLMs can write powerful expressions to detect specific situations.
- **Personality:** NPCs behave according to their backstory, role, traits, goals and memories.
- **Perception:** Stringifiers compress your game world into a single paragraph for the LLM.
- **Map:** LLMs can look at a map of the game world (if the model has vision).
- **Inventory:** LLMs can see what the character is carrying.
- **Knowledge:** LLMs can recall what the game tells them about the world, alongside their own memories.
- **Memory:** Long-term memories form on the fly and can be recalled later.
- **Recovery:** The LLM recovers from failures by correcting its `Arc`s.
- **Feedback:** Relevant knowledge and memories are injected automatically, based on context.
- **Watches:** NPCs can use expressions as conditions that trigger thinking.
- **Laws:** NPCs can use `Laws` to react instantly to specific conditions.
- **Verbs:** `Arc`s are made of `Verb`s that run in sequence.
- **Kit:** Each NPC can be given a "Kit": the senses, verbs and tools it may use.
- **Stock verbs:** Each game has its own verbs, but ArcDirector has these built in:
  - Movement: `go_to`, `follow`, `flee`, `wander` (using built-in A* pathfinding).
  - Items: `use`, `pick_up`, `drop`, `give`, `examine`.
  - Mind: `say`, `wait`, `remember`, `think`, `set_goal`, `drop_goal`, `set_identity`, `watch`, `unwatch`, `focus`, `unfocus`.
  - Arc: `law`, `unlaw`, `when`, `loop`.
  - System One: `choose` (see below).
  - Trade: `offer` (used for both buying and selling).
  - Collective: `issue`, `tag`, `untag`, `spread`, `circle`, `hold_line`.
- **System One:**
  - Works with the `choose` verb to make quick decisions.
  - Jev, or any local System One model, can make a decision in about 50 ms.
  - LLMs can stand in as System One at about 100–200 ms per decision.
  - LLMs can program NPCs to be controlled by System One models.

## Example `Arc`

An NPC is asked to fetch water from the "Well" with a "Bucket" and bring it to "Mira":

```arc
go_to("Bucket") &&
pick_up("Bucket") &&
go_to("Well") &&
use("Bucket", "Well") &&
go_to("House") &&
go_to("Mira") &&
say("Here's your water, Mira.", to="Mira")
```

The NPC then carries this out in your game. If something goes wrong, an error comes up, or the NPC gets stuck, it finds another way to get the job done.

## Why ArcDirector

**It runs on the player's GPU** through LM Studio, Ollama or any OpenAI-compatible endpoint. It is designed for small local models: the model works with names instead of coordinates, the `Arc` parser is forgiving, the LLM repairs its own syntax errors, and prompts are laid out so the KV cache survives between calls. There are no per-token bills and no cloud dependency, unless you want one.

**It fits any engine.** It has no renderer, no physics and no UI. A position is just an array of numbers (`[x]`, `[x, z]` or `[x, y, z]`), and it never reaches the LLM. A handful of optional callbacks make ArcDirector fully aware of your game world: what is in it, how to get around it, and how to interact with it.

**Your game keeps the rules.** Every verb ends in your code. Refuse one with a reason ("Mira will not take less than 5 gold for bread") and the NPC takes that into account in its next `Arc`. Each NPC's kit limits what it can do, and the LLM cannot overwrite the memories, watches (conditions that trigger thinking) or laws (conditions that trigger `Arc`s) that you have pinned.

**It's cheap to run.** The LLM is only called when an NPC has something to decide. Watches and laws are checked locally every tick, and System One makes split-second choices. When several NPCs need the LLM at once, a priority queue serves the most urgent first and batches the rest to keep a single GPU busy. A single LLM can also control many NPCs at once (see Collectives below).

It also gives you:

- **Talk:** hearing range, muffled speech, line of sight, and waiting for an answer. NPCs overhear each other without being woken by it.
- **Names per observer:** An NPC with the ID "Bob" can appear to another NPC as `MerchantWithBlueHat` until Bob introduces himself. Game code only ever sees real IDs, but NPCs wouldn't be very realistic if they magically knew everyone's name.
- **Collectives:** One LLM commands a squad or a whole market crowd, gives orders by tag, and moves NPCs in formation. NPCs can join, leave and change sides, and their memories are updated to match.
- **Save / load:** `exportCast()` and `restoreCast()` save and restore every NPC's memories, goals, names and laws.
- **Full visibility:** `onLog` shows every prompt, tool call, reply and System One pick, so you can see why your blacksmith thought it could make a wooden spoon out of steel.

## Who it's for

**Vibe-coding a Three.js game and want AI NPCs in it?** Chain a few `with…` calls, point it at LM Studio, call `director.tick(dt, now)` in your render loop, and your scene has a living cast. The stock verbs work as soon as you connect the world.

**Building a real game that ships in the browser?** ArcDirector is strict TypeScript with no rendering dependencies, and every piece can be replaced: the queue, inference, verbs, senses, tools, prompt lines and memory handover. You get typed verb handlers, saves that round-trip the whole cast, and checks at `start()` that fail closed. Much of the hard design work is already done for you: keeping the prompt prefix stable, parallelism per model, clean aborts, and reasoning about targets that cannot be reached.

The example host in [`game/`](../game/) is a complete integration to borrow from.

## Getting started

Five words to know:

| | |
| --- | --- |
| `Verb` | An action characters can perform, e.g. `go_to`, `say`, `pick_up`. |
| `Arc` | A short program of `Verb`s that a `Mind` gives to characters. |
| `Mind` | The part that writes `Arc`s. |
| `Character` | A single NPC, controlled by a single `Mind`. |
| `Collective` | Several NPCs controlled by a single `Mind`. |

1. `new ArcDirector()` starts out empty.
2. Chain `with…` calls (each sets one subsystem) and `add…` calls (each adds to a list), in any order.
3. `await start()` is the only assembly step. It wires up characters and their minds, probes the model and checks the names in each kit.
4. Call `tick(dt, now)` every game frame. Do not call it while the AI is paused.

```ts
const director = await new ArcDirector<CharacterCtx>()
	.addLMStudioInference()
	.addStockVerbs()
	.withDefaultKit({ verbs: STOCK_VERBS })
	// Callbacks that unlock the stock verbs and sight
	.withWorld<GameObject>({
		// Queries
		find: (id) => scene.byID(id),                                // the only place an id becomes an entity
		getPose: (go) => go.pose(),                                  // { point: [x, z], facing?, right? }
		getPathGraph: (go) => scene.steps(go),                       // (point, into?) => [{ point, cost?, blocked? }, …]
		getDescription: (go, target) => scene.describe(go, target),
		// Commands
		steerToward: (go, point) => go.headToward(point),            // a position; true once there
		transfer: (move) => scene.move(move),                        // returns how to undo it
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

`start()` returns `Promise<this>`, and every other chain method returns `this`. Once `start()` has succeeded, the `with*` methods throw `Error('ArcDirector already started')`. The lists stay open: `addCharacter` / `removeCharacter`, `addCollective` / `removeCollective`, `addStockVerbs` / `addVerb` / `removeVerbs`, and `addSense` / `addTool` / `removeSense` / `removeTool`. A start that failed (no model, or an unknown name in a kit) can be retried; calling `start()` again after it has succeeded does nothing.

`start({ ignoreMissing: true })` logs unknown names through `onLog` instead of throwing.

A `Persona` is who someone is and what they know: their identity, goals, memories, the names they use for others, their watches and their sight focus. Each character and each collective has one. Its mind only reads and writes the persona, so dropping or swapping the mind loses nothing. `Character` and `Collective` both extend `ArcRunner`, the base class that runs arcs.

A character with `mind` settings thinks for itself. A character without them (the player, for example) is driven by the host: it runs laws and kit verbs through the same handlers, but never calls the model and never gets the mind-only verbs (`MIND_ONLY_VERBS`: think, remember, goals, identity, watches, focus). Drive it with `director.character(id).enact(parseArc(text, character.activeVerbs()))`.

Scripts without a frame loop can use `runLoop(hz)`, which returns a function that stops it. Games should not, since they already have a tick.

---

## Subsystems

Each `with*` call sets or replaces one slot; leave out the ones you do not need. You rarely need `.withPriorityQueue()`, because priority is the default. Stock verbs are opt-in through `addStockVerbs()`.

### Inference

This is how ArcDirector chats with models. A director can talk to any number of chat **servers**, and to any number of **models** on them, each by name. A mind thinks with the model its settings name (`mind: { model: 'qwen' }`), or else with the default model. `start()` rejects if a mind has no model (`onLog` can print why). Every `add*` and `remove*` method on ArcDirector works both before and after `start()`.

| | |
| --- | --- |
| `addLMStudioInference(opts?)` | Adds server `lmstudio` (or `name`). Defaults to `http://127.0.0.1:1234/v1` and loads models with flash attention. Pass `baseURL: '/inference/v1'` when a page proxies LM Studio. |
| `addOllamaInference(opts?)` | Adds server `ollama` (or `name`). Defaults to `http://127.0.0.1:11434/v1`. |
| `addHttpInference(opts)` | Adds server `http` (or `name`) at any OpenAI-compatible base URL. |
| `addFakeInference(chat?, { name? })` | Adds server `fake`, for tests. Its model ID is `fake`. By default it replies with a canned `go_to` to a PascalCase name. |
| `addInference(name, provider, { vision? })` | Your own `chat` / `embed`, or your own System One `pick` (see below). |
| `addBrowserModel(name, model?, observer?)` | Adds a model that runs in the page on WebGPU through transformers.js (`@huggingface/transformers`, with `@mlc-ai/web-xgrammar` holding replies to their schema; both optional peer dependencies), on server `browser`. `model` is a Hugging Face repo (see below); without one, Gemma 4 E4B. The download starts right away and is returned as an Observable `ModelDownload`; you can also pass `{ next?, error?, complete? }` callbacks. |
| `BrowserProvider.shared` | The page's browser models. It is kept across directors, so a loaded model outlives them. `download(model)`, `isCached(model)` and `delete(model)` work without a director, for example on a settings screen, and `BrowserProvider.unsupported()` says why this browser can't run them, or null. |
| `removeInference(name)` | Removes server `name` (chat or System One) and every model on it. Runners that were assigned a System One on that server have none until it is added again. |
| `addModel(name, spec?)` | Adds a model: `{ inference?, id?, decision?, contextLength?, thinking?, thinkingBudget?, sampling?, reasoningEffort?, maxParallel? }`. `sampling` is how it picks each token, `{ temperature?, topP?, topK? }`, such as the model maker's recommended settings (Gemma: `{ temperature: 1, topK: 64, topP: 0.95 }`); the default is `DEFAULT_SAMPLING`, `{ temperature: 1, topP: 0.95 }`, which every OpenAI-style server takes, and `topK` is only sent when set. Greedy decoding is not the default, since it makes a thinking model repeat one thought until its budget runs out. System One always decodes greedily, as a request may (`ChatRequest.sampling`). `thinkingBudget` caps a thought in tokens: past it the server stops, and the mind answers from the thought so far without thinking again, for models (Gemma 4) that only switch reasoning on or off. `decision` makes it System One `name` instead (see below). `inference` defaults to the first server, and `id` to that server's pick (for LM Studio, the loaded chat model that `modelGrade` ranks highest). `maxParallel` (default 4) caps how many thinks run on this model at once. Adding the same name again replaces it. If no model was added, `start()` adds the first server's pick, named after the server. |
| `removeModel(name)` | Removes a model. Minds that were assigned it think with the default. |
| `setDefaultModel(name)` | Sets the model for every mind without an assignment. Defaults to the first model added. |
| `modelID(name?)` | The server's ID for that model (or for the default model), or `''` until its server has answered. |
| `withEmbeddings({ inference?, id })` | The one model that every memory and recall query is embedded with, so memories stay comparable whichever model a mind thinks with. Without it, recall matches text. |
| `withArcFormat(format)` | How minds write an Arc: `'text'` (`go_to(Keep) && wait()`, read forgivingly), `'json'` (the default: `{"steps":[…]}`) or `'schema'`. `'schema'` is the same JSON, but the server must follow a fixed reply schema: a think goes to `/v1/chat/completions`, and tool calls are replies such as `{"tool":"recall","query":"Bread"}` rather than native calls. Collectives follow the format too. Change it live with `setArcFormat(format)`, and read it with `arcFormat`. |

A browser model is a Hugging Face repo of ONNX weights: `'onnx-community/gemma-4-E4B-it-ONNX'` (the default, `DEFAULT_BROWSER_MODEL`), `'org/repo@<commit>'` to pin what loads, or the repo's URL. Set transformers.js's `env.remoteHost` to host models elsewhere. The spec is `{ model?, provider?, inference?, ...addModel's }`. Weights load at the precisions a repo names in its `transformers.js_config`, else 4-bit, with 16-bit math where the GPU supports it, and only the text parts of a multimodal model download. A reply with a schema is held to it by xgrammar, the engine vLLM and SGLang use, so `'schema'` Arcs work as they do on a server: a thinking model reasons first, and the schema holds from where its thought closes. The `ModelDownload` sends `{ progress, text }` to each subscriber (RxJS's `from()` accepts it), and `done` is a promise. Models with the same name share one download. To suggest a model a player's device can run, `gpuMemory()` estimates its GPU memory from the GPU's name and the system RAM (null when the browser hides them), and `fittingModel(models, memory, spareGB = 1)` picks the biggest of `{ memoryGB }` models that leaves that much over for rendering. Browser models have no native tool calls, so minds write their Arcs as `'schema'` or `'text'`.

```ts
// Follow the download as an Observable…
director.addBrowserModel('main').subscribe({ next: ({ progress }) => bar.style.width = `${progress * 100}%` });
// …or with callbacks, or just wait for it.
await director.addBrowserModel('quick', { thinking: false }, { complete: () => ready() }).done;
```

**System One** models are fast models that pick one of a `choose` step's arcs by name; they never write arcs. The director keeps them by name. A spec's `systemOne` assigns one, and a runner without an assignment uses the default. A runner left with none never sees `choose`.

| | |
| --- | --- |
| `addJevInference(opts?)` | TypeSafe's Jev, named `jev` unless `name` says otherwise. It posts `{ state, model, questions: { pick: { type: 'choice', … } } }` to `baseURL`, which defaults to `/systemone`: a page proxy that adds the API key, so the library never reads the key. `model` defaults to `jev-latest`; pass `headers` when there is no proxy. Any System One endpoint works, including LM Studio's `/v1/systemone`. A `baseURL` ending in `/decisions` is asked in OpenAI's Decisions format. |
| `addModel(name, { decision: true, inference?, id?, maxParallel? })` | A local System One. A decision model (LM Studio's `decision` type, e.g. `ggml-org/Laya-GGUF`) answers through its server's `/v1/systemone`. Any other model is a chat model that scores the choices: they are sent as lettered options, the answer is a single token with reasoning off, and the listed letter it scores highest wins (by its log probabilities, or by the letter it answered when the server returns none). Leave out `id` to use the server's chat pick, which is already loaded; in that case also give it the chat model's `contextLength`, so the two never cause a reload. It is never the minds' default. |
| `benchSystemOne(systemOne, cases?)` | Measures how well a System One decides. By default it runs `DECISION_BENCH` (tactics, survival, social, puzzle), each case with the choices in both orders, so a model that always favors one slot only scores half. It reports right answers per skill, the mean time per pick in milliseconds, and failures. |
| `addInference(name, systemOne)` | Your own `pick`. |
| `setDefaultSystemOne(name)` | The System One for runners that have none of their own. |

Every `add*` works before or after `start()`, and adding the same name again replaces it.

**Benches** score models on scenes with known right answers, from easy to hard. A `BenchScore` holds the right answers per skill and level, the mean time per trial, and the failures. `benchSystemOne` scores picks. `benchArcs(models, cases?)` scores chat models on writing arcs that reach a goal, using `ARC_BENCH` (chain, trade, social, fight, lookup) by default. Each case is one think in a fresh director, which `models(director)` sets up just as the host would for play (`addModel`, `withArcFormat`, `withRepair`, …), so the model reads the same prompt it would in play. Its arc then plays out in a `SceneWorld`, a small world the stock verbs walk, trade and hand items around in, while the case's `act` moves the others. As in play, the mind thinks again on how that went while the goal is not reached: up to 3 thinks in a minute of play, timed by the thinks alone. The case's `done(world)` decides: any arcs that reach the goal are right, whatever their steps. In a lookup case, what the goal needs is out of sight, so only `see_map` or `recall` finds its name.

When a runner's own System One fails or names no choice, every other System One is asked, in the order they were added, and then the runner's chat model. A System One that failed is skipped for 30 s. Every pick goes to `onLog` under the character's ID: the goal, the state, the choices, the answer and who gave it, the time taken, and every miss. A cast made only of characters with a standing `choose` (no minds, no collectives) can start with `addJevInference()` alone; anything else needs chat inference too.

Do not wrap HTTP in a second queue of requests in flight: the mind queue's `inFlight` is the cap. `onLog` already wraps chat once (with timings and content), so the host does not need to wrap `chat` itself.

`infer` gives live timings. To change a model's settings, add it again under the same name; a mind never changes them.

**Server options** are `baseURL`, `apiKey`, `enableThinking`, `reasoningEffort` and `load`. The last three are defaults that a model's own settings override. Without `apiKey`, `ARC_DIRECTOR_API_KEY` or `OPENAI_API_KEY` is used.

**Thinking.** Thinking (chain of thought) is off unless `enableThinking` is true. When it is off, the last message is an assistant prefill that skips the reasoning channel: an empty `<redacted_thinking>` block, or the model's Harmony `to=user` header when `applyPromptTemplate` is set (the same method as LM Studio's imageVision plugin). A schema request skips that prefill, because llama.cpp feeds the assistant message to the JSON grammar, and `<` empties its stack.

The reasoning effort is sent as `reasoning_effort` on chat completions (`off` becomes `"none"`, the only value that turns Gemma's reasoning off there) and as `reasoning: { effort }` on the responses API. It is only sent when `/api/v1/models` lists that option for the model: `low` when thinking is on and allowed, `on` / `off` for models that can only switch reasoning on or off, and nothing when the catalog has no reasoning settings for the model. If the context overflows, the request is retried with the effort at `"none"` and a 512-token answer.

**Schemas.** A `schema` request (see `withArcFormat`) is specific to LM Studio and llama.cpp: its grammar uses a root `anyOf`, `$ref` recursion and optional properties, none of which OpenAI's strict mode allows. The schema is not counted as part of the prompt when the answer is capped to fit the slot, and the logs show it by name.

**Loading.** A model's first request loads it (on LM Studio) with its own `contextLength`, and a loaded copy that no longer fits its settings is reloaded. Loading through LM Studio's native API reuses a matching instance and unloads any extra copies of it. Parallel thinkers are a cap per model, not loaded copies. Models configured on one server stay loaded together. Anything else that is loaded is unloaded to make room in VRAM, and if a load fails, the models still loaded are unloaded and the load is retried.

`onLog` receives the outgoing JSON **before** each model call (with the message bodies in fenced blocks below it, and images shown as images rather than base64), and then the reply.

### Mind queue

The mind queue decides who thinks next. By default it goes by priority: watch and verb scores, plus how long ago each mind last thought.

| | |
| --- | --- |
| `withPriorityQueue(opts?)` | Highest score first |
| `withSimpleQueue(opts?)` | First in, first out |
| `withQueue(instance)` | Your own `MindQueue` |

`tick(dt, now)` is **synchronous**. It samples catalogs, ticks the queue, and buffers the minds that are ready. With `batchThinks` (default true), new thinks on a model are held back while any think on it is in flight, because a new prompt's prefill stalls decoding for the rest. Once the model is idle, or after `batchWait` seconds (default 20, on the same clock as `now`), up to that model's `maxParallel` thinks start together. Set `batchThinks: false` to fill a free slot right away. HTTP requests and `enact` carry on across frames. `dt` and `now` are **game time**.

`mayThink` (in the queue options) decides whether a mind may think, based on whether it is idle, its live arc, major events and the watch score (see [Think queue](#think-queue-details)). If a live arc exists and a think is allowed, the director stops that character (`abortArc(id)`: its moves and waits stop, then `onAbortArc` is called) and skips that mind for this frame.

A chat request in flight occupies a slot for that mind's ID. `mind.abortThink()`, `director.abortThink(id)` and `queue.abortThink(id)` trip that slot's `AbortSignal`. Removing a character or collective, dropping a mind (on a join, or with `character.mind = …`), `setAiOn(false)`, `drop`, and vacating a commander's post all abort it as a side effect. A finished reply is thrown away if its slot was aborted before it was enacted.

### Verbs

| | |
| --- | --- |
| `addStockVerbs(...verbs)` | Registers stock verbs, which the library runs itself (the world verbs through `withWorld`). With no arguments, it registers all of them; pass names to opt in to a subset (see the groups below). A name that is already registered is skipped. |
| `addStockCollectiveVerbs(...verbs)` | Registers the schemas of `issue`, `tag`, `untag`, `spread`, `circle` and `hold_line`. Registering them does not grant them; the collective's kit does. |
| `addVerb(name, { args?, help?, handler? })` | Registers a verb's schema and, optionally, the function that carries it out in the world. The handler's `args` are typed from `args` (`{ item: 'id', offer: 'number?' }` gives `{ item: string; offer?: number }`); a stock verb's args are typed from its stock args. `help` is one line shown after the verb in the prompt's verb list (`shoot(target) — needs a clear line of sight`); stock verbs have theirs too. Adding the same name again binds or replaces the handler, and a host handler replaces a stock one. |
| `removeVerbs(...names)` | Removes the named verbs' schemas and handlers. Missing names are skipped, and calling it with no names does nothing. |
| `withDefaultKit(kit)` | An object or a `(ctx) => kit` function, used when a character or collective spec has no `kit` (a collective's characters included). Like any kit, it is fetched every tick. |
| `withVerbGate(fn)` | Runs before every host verb, with the full `VerbCall`. Return a result to refuse the step (during a cutscene, or after a fight is won); return `undefined` to let it run. |
| `onVerb(fn)` | A catch-all for verbs that have no handler of their own. |
| `withVerbs(registry)` | Replaces the whole registry. |

Pass these groups to `addStockVerbs` spread out, as in `addStockVerbs(...STOCK_MOVE_VERBS)`:

- `STOCK_MOVE_VERBS`: `go_to`, `follow`, `flee`, `wander`. `flee(from, distance?)` takes the cheapest route out of range that keeps well away from them, and ends once it has stayed `distance` away for 3 s. `distance` defaults to the kernels' `nearRadius` (what `nearby()` counts); if there is none, `flee` fails and asks how far.
- `STOCK_ITEM_VERBS`: `use`, `pick_up`, `drop`, `give`, `examine`.
- `STOCK_MIND_VERBS`: `say`, `wait`, `remember`, `think`, `set_goal`, `drop_goal`, `set_identity`, `watch`, `unwatch`, `focus`, `unfocus`.
- `STOCK_ARC_VERBS`: `law`, `unlaw`, `when`, `loop`.
- `choose` (`CHOOSE_VERB`) comes last in `STOCK_VERBS`. It is withheld from any character or collective without a System One.
- `STOCK_TRADE_VERBS`: `offer`. It is registered with the rest but left out of `STOCK_VERBS`, so a kit only grants it where there is trade.

The verb catalog is shared (`addStockVerbs` / `addVerb` / `removeVerbs`). What a character or collective may use is its **kit**, which is fetched every tick: either a plain object (mutate it, or use getters) or a `(ctx) => kit` function. Registering a verb does not grant it. `withDefaultKit` is the usual grant, and a spec's `kit` overrides it. Fetching the kit every tick is cheap, but **changing** what it grants is not, because the verb list is part of the prompt prefix (see [Prompt prefix](#prompt-prefix)).

```ts
type Kit = { verbs?: string[]; senses?: string[]; tools?: string[] };

director.withDefaultKit({ verbs: STOCK_VERBS });
director.addCharacter({ id: 'Holt', mind: {} }); // default kit
director.addCharacter({ id: 'Baker', mind: {}, kit: vendorKit }); // same object; mutate later
director.addCharacter({ id: 'Cook', mind: {}, kit: (ctx) => kitFor(ctx) }); // callback
```

Every character and collective needs a kit, either its own or the default one, and a fixed kit must name some `verbs`; otherwise `start()` throws. A collective's kit is what its mind may write. Each of its characters runs steps with its own kit, and the roster tells the mind what each one cannot do. Leaving out `senses` or `tools` means all registered senses or tools, and `[]` means none. `start()` also throws if a kit grants a stock world verb whose `withWorld` part is missing (and no host handler or `onVerb` covers it), or names a verb, sense or tool that is not registered. `recall` and `observe` are always registered, `earshot` is registered with talk, and `see_map` with a map and vision.

**Senses** are always in the user message, written in English (the `scene`, what is carried, events). **Tools** are called on demand (`recall`, `observe`, `see_map`). A kit's `senses` and `tools` lists only allow some of what you registered; they do not add anything new.

The prompt, the JSON schema and parsing all use the kit of the mind's owner. A step whose verb is not available fails closed. `character.verbs` is the catalog; `character.activeVerbs()` is what the character may use this tick. Assign `character.kit` when the grant actually changes, not every frame.

Handlers receive a `VerbCall`: `{ verb, args, character, ctx, score, holds, goTo, goToPoint, wait }`. `character` is who runs the step, and `ctx` is `withContext(character.id)`. A step whose character has no context fails with `not in this scene` before any handler runs.

A collective without a commander has no body. Its mind is offered only its own verbs and `wait` (which runs on the director's clock), and any other host verb fails with `you are not a character in this scene; issue <verb> to one of your characters`. Its tools and articles look out from its first character in the scene, and it gets no earshot, since it never speaks.

A formation lines up `character.squad`: the characters that were last issued a program together, this one included. The arc running now is `character.arc`, at step `character.verbIndex`; the mind's last arc is `mind.lastArc`.

The library does the mind's half of every verb, so handlers only need to change the world:

- **`id` args are real IDs.** The model may write its own name for a character (see [Names](#names)) or an expression that picks one (`cleave(others.filter("enemy").minBy(u => u.hp))`). The mind turns names into IDs as it reads the reply, and an expression becomes the ID it picks. An expression that picks no one fails with that reason before the handler runs. Plain names the library does not know are passed through for the host to judge (`no such place Cottag`).
- **`watch` args are checked, then asked.** Bad syntax or leftover English (`filter("trees")`) fails before the host runs. `call.holds('until')` tells you whether the watch holds now, and `call.score('until', point)` asks how well it would hold if this character stood at `point` (this is how `wander` picks where to go).
- **Moving and waiting are the library's job.** `call.goTo(target, { within?, check? })` moves this character into reach of `target` (or `within` that far), following it as it moves, and stops sooner once `check` returns a reason. `call.goToPoint(at, { within? })` moves it to a point, and `call.wait(seconds)` lets game time pass. All three end, marked as interrupted, when the step is aborted. A host verb that needs to be somewhere first (`steal`, `heal`) awaits one of them, and keeps only its own rules.
- **Verbs internal to the mind never reach the host:** `remember`, `think`, `set_goal`, `drop_goal`, `set_identity`, `watch`, `unwatch`, `focus`, `unfocus`, `say` when a TalkNet is attached, and `wait`. `wait` lets game time pass until `seconds` is up (default 1, or 20 with `until`) or the `until` watch holds, and an aborted arc ends the wait. Only bind your own `wait` handler if waiting must do something in your world.

The argument kinds are `id`, `string`, `text`, `watch`, `expr`, `law`, `number`, `string[]`, `bundle`, `bundle[]` and `arc` (add `?` to make one optional). A `bundle` is `{ [item: string]: number }`. An `expr` is any other expression (`issue(who=units.filter("Archer"))`), and a `law` is a law's name. A mind stores every `id`, `watch`, `expr`, `law` and `arc` argument in IDs. `text` is prose: unquoted, it runs to the closing `)` or to that verb's next `, key=`, so commas and apostrophes need no quotes (`say(Hello there, BridgeKeeper's friend, to=Player)`). Use it for any argument a model fills with a sentence.

### Perception

Senses go into the user message on every think, and tools are called on demand. `addSense` and `addTool` replace any sense or tool with the same name, and both still work after `start()`.

| | |
| --- | --- |
| `withSight({ look, limit, unitName })` | The stock sense `sight`. `look` returns a `Sight` made of `SeenObject[]` (with `point` vectors). `limit` is the default maximum number of sight clauses (phrases that `formatSight` cannot merge any further), kept in `sightFocus` order; a spec's `sightLimit` overrides it. `unitName` is the unit sight gives distances in (`m`, `pace`, `foot`), and defaults to `pace`. Leave out `look` to set only the cap, or `limit` for no cap. Three tags in a `SeenObject`'s `tags` mean something to sight (`RESERVED_TAGS`): `character` (someone who acts: listed first), `landmark` (fixed: what other things are placed relative to) and `item`; none of them is folded into a crowd phrase. |
| `withInventory(look)` | The stock sense `carrying`. The callback returns an `Inventory` bag. The list ends by saying that nothing else is carried, so a role that often carries something does not suggest it carries it now. |
| `withKnowledge(pages, { mentions? })` | What minds know about the world. `recall` searches these articles alongside memory (see [Knowledge](#knowledge) below). |
| `addSense(name, spec)` | A sense of the host's own. `spec` is `{ description, gather }`. |
| `addTool(name, spec)` | A tool of the host's own. `spec` is `{ description, parameters, handler }`. |
| `removeSense(...names)` | Missing names are skipped, and calling it with no names does nothing. |
| `removeTool(...names)` | The same. |

`Sight.self.id` is the character's name. Without `hasLineOfSight`, everything `look()` returns is seen. Without `addTool`, the host adds no tools, but the built-in `recall`, `observe` and `see_map` still appear when their subsystems are on.

**Leftover English** is the plain words sight uses for unnamed things in a group, like `trees` or `house`. They are not names, so watches and verbs refuse them and point to the right name instead.

#### Knowledge

`withKnowledge(pages, { mentions? })` gives minds articles about the world. `pages` is `{ name, aliases?, text }[]` or `(ctx) => pages`. `recall` searches the articles alongside memory and returns `{ remember, know }`, with at most 2 articles (`KNOW_CAP`), so a mind knows the world the same way it remembers it.

Articles also come to a mind unasked. When a name or alias was said or heard recently, its article appears under short-term memory: at most `mentions` per think (default 2, or 0 for none), and the same article not again for 5 thinks. Mark the things a character can carry with `item: true`. Their mention then always says whether this mind carries one ("FireMushroom (you carry none)"), so a claim made in talk sits next to the truth for both speaker and listener. A name in a failed verb's reason also brings its article in, under that result.

`crowdKnowledge({ name, tag, inside })` builds an article for a crowd of leftover things from `formatSight` (a bunch of them around you). Query leftover English (`trees`, `house`) or a place someone mentioned (`forest`) to find the Capitalized type. An empty query lists the known topics. Articles stay out of the standing prompt prefix.

### Context and kernels

The library knows characters and collectives by **ID**, and a mind goes by its owner's ID. The library does not know your `World`.

- **`withContext((id) => ctx)`** gives the context a character acts in. Its type is `TCtx`, and it holds whatever the game wants. Perception's `gather(ctx)`, kernels, kits and verb handlers all receive it. A mind senses through its voice's context. Generic parameters follow one rule: they start with `T` (`TCtx`, `TEntity`, `TArgs`), so a slot the host fills never reads like a library type.
- **`withKernels((ctx, point?) => kernels)`** gives what a mind knows for its watches (`me`, `others`, `items`, `isHurt(me)`, `inventory`). When `point` is set, a verb is asking what would be true if this character stood there, so answer as if it did (who it would see from there, for example). The library always calls `buildCatalog`. The director owns each character's `SampleCache` (it overwrites `cache`, so you do not set it). It also overwrites `hasHeard` and `prev` from that mind, `canSee` when `hasLineOfSight` is set, and all geometry (`distance`, `nearby`, `isFacing`, `isLeft`, `pathDistance`, `manhattan`, …) from the `withWorld` poses and routes, so kernels never measure space themselves.

Verbs need objects and watches need measurements; the same `ctx` serves both.

### World

`withWorld<TEntity>(world)` describes the game's world the way the stock verbs need it. `TEntity` is the game's own type for things in its world (a GameObject, an ECS entity, a record); the library never looks inside one. `find(id)` **is the only place an ID becomes an entity**. Every other part receives entities, so the game never looks anything up twice. When `find` returns `undefined`, the verb fails with "no such …" or "… is gone" before any other part is called. Things that change hands stay IDs (a `Transfer`'s `thing`, `useItem`'s item, and `examine`'s target), because which Bread is meant depends on whose pack it is in, and that is the game's call.

**Queries** (`find`, `get…`, `hasLineOfSight`, `canOffer`, `validateTransfer`, `up`) only read the world, and may be called at any time, often. **Commands** (`steerToward`, `transfer`, `useItem`) change it. Each part unlocks some verbs:

| Part | Kind | Unlocks |
| --- | --- | --- |
| `find(id)`, `getPose(entity)` | query | Watch geometry: `distance`, `nearby`, `isFacing`, `isLeft` / `isRight`, `manhattan`, … |
| `getPathGraph(character)`, `steerToward(character, point)` | query, command | `go_to`, `follow`, `flee`, `wander`, the collective formations (`spread`, `circle`, `hold_line`), `pathDistance` / `isReachable`, `call.goTo` |
| `getDescription(character, target)` | query | `examine` |
| `hasLineOfSight(from, to)` | query | Sight, talk's `canSee`, and the watch function `hasSightline`. Without it, nothing blocks sight. |
| `transfer({ character, thing, from?, to?, quantity? })`, and optionally `validateTransfer(move, deal)` | command, query | `pick_up`, `drop`, `give`, `offer` |
| `useItem(character, item, target?)` | command | `use` |

- **Positions and directions are arrays of numbers**, in world space, with however many dimensions the game uses: `[x]`, `[x, z]` or `[x, y, z]`. A position is always called `point`. A direction is named for where it points (`facing`, `right`, `up`) and is a unit vector. `getPose` returns `{ point, facing?, right? }`, so left and right mean whatever the game means by them. A 3D game can set `up` (default `[0, 1, 0]`) for formations.
- **Earshot is not reach.** Someone can be within talking range and still out of reach (across a river, or on the phone). The earshot sense marks them with the same blockers a failed move names: `Angler (unreachable, blocked on the way: Bridge is raised)`. A failed move remembers whom it could not reach (`ArcResult.unreachable`). An arc that opens with the same verb toward them is refused in the same think while the way is still blocked, and goes through once it opens. A think whose reply never became a valid arc, even after repairs, runs nothing whose end would wake the mind again, so the mind thinks again, with `think failed — your reply was not a valid Arc: …` as its last result, or `… your plan cannot run: …` when the arc was well formed but the world rules it out.
- **Routes are the library's job.** `getPathGraph(character)` is called once per search and returns the neighbors of any position: as many `{ point, cost?, blocked? }` steps as there are. Grid cells, navmesh polygons, a weighted network of waypoints, or a line: the library runs A* over whatever it gets. The position asked about need not be a node of the graph. A route starts where the character stands and ends with the steps into the destination: when called with `into`, the graph returns the steps arriving at a position, each `point` being where that step leaves from. So a waypoint network returns the waypoints in sight of any position, and a grid with one-way steps (a ledge you can drop off but not climb), or a destination inside a wall, gives no way in. A graph whose steps all go both ways can ignore `into`. Characters differ (a child fits through a gap a knight does not), so the graph is per character. `cost` defaults to the step's length and must not be less than that; raise it to route around crowds or rough roads. A `blocked` step ("EastDoor is locked — you carry IronKey") is avoided. When there is no open way, the move fails, naming every blocker on the way there, cheapest first, so a mind facing two locked doors learns about both and can pick the one it has the key for. In the reason, say what this character could do about it.
- **The library moves characters; the game animates them.** While a character moves, `steerToward(character, point)` is called every tick with the position of the next waypoint (never a direction), or with `null` to stand still. It returns whether the character has reached `point`, by the motor's own measure. Speed, collisions, animation and how close counts as arrived all stay in the game, so the library needs no notion of units. A character that makes no progress gets a new route, and then fails with `stuck`. Without `getPathGraph` and `steerToward`, characters do not move, and `call.goTo` only succeeds when the character is already in reach.
- **`getReach(character, target)`** is how close a character must be to act on `target` and to count as being there (default 1). A building can return its half-width, so that arriving inside it counts.
- **Trades are offers, and nothing changes hands until one is taken.** `offer(to?, give?, get?)` names what this character hands over and what it wants back, each as a bundle (`{"gold":5}` or `{"Egg":12, "Milk":3}`). If `to` already offers that or better (in an offer made to this character, or else a standing one), the character walks until both are within each other's reach (`getReach`, default 1) and it may make an offer to them (`canOffer`), and then both sides change hands on the maker's terms, as one deal (see below). Otherwise the offer waits, and a major event wakes `to`'s mind with the reverse offer that would accept it; other terms make a counter-offer. A new offer to the same character replaces the last one, and an offer with both sides empty withdraws it. Without `to`, it is a standing offer to anyone, which can be taken in any whole multiple while stock lasts (a `Loaf` for `5 gold` sells three for 15). A new standing offer of the same goods changes the price. Seed standing offers with a character spec's `offers`, or with `director.offers.post(...)`. `director.offers` (an `OfferBook`) is saved with `exportCast`.
- **`canOffer(character, other)`** decides who may make an offer to whom. Without it, `other` must be in `character`'s sight (`withSight`), or else in its line of sight (`hasLineOfSight`), or else it is always allowed. An offer to someone only stands while this holds. Every mind whose kit grants `offer` sees, in every prompt under "Open offers", every standing offer and every offer made by or to a character it thinks for.
- **Everything that changes hands is a `Transfer`:** `pick_up` (no `from`: it lies somewhere for the game to find), `drop` (no `to`), `give`, and each side of a trade, one move per thing. A thing is whatever the game lets move: an item, gold, a house, a promise of work. What a name means is the game's call.
- **The game's rules live in `validateTransfer(move, deal)`,** which returns why a move cannot happen ("Chest is locked", "Realtor does not own Bridge", "Mira's pack is full"), or nothing. `transfer(move)` then only makes it: it throws on a real error, never for a rule, and returns how to take the move back. A deal moves whole or not at all: each move is checked and then made in turn, so each is checked against the world the moves before it left, and a refusal or an error takes back every move made, last first. `deal` (a `Deal`) is the rest of it as seen from this move: `pending` (the moves the world does not hold yet), `done`, and `leaving(holder)` / `receiving(holder)`. The world, this move and `pending` add up to the deal done, so a rule on what someone ends up with, such as a pack that may hold one shield, counts them without counting a move twice. Most rules look only at `move`.
- **Some checks are dry runs** (`deal.dryRun`): a directed offer is checked when it is made, and `pick_up` and `give` before the character walks over, so terms the game rules out are refused before anyone hears them or anyone walks. Nothing moves in a dry run, so every other move of the deal is `pending`. A standing offer, with no one to receive it yet, is checked when it is taken.
- **World rules stay in the game.** `useItem` changes the world and returns `{ ok, reason? }`, and `validateTransfer` returns its reason. Refuse in words the mind can act on, and announce what happened with `pushEvent`, as the game does when the player acts. The library moves the character into reach first, and checks nothing that the game knows better.
- **Stopping a character:** `director.abortArc(id)` ends its moves and waits right away and calls `onAbortArc`.

### Names

By default, every mind calls a character by its ID. `withNames({ seen })` lets the host decide what each mind calls each character:

```ts
director.withNames({
	seen: (observer, target) => (
		target.tags?.includes('enemy') ? 'EnemyKnight' : target.id
	),
});
```

`observer` is `{ id, ctx }`: the mind's owner, and its voice's `withContext` result. `target` is what the mind knows about the character: `{ id, tags?, hp?, maxHP? }`, from sight or from kernels. `id` is the only identifier the host provides; return it to call the character by its ID. `seen` returns a **base** name and should be a pure function of its arguments. A name is always one observer's label for an ID, and only the library writes it (`ExprEntity.name`).

Each persona keeps its own name book. The book keeps names stable, numbers duplicates (`EnemyKnight`, `EnemyKnight2`), remembers old names as aliases, and is saved with the persona, because memories quote those names. The library applies it everywhere a name reaches the model: sight, earshot, heard speech, the `see_map` legend, entities and bindings in the watch language, a collective's roster, laws, watches, sight focus, and an event's `who`.

**Arcs, laws, watches and sight focus are stored in IDs.** A mind turns its model's names into IDs as it reads a reply (in `id` args, and the characters named in `watch`, `expr`, `law` and nested `arc` args; prose is never touched), and turns IDs back into its own names in every prompt line that shows them. So handlers and kernels only ever deal in real IDs, and a law keeps working after its character moves to a collective whose mind names everyone differently. `mapArc`, `mapExpr`, `idsOf` and `namesOf` do this rewriting.

Strangers use the same mechanism. Return `MerchantWithBlueHat` based on the target's tags until the mind has been told the name, and the book keeps that label steady with no bookkeeping on the host's side. Once the policy returns the real ID, the old label stays on as an alias, so memories that quote it still make sense.

Events that mention characters pass real IDs in `who` and refer to them by number in the text. Each mind reads them in its own names and gets them as tags. When a mind's own owner or voice is named in `who`, it reads as "you" (or "You" at the start of a sentence), so write event texts that work in both persons: past tense, as in `{0} gave Bread to {1}`.

```ts
director.pushEvent({ kind: 'Hurt', text: '{0} cleaved {1}', who: ['Brune', 'Helms'], tags: ['hurt'] });
// one party reads "Brune cleaved EnemyKnight", the other "EnemyKnight cleaved Helms"; Helms's party reads "EnemyKnight cleaved you"
```

`director.seen(observerID, target)` gives the same name for text the host writes itself, such as a sight `note`. `observerID` can be a character or a collective.

### Talk and map

`withTalk(sense, onSpoke?, config?)` sets the talking range and routing, per character, and the library routes `say()`:

- A mind hears through every character it thinks for. A collective hears through each of its characters, once per line, from whichever character heard it best. That includes its characters talking to each other; only its own voice's lines are not heard back.
- A line said to, or naming, any of a collective's characters is meant for its mind and wakes it, whichever character heard it. Only a line said to its voice reads as `says to you`.
- A collective never speaks for itself. Its commander speaks, or it issues `say` to one of its characters.
- Line of sight comes from `hasLineOfSight`.
- When an arc's reply verb names another character (`say` with `to`, `give`, `offer`), the actor waits up to 20 s at the end of the arc if that character is still nearby. The wait ends when they finish a verb that is not a movement. Since the wait comes at the end, the rest of the arc still runs first. A step that names no one, such as `say` without `to`, does not wait.
- The `say` result names whom the line was for but who could not make out the words (`heard by Baker; too far for Guard to make out the words: get closer`), and earshot marks them as `too far to make out your words`.
- A `say` whose content words (after stemming) mostly repeat a line that everyone it is meant for has already heard clearly is refused before anyone hears it: "they already heard you say that".
- `hasHeard` is only true for speech meant for this mind.

`withMap(sense)`: the host paints the `see_map` pictures and marks characters, things and places on them by `id`. The library stamps a legend on the picture in the mind's own names (no coordinates). The map is left out unless vision is on.

`withKnowledge(pages)` gives articles about the host's types, which minds `recall(query)` alongside memory, so that every type need not be stuffed into the standing prefix (see [Knowledge](#knowledge)).

### Characters

`addCharacter(spec: CharacterSpec)` works before or after `start()`. `removeCharacter(id)` removes a character for good, whether it is on its own or in a collective. Characters and collectives share one set of IDs, and a duplicate throws.

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

A spec's `systemOne` (on characters and collectives alike) names the System One that picks for it instead of the default. A collective's `systemOne` also picks for every character in it, so `issue(who, loop(choose(...)))` asks the party's own model. `null` means none at all. A name the director never added throws when the spec is wired up. The kit must still grant `choose`.

A character with `choose` and no mind keeps picking among its choices by System One. Each key except `goal` and `until` names a choice, and its value is that choice's arc. `until` is a watch that pauses the picking while it holds. The picking runs whenever the character is idle, rests for its `cooldown` after a failed pick, and stops while System One is off. In a collective, it is the character's own program whenever its commander has not issued it anything, so units fight or work well without a single think. Bad arcs or watches throw at `start()`, and so does `choose` alongside `mind`.

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

The verb works the same way inside a mind's arc: `choose("hold the gate", hold=go_to(EastGate) && wait(), slash(Raider))`. A choice without a name is named after its verb and first argument (`slash_Raider`). `loop(choose(...), until=watch)` keeps choosing.

The System One reads each choice in terms of whom it is about right now, using the runner's names for them: `shoot(others.filter("enemy").minBy(u => u.hp))` reads as `shoot(EnemyWitch)`, next to the runner's own hp and each target's hp, distance and side. Among the choices' targets, the one with the lowest hp and the nearest one are marked (`EnemyWitch 2/12 hp (lowest), 8 away, ahead`), so a small model that matches words instead of comparing numbers still picks right. Write goals with those words ("finish the lowest hp", "hit the nearest"). A choice whose first target expression picks no one is left out, and if only one choice is left, it is taken without asking. Write choices that only exist when they make sense (`finish=slash(others.filter(u => u is "enemy" && distance(me, u) < 3).minBy(u => u.hp))`) rather than asking a small model to judge reach.

`withMindDefaults(settings)` sets what every new mind starts from; a spec's `mind` settings win over it. Other director methods: `director.character(id)`, `characters()`, `collective(id)`, `collectives()`, `minds()`, `exportCast()` / `restoreCast(cast)`, and `pushEvent` (which reaches each mind once). Calling `restoreCast` before `start()` keeps the save, and `start()` builds the cast from it while wiring everything up.

A character's `id` is its name, and a mind introduces itself by its owner's ID (`You are Fern.`). `role` is an optional plain tag (`Herbalist`) that hosts can also accept as a way to address the character. Backstory goes in pinned `memories`. `set_identity(role?, traits?)` never renames anyone. Identity is who someone is: do not rewrite the role or traits to sum up a mood, an order or the current think. Those belong in goals and events (see [Prompt prefix](#prompt-prefix)).

A host can also build a mind itself and hand it over: `character.mind = new Mind({ rank: 2 })`. The director connects the model and the queue when the mind is attached.

### Collectives

A collective is a group of characters that share one mind. `addCollective(spec)` takes the collective's own kit, laws and persona fields, its mind's settings, its `characters`, and an optional `commander`. The mind's arcs run on the commander, who is the collective's voice. Without a commander, the collective (a hive) runs them itself, seeing through all of its characters at once (its `me` is a stand-in at their average pose, carrying nothing).

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

**`issue(who, arc)` is instant.** It assigns programs that stick, and returns `ok` without waiting for the characters to move, talk or finish. Join several `issue` steps with `;` (`"then":"always"` in JSON) so that later ones still run. `&&`, `;` and `||` *inside* `arc=` sequence that character's own steps. `&&` after an `issue` means the orders were assigned, not that the characters finished them. To wait for them, the thinker uses `wait(until=...)` over the roster.

`who=` is an expression on `units` (the roster minus the commander; `allUnits` is everyone), not on `others`. Give orders by tag. The tags in a character's spec travel with it. A tag the mind adds with `tag` is stored as ``${collective.id}:${short}`` and dropped when the character leaves; expressions and prompts use the short name.

Formations (`spread`, `circle`, `hold_line`) are steps like any other, and can go anywhere in a character's arc. Every character in the squad it was issued with works out the same slots and walks to its own, and the step ends when it gets there. Each character needs them in its kit. Inside `arc=` and a law's `watch=`, `me` is that character. Each character runs what it is issued with its own kit, and the roster tells the mind which of the collective's verbs a character cannot run.

**Laws.** `law` and `unlaw` set up standing emergency responses (with no LLM involved) that take over when their `watch` holds. The prompt lists laws as sentences (`- flee (for units.filter("Shopper")): when isHurt(me), run go_to(Keep)`) rather than arcs, so small models do not copy them back. A collective's own laws reach its characters through `who`. A character's own laws live on its collective, named like `Tom.flee`: the prefix is the filter, so they take no `who` and only reach Tom. Each group holds at most `maxLaws`, and the collective's own laws outrank its characters'. Law names cannot contain `.`, but IDs can, since the prefix ends at the last one. A `law(...)` step run by a character who is not the commander writes a law of that character's own (`Tom.…`). Running laws and `when` steps are tracked by the law or step itself, so renaming one never restarts it.

**Moving characters.** Characters change collectives through two setters, and the arc a character is running keeps running throughout.

| | |
| --- | --- |
| `character.collective = c` | Moves it straight into `c` from any other collective. Its own mind goes (its settings are kept), its laws move in as `Tom.*`, and the old collective's tags and commander post are dropped. |
| `character.collective = null` | It leaves. It thinks with a fresh mind built from its kept settings, or the host drives it if it never had any. Its laws lose their prefix; laws that need a collective (`units`, `allUnits`) are dropped, and its new mind is told which. |
| `character.mind = m` | Gives it its own mind from now on, outside any collective. A collective's mind means joining that collective. `null` hands it to the host and forgets its settings. Another character's mind throws. |

The collectives involved hear "Tom joined" or "Tom left", and a character that left is told what it is still doing for the collective it left. `removeCollective(id)` moves every character out first, so each one ends up on its own. `onCommanderVacant((collective, character) => …)` fires when a commander leaves or is removed; name a successor with `collective.commander = …`.

**Memory handover.** After a move, a single model call fixes the memories of everyone involved: what went stale for the collective that was left, and what the character, or the collective it joined, should now remember. Moves within `ticks` director ticks of each other share one call (a character that moves twice makes one journey, from its first `from` to its last `to`), and characters without an identity are skipped. The call takes the next free think slot, never stops a think, and nothing waits for it. Pinned memories are never touched. Handover is on by default: `withMemoryHandover({ ticks?, handover? })` widens the window or swaps in your own `Handover = (journeys) => Promise<MemoryEdit[]>`, and `handover: false` turns it off.

### Prompt prefix

Each think is two messages. The **system** message holds the identity, the standing instructions and the kit's verb list (plus a `see_map` hint when vision is on). The **user** message holds everything that is expected to change: the scene, what is carried, events, goals, pinned memory, watches and the last verb.

Local servers (LM Studio, llama.cpp, Ollama) keep a **KV cache**: the attention state for a run of tokens. If the next request starts with the same tokens as a recent one, the server reuses that state and skips the work. Reuse only lasts while the tokens match from the very start. From the first token that differs, everything is recomputed to the end, including the long user message you meant to be cheap. One early edit costs a full prompt reload.

You can replace the standing lines:

| | |
| --- | --- |
| `withThinkInstructions({ on?, off? })` | The line about thinking, depending on whether reasoning is on (the prompt follows the `thinking` setting of the mind's model). `on` defaults to "Think in 5 sentences, then emit the arc."; `off` defaults to nothing, since the prompt already asks for the Arc alone. |
| `withVerbInstructions(text)` | The line about chaining verbs. For a collective, the default also asks for looping programs; this replaces both. A host's standing doctrine goes here. |
| `withCurrency(name)` | The item ID the world pays with (`gold`). The prompt shows `give` and `offer` moving it, the purse is counted in it, and giving it is remembered as paying. Without a currency, the prompt says nothing about money. |
| `withArcExample(arc)` | The example that closes the prompt, written as Arc text; the JSON formats show it as Arc JSON. Small models copy it, so make sure it is valid and its parentheses balance. |
| `withRepair({ retries? })` | How many repair turns follow a bad arc (default 0). Each samples as the model does, so a model that wrote one bad reply does not write it again word for word. Repair turns never reason, since the conversation they carry has already run long. A failed think goes into short-term memory only, never into facts. |
| `withToolRounds(n)` | How many tool rounds a think may spend before it must emit the Arc (default 6, `DEFAULT_TOOL_ROUNDS`, since small models need several lookups in a row). `0` offers no tools. Calling the same tool with the same arguments twice in one think is refused rather than run again. |
| `withStalled(fn)` | Decides whether a finished arc stalled, which stretches that mind's heartbeat. By default, an arc stalled if it failed or was interrupted. |

Tool hints (`see_map`, `recall` for knowledge, `observe`) only appear on thinks where that tool is actually offered.

Keep the system message the same from one think to the next:

- **Identity** is who someone lastingly is. A new role is a life change, not "I am angry" or "Player told me to wait". The model is already told not to rewrite its identity to sum up a moment, and the host should not either.
- **The kit** is a lasting grant. Returning the same kit every tick is fine. Flipping verbs, senses or tools every tick (gagging someone for one line, offering vendor verbs only while the player is looking, an empty kit while unconscious) breaks the cached prefix for that mind. A gag or a stall that lasts a whole scene is one change: make it, then leave it alone. An unconscious character should skip thinking (`mayThink`), not have its kit rewritten for a frame.
- **Vision, `see_map` and the you-mark:** leave them on or off for the whole session. The library already keeps tools listed (`tool_choice: none`) on arc turns, so follow-up requests *within* a think share a prefix.

`addVerb` and `removeVerbs` rewrite the shared verb catalog, and `addTool` / `removeTool` change the tool list sent with each request. Since those lists are in the prefix, changing them costs as much as changing the kit.

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

`soloCharacter({...})` builds a character with its own mind and no director, for unit tests and scripts. Normal use does not need it.

`Mind<TCtx>` writes arcs for its owner, which is a character or a collective. `tick(gameTime)` may revise goals (the strategic pass) and emit one `Arc` (the tactical pass), which its voice enacts when that voice has an executor and `autoEnact` is on. `thinkNow({ about?, enact? })` thinks once, right away.

A strategic pass revises goals first, in the format the mind writes in: Arc text (`set_goal`, `drop_goal`, `set_identity`, or nothing) under `text`, JSON `{"goals":[…],"identity"?:{…}}` under `json`, and the same JSON with a fixed `goals` schema under `schema`. The voice's `verbIndex` is the 0-based index of the step currently running inside `enact`.

### When the tactical pass runs

| Condition | Effect |
| --- | --- |
| First `tick` | Always thinks |
| `lastResult.interrupted` | Thinks |
| A pending event with `major: true` | Thinks |
| `heartbeat <= 0` | Thinks (the queue already picked this mind) |
| Anything else | Thinks if `gameTime - lastTacticalTimestamp >= heartbeat` |

Defaults: `heartbeat` is 0 under a director (its queue paces the thinks) and 30 in `soloCharacter`, and `strategicInterval` is 180. Setting `strategicInterval <= 0` turns the periodic strategic pass off.

A tactical pass gathers the senses, may let a memory intrude, offers tools for up to `toolRoundCap` rounds, and ends with an `Arc`. The tools are `recall`, `observe`, `earshot` and `see_map` (when the host draws maps and the model can see), plus the host's own; `recall` also searches knowledge when `withKnowledge` is set. The Arc is `{"steps":[…]}` JSON, or `go_to() && wait()` text under `arcFormat: 'text'`; under `schema`, tools are called in the reply itself. How the prompt is split into the system and user messages is described under [Prompt prefix](#prompt-prefix).

### Options

| | Default | |
| --- | --- | --- |
| `model` | the director's default | The configured model it thinks with, by its `addModel` name |
| `toolRoundCap` | 6 | Tool rounds before the arc must appear; 0 offers no tools |
| `arcRetryCap` | 0 | Extra turns after a bad arc |
| `intrusionThreshold` / `intrusionCooldown` | 0.55 / 45 | When an unrequested memory may come into the prompt |
| `recallK` | 5 | How many hits `recall` returns by default |
| `hideObserve` | false | Leaves out the built-in `observe` tool |
| `map` | none | Host snapshots for `see_map` |
| `knowledge` | none | Articles about the host's types, which `recall` searches alongside memory |
| `vision` | guessed | Whether the model takes images (`true` / `false`) |

`maxGoals` (default 5), watches, sight focus and their writable flags live on the `Persona`.

`pushEvent` queues text for the next think. A `major` event wakes the mind right away, unless it `skipMajor`. Speech is only major when it is said to the listener, names them, or is said to everyone and heard clearly, so talk between others is overheard without waking anyone. `remember` also files the event as an episodic memory, and `timestamp` defaults to now. `remember(text, tags)` writes a memory into the owner's persona. `toJSON` / `Mind.fromJSON` save and restore the mind's settings and thinking state; the persona is saved with its owner.

---

## Think queue (details)

On each tick, the queue adds up time, samples watches every `watchInterval` (0.25 s), emits rows every `processInterval` (1 s) and buffers the minds that are ready. With `batchThinks` (default true), the director starts a wave of up to `maxParallel` (default 4) thinks per model, but only when nothing is generating on that model, or after `batchWait` seconds (default 20). With `batchThinks: false`, a free slot is filled as soon as it opens. Set `batchThinks` and `batchWait` on `withPriorityQueue`, and `maxParallel` on `addModel`. Walking an arc does not count as being in flight. A mind thinks for one of these reasons: `start`, `watch`, `major`, `verb` or `heartbeat`.

Every mind thinks once when it joins (reason `start`, with a score of 0.5, below a major event), whether or not it has a heartbeat, so a character that only wakes on events still acts from the first second. `skipStart` turns that off for a character that should only react, like a guard who waits to be approached; `withMindDefaults({ skipStart: true })` turns it off for everyone. Laws do not wait for that first think: until a mind has finished one, its voice's laws start as soon as they hold.

`mayThink` is optional. Without it, a live arc blocks a new think. The callback receives `mindID`, `reason`, `score`, `rankedScore`, the live `arc` (or `null`) and the `verbs` on that arc.

Watch scores: `true` counts as `trueScore` (0.51), numbers from 0 to 1 are used as they are, and anything above 1 is clamped to 1 with a warning. A score must be above `epsilon` (0.05) for the mind to be queued.

Priority ranking multiplies that score by a recency factor. Right after a think, the factor is `trueScore` (0.51), and it rises linearly to 1 by `heartbeatStart / 2` (1.5 s at the default of 3). For minds that have never thought, it stays at 1.

Each mind has a heartbeat: a low-priority (0.001) pulse every `heartbeatStart` (3 s), clamped to `[heartbeatMin, heartbeatMax]` (3–300). The interval stays fixed unless you set `heartbeatAdjust: 'auto'` (which stretches it after a stall and shrinks it otherwise) or a callback.

---

## Watches

Watches are standing conditions, checked against a `Catalog` built from `HostKernels`. They are a dictionary from a short **name** to an **expression**.

**Pinned** watches (`pinnedWatches`) are written by the host, and the LLM cannot replace, edit or remove them. Other watches live in `watches`. When `watchesWritable` is set and the kit grants them, the model edits those with `watch(name, expr)` (add or replace) and `unwatch(name)`. `focus(expr)` and `unfocus(expr)` do the same for `sightFocus` when `sightFocusWritable` is set. Using a pinned name fails with a reason. These are ordinary steps, so they run in arc order: in `go_to(Gate) && watch(...)`, the watch is only added if `go_to` succeeds.

The watch language looks like JavaScript function calls, but it is not a subset of JavaScript. Its bindings are `me`, `others` and `items`, plus the host's own names (`bindings`). When you go through `ArcDirector`, `hasHeard` and `prev` come from the mind: `prev.me`, `prev.secondsAgo` and `prev.verbs` describe the last think, or the moment the character spawned if it has never thought. Only pass `prev` yourself when you call `buildCatalog` on its own.

```text
hasHeard || some(others.nearby().approaching())
isHurt(me)
isNear(me, Other, 16)
distance(me, Target)
i is "marked"
```

| | |
| --- | --- |
| Relations | `distance`, `isNear`, `isReachable`, `isApproaching`, `isDeparting`, `hasSightline`, `hasJustSeen`, `hasLostSight`, `facing`, `isFacing`, `isBehind` |
| List filters | `others.nearby()`, `.nearby(16)`, `others.reachable()`, `.approaching()`, `.departing()` |
| Lists | `filter` / `find` / `some` / `all`, `map`, `sortBy`, `count`, `includes`, `first`, `max` / `min`, `sum`, `avg`, `reduce` |
| Logic | `&&` / `\|\|`, `*`, ternary, `??` (only for absent values), `!` / `!!` |
| Host extras | `hp` / `maxHP`, `isHurt`, `isHPFalling`; `isCarrying` / `wasCarrying` / `hasJustReceived` / `hasJustLost` (only with an `inventory` kernel); `isOpen` / `hasJustOpened`; `isReady(me, "verb")` (a `choose` leaves out a choice whose first verb is not ready) |

In identifiers, a leading acronym is lowercase (`id`, `hp`, `npc`); later in a name it stays in capitals (`maxHP`, `npcID`).

`observe({ expr })` evaluates an expression once and turns the result into text. Conditions that should keep being checked belong in watches.

---

## Catalog kernels

`buildCatalog(host)` wires up the native functions from what you pass in. Leave out a kernel and its functions are not available. `withKernels` is the public way to provide them; `buildCatalog` remains for tests.

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
	isReady?: (who, verb) => boolean | undefined;      // cooldown over; undefined = no cooldown
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

Space only enters expressions through these callbacks. Under `ArcDirector`, they come from `withWorld` (and `canSee` from `hasLineOfSight`); `buildCatalog` on its own takes them as given.

---

## Arcs

An `Arc` is a list of steps. A step names a verb, gives its args, and says how it joins the step after it:

```ts
type Step = { verb:string; args:Record<string, StepArg>; then?:'if_ok' | 'always' | 'if_failed' };
type Arc = Step[];
```

`then` is decided by how this step went:

- `if_ok` (`&&`) runs the next step only if this one succeeded.
- `always` (`;` or a new line) runs it whatever happened.
- `if_failed` (`||`) runs the rest of the steps, as a fallback, only if this one failed.

A missing `then` means `if_ok`, and the last step's `then` is ignored. So in `a && b || c`, if `a` fails, only `a` runs: `c` is the fallback for `b`. Text and JSON differ in one default: a bare new line between steps in text means `always`, while a step with no `then` in JSON means `if_ok`. A group, `( … )`, is the step `{ verb: 'group', args: { arc } }`, and its result joins like any other step's. `group` is not a verb you register, and no verb may have an argument called `verb` or `then`.

In text, an arc looks like `go_to(Keep) && use(item=Lever) || say("It's stuck.")`. In JSON, which the `json` and `schema` formats use, the args sit beside `verb`, and `then` comes last. A nested arc is a bare list of steps, and `choose` keeps its choices under `choices`:

```json
{"steps":[
  {"verb":"go_to","target":"Keep"},
  {"verb":"use","item":"Lever","then":"if_failed"},
  {"verb":"say","text":"It's stuck.","to":"Forager"}
]}
```

`parseArc(reply, verbs)` reads either form. JSON can also be a bare list or a single step, in a code fence or after some reasoning, and a string where an arc should be is read as Arc text. `arcToJSON`, `arcFromJSON` and `arcJSONText` handle the JSON side. `replySchema(catalog, tools)` is the fixed schema of a reply: either a call to one tool, or `{"steps":[…]}`, with one branch per verb in the whole catalog. It never depends on one mind's kit, so every mind gets the same bytes; the kit is checked once the reply has been read.

Chain steps as far ahead as the next verbs are known. A think is expensive, so emit the whole chain in one think: not one verb at a time, and not just the first step of an order like "do this, then that". `always` still runs the next step after a failed `pick_up` (when the item is already held, for example). `think()` is always moved to the end, even out of groups. `wait(seconds?, until?)` parks the character; `until` is a one-time watch.

Arc text is read forgivingly, because small models make slips: an extra `)`, `.` or `,` after a step is dropped, missing closing brackets at the very end are added, and two steps with nothing joining them are joined with `;`. A reply that stopped at the token cap (`ChatResponse.truncated`) is never parsed; it goes to a repair turn. An `issue` that swallowed the next `issue` (because a closing bracket is missing mid-line) is rejected.

`ArcResult` is `{ ok, interrupted?, reason?, verb? }`.

### Follow-up think

After an arc, `enqueueArc` uses the **highest** score among the steps **after** the last `wait(until)` to decide how urgently the mind should think again. A failure scores at least 0.3. The stock verbs have the scores below. Give your own verbs scores with `verbScores` (`{ steal: 0.95 }`), which can also override these. A score of 0 means no follow-up think after success. Steps inside a group count too; arcs held in args (`loop`, `when`, a choice) do not.

| Verb | Score |
| --- | --- |
| `go_to` | 0.8 |
| `use` | 0.65 |
| `give` / `offer` / `pick_up` | 0.6 |
| `drop` | 0.55 |
| `think(about)` | 0.55 |
| `flee` | 0.5 |
| `set_goal` / `remember` | 0.45 |
| `think()` | 0.35 |
| `wander` | 0.3 |
| `say` | 0.25 |
| `drop_goal` | 0.2 |
| `wait` / `rest` / `follow` | 0 |

---

## Memory

`MemoryStore` holds episodic, semantic and identity memories. Pinned rows are never evicted, and they go in the user message.

Each think also brings in the top `recallK` (5) unpinned memories that are not already in the prompt (short-term lines are skipped before the top 5 are taken). They are scored by cosine similarity (when there are embeddings), plus word overlap and matching tags, so speech and `remember()` facts show up without a tool call. `intrusion` may bring in one extra memory unasked.

Episodic memory is capped at `maxEpisodic` (256). Heard speech is copied into a short-term buffer (the last 8 lines) and into episodic memory, tagged with names. Names from sight are kept as last-seen semantic rows. `remember(content)` writes a semantic memory.

---

## Talk

`TalkNet` only deals in names. Implement `TalkSense`: `inRange` and `others`, and optionally `canSee`, `clearHear`, `names`, `face` and `approach`.

On each think, the prompt lists who is within talking range. `say(to)` first walks up to whoever it is said to, following them as they move, until they would make out every word (`inRange` and `clearHear`). When there is no way to them, the library does not speak, and gives the model `sayRangeHint` in the same think. In a world where characters do not move, `say(to)` is only valid for names in range, and the hint tells the model to get closer first. It walks with `call.goTo` and a `check`, as host verbs can. Beyond clear-hearing range, the words are muffled. If the listener comes within clear-hearing range in the next `rehear` seconds (`TalkConfig`, default 8), the line arrives again in full ("…, now clear"). Heard lines are kept as episodic memories.

---

## Map

`see_map` is a **tool**, not an Arc verb. It is only offered when **both** a host `map.snapshot` and `vision` are set. Its `zoom` argument runs from 0 to 1 (1 is close up, 0 is the whole land). The host paints the picture; the library stamps symbols on it and returns a legend of names only, with no coordinates. The default you-mark is `❌`. Never write `see_map(...)` in an arc.

If `toolRoundCap` is 0, no tools are offered, `see_map` included.

`recall` also answers questions about **types** when `withKnowledge` is set. Host pages are `{ name, aliases?, text }`, or `crowdKnowledge({ name, tag, inside })`, which describes a bunch of things with that tag and works out the leftover English, plus a sense of the surroundings (being inside a place someone mentioned). Query leftover English (`trees`, `house`) or a place someone mentioned (`forest`); an empty query lists the known topics. Articles are not in the standing prefix.

---

## Perception helpers

- `formatSight(sight: Sight)` describes what a character sees.
- `crowdKnowledge({ name, tag, inside })` describes a bunch of `tag` things around you and writes the article for that crowd.
- `formatInventory(bag)` describes what a character carries.

> [!NOTE]
> Use `withSight` / `withInventory` rather than calling these functions directly.

---

## Development

```sh
pnpm test
pnpm demo      # live model, or ARC_DIRECTOR_MOCK=1
```

---

## Layout

```text
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
  bench/             System One and arc benches
  scripts/           demo + fixtures
  testing/           test fixtures (an open grid world)
```
