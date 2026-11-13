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
- **Regions:** Places in the world that put a memory on the mind of whoever is in them, and tell the game who comes and goes.
- **Recovery:** The LLM recovers from failures by correcting its `Arc`s.
- **Feedback:** Relevant knowledge and memories are injected automatically, based on context.
- **Watches:** NPCs can use expressions as conditions that trigger thinking.
- **Laws:** NPCs can use `Laws` to react instantly to specific conditions.
- **Verbs:** `Arc`s are made of `Verb`s that run in sequence.
- **Kit:** Each NPC can be given a "Kit": the senses, verbs and tools it may use.
- **Stock verbs:** Each game has its own verbs, but ArcDirector has these built in:
  - Movement: `go_to`, `follow`, `flee`, `wander` (using built-in A* pathfinding).
  - Items: `use`, `pick_up`, `drop`, `give`, `examine`.
  - Mind: `say`, `wait`, `pass`, `remember`, `think`, `set_goal`, `drop_goal`, `finish_goal`, `set_identity`, `watch`, `unwatch`, `focus`, `unfocus`.
  - Arc: `if`, `law`, `unlaw`, `when`, `loop`.
  - System One: `choose` (see below).
  - Trade: `offer` (used for both buying and selling).
  - Collective: `command`, `tag`, `untag`, `spread`, `circle`, `hold_line`.
  - RTS (`withRTS`): `gather`, `build`, `wall`, `bridge`, `repair`, `train`, `research`, `cancel`, `rally` for the economy; `attack`, `attack_move`, `hold`, `patrol`, `garrison`, `unload` for units; `tribute` between sides; `staff`, `haul`, `set_policy` for cities; and standing reactions `keep_training`, `supply_ahead`, `share_workers`, `keep_distance`, `pull_back`, `spread_out`.
  - RPG (`withRPG`): `equip`, `unequip`, `steal`, `sit`, `sleep`, `attack`, `block`, `heal`, `protect`, and the game's own attacks and spells.
  - MOBA (`withMOBA`): `attack`, `block`, `heal`, `protect`, and the heroes' own abilities.
- **Genres:** `withRTS`, `withRPG` and `withMOBA` start a game of that kind with its verbs (`build`, `equip`, `heal`, …).
- **System One:**
  - Works with the `choose` verb to make quick decisions.
  - Jev, or any local System One model, can make a decision in about 50 ms.
  - Skaldic Laya, ArcDirector's own decision model (0.45 GB), decides in well under a tenth of a second, even in the browser beside the main model: `addWllama({ models: { local: Skaldic.Laya } })`.
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
- **Save / load:** `exportCast()` and `restoreCast()` save and restore every NPC's memories, goals, names and laws, and the director's `time`.
- **Full visibility:** `onLog` shows every prompt, tool call, reply and System One pick, so you can see why your blacksmith thought it could make a wooden spoon out of steel.

## Who it's for

**Vibe-coding a Three.js game and want AI NPCs in it?** Chain a few `with…` calls, point it at LM Studio, call `director.tick(dt)` in your render loop, and your scene has a living cast. The stock verbs work as soon as you connect the world.

**Building a real game that ships in the browser?** ArcDirector is strict TypeScript with no rendering dependencies, and every piece can be replaced: the queue, inference, verbs, senses, tools, prompt lines and memory handover. You get typed verb handlers, saves that round-trip the whole cast, and checks that fail closed as the cast is wired. Much of the hard design work is already done for you: keeping the prompt prefix stable, parallelism per model, clean aborts, and reasoning about targets that cannot be reached.

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
2. Chain `with…` calls (each configures what the director has one of: `withVerbs((v) => …)`, `withMind({ … })`, `withSight({ … })`) and `add…` calls (each adds one of many: characters, a provider, a feature of your own), in any order.
3. Call `tick(dt)` from your game loop, with the game seconds since the last frame; if you have no loop, `new Ticker(director)`. The director adds them up in `time`; a `dt` of 0 or less (a paused game) does nothing. With an absolute clock, tick by the difference: `director.tick(now - director.time)`. To pause the AI alone, stop ticking it: time you do not pass never counts. The first tick wires up characters and their minds, checks the names in each kit, and connects to the models. Laws, programs and moves run from then on; only thinks wait for the model.
4. `await connect()` is optional: it does what the first tick does, and resolves once the models answer, or rejects with what went wrong.

```ts
// The game's context for a character, and its own type for things in its world.
const director = new ArcDirector<CharacterCtx, GameObject>()
	.addLMStudio()
	.withVerbs((v) => v.addStock())
	.withDefaultKit({ verbs: STOCK_VERBS })
	// Callbacks that unlock the stock verbs, sight, hearing, and regions
	.withWorld({
		// Entity lookup by ID
		find: (id) => scene.byID(id),
		// Gets entity's position + directions
		getPose: (go) => go.pose(),
		// Navigation mesh traversal for pathfinding
		getNeighbors: (point) => scene.cellsAround(point),
		// How much a step costs, or what blocks it
		canTraverse: (go, a, b) => scene.step(go, a, b),
		// How clearly light or sound passes (line of sight, muffled sounds)
		canPass: (what, a, b) => scene.clarity(what, a, b),
		// Tells what characters see when they `examine` something
		getDescription: (char, target) => scene.describe(char, target),
		// Rotate entity towards position
		steerToward: (go, point) => go.headToward(point),
		// Move things between characters/containers
		transfer: (move) => scene.move(move),
		// Defines how the `use` verb works
		useItem: (go, item, target) => scene.use(go, item, target),
	})
	.withSight({ look: (ctx) => host.look(ctx), limit: 16 })
	.withContext((id) => host.ctx(id))
	.addCharacter({
		id: 'Fern',
		mind: {},
		identity: { role: 'Watcher', traits: ['alert'] },
		memories: [{
			text: 'I keep watch over the gate.',
			tags: ['backstory'], pinned: true,
		}],
	})
	.addCharacter({ id: 'Player' });

director.tick(dt); // every frame, game seconds since the last
```

With no loop of your own, a `Ticker` ticks the director by the wall clock. It starts when made, never keeps a Node process alive, and `using` stops it at the end of the scope (`using` needs `Symbol.dispose` at runtime: Node 24, current Chrome and Firefox):

```ts
using ticker = new Ticker(director, { interval: 0.05 });
ticker.timeScale = 0; // pause
ticker.timeScale = 0.3; // slow motion
ticker.stop(); // `running` says whether it ticks
```

If you call `tick` yourself, scale your own `dt`: a `Ticker`'s `timeScale` is for that ticker only. The cast saves the director's `time` (`exportCast`), and `restoreCast` sets it back, so every time in a save (memories, events, a mind's last think, law progress) means the same moment after a load. A running program is not saved.

Every chain method returns `this` and works before or after the first tick: a `with*` called later reaches every character and mind at once (a running arc goes on, and a think under way sees it on its next think). `connect()` returns `Promise<this>`. It wires the cast, connects every server and model, and resolves once they are loaded and warm; it rejects with the first problem (no model, or an unknown name in a kit), which `onLog` hears too, and called again it tries again. Without it, `tick` does the same on its own, every 3 game seconds until it works, and never throws for it. Nothing runs until the cast is wired; until the models answer (`connected`), thinks wait in the queue while laws, programs and moves run. Reading the cast (`character`, `characters`, `collective`, `collectives`, `minds`, `exportCast`, `pushEvent`) wires it too, and throws what wiring throws.

A `Persona` is who someone is and what they know: their identity, goals, memories, the names they use for others, their watches and their sight focus. Each character and each collective has one. Its mind only reads and writes the persona, so dropping or swapping the mind loses nothing. `Character` and `Collective` both extend `ArcRunner`, the base class that runs arcs.

A character with `mind` settings thinks for itself. A character without them (the player, for example) is driven by the host: it runs laws and kit verbs through the same handlers, but never calls the model and never gets the mind-only verbs (`MIND_ONLY_VERBS`: think, remember, goals, identity, watches, focus). Drive it with `director.character(id).enact(parseArc(text, character.activeVerbs()))`.

---

## Subsystems

Each `with*` call configures what the director has one of: a part of the core, or a built-in feature (`withSight`, `withHearing`, …). Each `add*` call adds one of many: characters, collectives, providers, regions (`addRegions`), or a game's own feature (`addFeature(new MyFeature())`, found again with `getFeature(MyFeature)`; a built-in one with its `get*`, typed with the director's context: `getSight()`). A feature's `with*` takes its data first, then an options object, and called again it configures the same feature, keeping what the new options leave out. Every `on*`, on the director or in a feature's options, adds a listener: each one is called, and one that throws is logged without stopping the rest. Leave out the ones you do not need. You rarely need a queue, because priority is the default. Stock verbs are opt-in through `withVerbs((v) => v.addStock())`.

`.if(condition, then, otherwise?)` keeps a condition inside the chain: `then(director)` runs when it holds, else `otherwise(director)` (`director.withWorld(world).if(hearing, (d) => d.withHearing({ noise }))`).

### Inference

This is how ArcDirector chats with models. A director talks to any number of **providers**, each a server or engine by name, and each holds models by **role** (`main`, `quick`, …). A role is held by one provider at a time; adding a role another provider holds moves it there, and `onLog` says so. A mind thinks with the role it is assigned (`mind: { model: 'quick' }`), or else with the default: the first model that can chat, unless `models.withDefault(role)` names another. `connect()` rejects if a mind names a role no provider holds (`onLog` can print why). `director.models.infer` times every request, and `resetInferStats()` starts it again.

```ts
director
	.addLMStudio({ baseURL, load, models: {
		main,
		quick: { ...main, thinking: false },
	} })
	.addWllama({ models: { local: Skaldic.Laya } }) // a string is short for { id }
	.addJev();

director.getLMStudio()?.removeModel('quick').addModel('quick', newID); // an id
director.getLMStudio()?.addModel('quick', { id: newID, thinking: false }); // or a spec with one
```

| | |
| --- | --- |
| `addLMStudio({ name?, baseURL?, load?, …, models? })` | LM Studio, provider `lmstudio` unless `name` says otherwise. Defaults to `http://127.0.0.1:1234/v1` and loads models with flash attention. Pass `baseURL: '/inference/v1'` when a page proxies LM Studio. |
| `addOllama({ name?, baseURL?, …, models? })` | Ollama, provider `ollama`. Defaults to `http://127.0.0.1:11434/v1`. |
| `addHttp({ name?, baseURL, …, models? })` | Any OpenAI-compatible server, provider `http`. |
| `addWllama({ name?, loadingBar?, models? })` | Models that run in the page on WebGPU through wllama (`@wllama/wllama`, an optional peer dependency: llama.cpp's server compiled to WebAssembly), provider `wllama`. A model's id is one of ArcDirector's own, `Skaldic.Gemma4E4B` or `Skaldic.Laya`, or a GGUF's URL (see below); without one, Skaldic Gemma 4 E4B. Each starts downloading as it is added. `loadingBar` shows a plain bar in the page for each download: the model's name, a `<progress>` and what it is doing ("Downloading 1.2 of 4.6 GB", "Loading on the GPU"), gone once it is loaded, or the reason it failed; in a small panel in the bottom-left corner, or in `loadingBar.parent`. For your own bar, subscribe to the download (`BrowserProvider.shared.download(model)`). |
| `BrowserProvider.shared` | The page's browser models, which the host sets once with where it serves `wllama.wasm` ([see below](#browser-models-and-wllama)). It is kept across directors, so a loaded model outlives them. `download(model)`, `isCached(model)`, `delete(model)` and `keepOnly(models)` (deletes every other download, so models a game stopped offering free their storage) work without a director, for example on a settings screen, and `BrowserProvider.unsupported()` says why this browser can't run them and how the player can fix it (a short first line, then the fix), or null. |
| `addFake({ name?, chat?, embed?, pick?, vision?, models? })` | Canned replies for tests, provider `fake`. Its model ID is `fake`. `chat` is a `FakeChatFn` (from `arc-director/testing`); by default it replies with a canned `go_to` to a PascalCase name. With `pick` it is a System One instead (see below). |
| `addProvider(provider)` / `getProvider(name)` | Any provider, any time, in place of one with its name. Your own transport (`chat` / `embed`, an `InferenceProvider`) is wrapped, `new ModelProvider('mine', transport).configure({ models })`, and another director's provider is shared as it is, `addProvider(other.getLMStudio()!)`, so its models are not looked up again (a bench's many short-lived directors on one setup). A provider holds its transport, its models and their slots, and nothing of a director's: each director logs and times its own requests. |
| `get*(name?)` | The provider by that name (each kind's own by default), typed: `getLMStudio()`, `getWllama()`, `getFake()`, …, or undefined. |
| `models: { role: id \| spec }` | Each `add*` takes its models by role. Calling an `add*` again with the same name sets them anew, in place: a model whose id did not change stays loaded, and roles it leaves out are dropped (a provider whose server settings changed is replaced). `provider.addModel(role, id \| spec)` and `removeModel(role)` change one at runtime. A spec is `{ id?, embedding?, contextLength?, thinking?, thinkingBudget?, sampling?, reasoningEffort?, maxParallel?, batchWait?, prompt? }`. `sampling` is how it picks each token, `{ temperature?, topP?, topK? }`, set by set over what the model's makers recommend: `recommendedSampling(id, thinking)` knows the main families (Gemma: `{ temperature: 1, topK: 64, topP: 0.95 }`; Qwen3 thinking: `{ temperature: 0.6, topP: 0.95, topK: 20 }`, …), so a menu may set only the temperature. What neither sets is `DEFAULT_SAMPLING`'s, `{ temperature: 1, topP: 0.95 }`, which every OpenAI-style server takes, and `topK` is only sent when set. `sampling(name?)` says what a model runs with, every setting filled in; `warmUp(name?)` loads it now with a request a token long. Greedy decoding is not the default, since it makes a thinking model repeat one thought until its budget runs out. System One always decodes greedily, as a request may (`ChatRequest.sampling`). `thinkingBudget` caps a thought in tokens: past it the server stops, and the mind answers from the thought so far without thinking again, for models (Gemma 4) that only switch reasoning on or off. `maxParallel` (default 4) caps how many thinks, and other requests, run on this model at once. With `batchWait` (default 20 wall-clock seconds), once a slot frees while others still generate, new thinks wait until the model is idle or that long has passed, and start together, because a new prompt's prefill stalls decoding for the rest; `0` fills a free slot at once. `prompt: 'compact'` (default `'full'`) is for a model trained on ArcDirector's prompts: its minds are not told the rules and hints that are the same in every game (the watch language, how to look things up and join steps, the stock verbs' help), only what this game and character make their own (its verbs' signatures and its own verbs' help, tools, notes, persona, laws, sight), so each prompt runs about a third as long. `id` defaults to the provider's pick (for LM Studio, the loaded chat model that `modelGrade` ranks highest). If no provider holds a chat model, connecting adds the first one's pick, named after it. `embedding: true` makes it the one model that every memory and recall query is embedded with, so memories stay comparable whichever model a mind thinks with; two is an error, and without one recall matches text. |
| `getModel(role?)` | That role's model (or the default's) once its provider answered: its `id`, `maxParallel`, `sampling` (every setting filled in), `contextLength`, …; undefined until then. `models.warmUp(role?)` loads it now with a request a token long. |
| `withMind({ arcFormat })` | How minds write an Arc: `'text'` (`go_to(Keep) && wait()`, read forgivingly), `'json'` (`{"steps":[…]}`) or `'schema'` (the default). `'schema'` is the same JSON, but the server must follow a fixed reply schema: a think goes to `/v1/chat/completions`, and tool calls are replies such as `{"tool":"recall","query":"Bread"}` rather than native calls. Collectives follow the format too. A mind's own `arcFormat` setting wins over it; a change reaches every mind on its next think, and `mind.arcFormat` says which one it writes. |

#### Browser models and wllama

A browser model is the URL of a GGUF, pinned by putting a commit in it (`https://huggingface.co/org/repo/resolve/<commit>/model.gguf`). A browser holds no file over 2 GB, so a bigger model is split (`llama-gguf-split --split-max-size 1G model.gguf model`) and named by its first part, `…-00001-of-00004.gguf`; the rest load with it. ArcDirector's own models, trained on its prompts, take one line: `addWllama({ models: { main: Skaldic.Gemma4E4B } })` (Skaldic Gemma 4 E4B, the default browser model) or `addWllama({ models: { local: Skaldic.Laya } })` (Skaldic Laya, a decision model: a System One on its own engine, `BrowserProvider.decisions`, so the chat model stays loaded beside it). Each is pinned to its release (`SKALDIC_BROWSER_MODELS`; `browserModelURL` gives the URL). The model is llama.cpp's own server in the page, and requests reach it through `HttpProvider`, as any OpenAI-style server's do (`inPageFetch` is the `fetch` between them), so the schema, sampling, thinking and its budget work as with LM Studio. It answers `maxParallel` thinks at once, batched as `llama-server --parallel` does, each with the whole `contextLength`, so its context in memory is their product. A `thinkingBudget` is the engine's own: it ends the thought there and answers in the same request. Each think reuses what earlier ones read: every mind's system prompt is the same rules first and who it is last, so a free slot already holds most of any prompt, and sliding-window layers (Gemma's) keep their whole cache (`swa_full`), at more memory, so a cached prompt stays usable after a reply. Prompts are read 1024 tokens a pass. Serve the page cross-origin isolated (`Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: credentialless`), or llama.cpp runs on one CPU thread beside the GPU, which slows every token. The host serves `wllama.wasm` from the installed package, so engine and code match, and says where once: `BrowserProvider.shared = new BrowserProvider({ wasm })` (with Vite, `import wasm from '@wllama/wllama/esm/wasm/wllama.wasm?url'`). A `ModelDownload` sends `{ progress, text }` to each subscriber (RxJS's `from()` accepts it), and `done` is a promise. Models with the same id share one download. To suggest a model a player's device can run, `gpuMemory()` estimates its GPU memory from the GPU's name and the system RAM (null when the browser hides them), and `fittingModel(models, memory, spareGB = 1)` picks the biggest of `{ memoryGB }` models that leaves that much over for rendering. Minds write their Arcs in any format with a browser model.

```ts
// A loading bar on screen while it downloads…
const director = new ArcDirector()
  .addWllama({ loadingBar: {}, models: { main: Skaldic.Gemma4E4B } });
// …or your own, on the download itself (an Observable with a `done` promise), which models with one id share.
BrowserProvider.shared.download(DEFAULT_BROWSER_MODEL).subscribe({ next: ({ progress }) => bar.style.width = `${progress * 100}%`, complete: () => ready() });
```

**System One** models are fast models that pick one of a `choose` step's arcs by name; they never write arcs. The director keeps them by role. A spec's `systemOne` assigns one, and a runner without an assignment uses the default. A runner left with none never sees `choose`.

| | |
| --- | --- |
| `addJev({ name?, baseURL?, model?, headers?, fetch? })` | TypeSafe's Jev, a provider and System One named `jev` unless `name` says otherwise. It posts `{ state, model, questions: { pick: { type: 'choice', … } } }` to `baseURL`, which defaults to `/systemone`: a page proxy that adds the API key, so the library never reads the key. `model` defaults to `jev-latest`; pass `headers` when there is no proxy. Any System One endpoint works, including LM Studio's `/v1/systemone`. A `baseURL` ending in `/decisions` is asked in OpenAI's Decisions format. |
| Any role | Any model role is a System One by its name (`systemOne: 'quick'`). A decision model (LM Studio's `decision` type, e.g. `ggml-org/Laya-GGUF`, or Skaldic Laya in the browser) is told by the catalog, answers through its System One endpoint, and is never the minds' default. Any other model is a chat model that scores the choices: they are sent as lettered options, the answer is a single token with reasoning off, and the listed letter it scores highest wins (by its log probabilities, or by the letter it answered when the server returns none). A role on the chat model's own id (`local: { ...main, thinking: false }`) shares its slots and never causes a reload. |
| `benchSystemOne(systemOne, cases?, { repeats? })` | The ArcSelector Bench: how well a System One decides. By default it runs `DECISION_BENCH` (tactics, survival, social, puzzle). Every choice of a case is rated from 0 to 1 (`ratings`): 1 for the best, something between for one that still helps, 0 for one that fails or does harm. Each case is asked with its choices in both orders and scores the worse of the two picks' ratings, so a model that always favors one slot earns only its worst choice's rating. A case is a success when both picks are the best, harmful when either is rated 0, and neutral between. It reports the mean rating per skill and level, the mean time per pick in milliseconds, and failures. |
| `models.withDefaultSystemOne(role)` | The System One for runners that have none of their own. |
| `choiceQuestion(id, choices, { doing?, last? }?)` | What `id`'s System One would be asked now to pick among `choices` (arcs or arc text), worded as `choose` words it: `{ state, criteria }`, or undefined when no choice can run. `doing` and `last` stand in for the verb it runs and its last choice. For previews and training data. |

Every `add*` works before or after the first tick, and adding the same name again sets that provider anew.

**Benches** (imported from `arc-director/bench`; the scene simulator they play, `SceneWorld`, `playScenario` and the rest, comes from `arc-director/testing`) score models on scenes with known right answers, from easy to hard. Each trial is a `BenchOutcome`: a `success`, `neutral` (no success, but no worse off than doing nothing), or `harmful` (worse off than doing nothing; a failed trial too). A trial that gives partial credit returns a `BenchRated` instead, its outcome with a `score` from 0 to 1; otherwise a success scores 1 and anything else 0. A `BenchScore` holds, per skill, per level and in `total`, the trials right and harmful and the mean score (`mean`): doing nothing scores 0. Each bench has a version (`DECISION_BENCH_VERSION`, now 2, and `ARC_BENCH_VERSION`, now 2), raised whenever its cases or how they are asked or played change, so compare only scores of the same version. With `repeats` above one, each case runs that many times and `se` is the standard error of that share, from how much each case's own outcome varied: how far another run of the same model would likely land. The score also keeps the mean think time, the run's wall time, and the sampling the model ran with. `runBench(trials, { repeats, parallel, warmUp })` runs any trials this way.

`benchArcs(models, cases, { repeats?, parallel?, onTrial? })`, the ArcDirector Bench, scores chat models on writing arcs that reach a goal; `ARC_BENCH` holds its cases (chain, trade, social, lookup, questing, reactions, fight, tactics, economy, planning). Each case plays in a fresh director, which `models(director)` sets up just as the host would for play (`addLMStudio`, `withMind`, …), so the model reads the same prompt it would in play. Its arc then plays out in a `SceneWorld`, a small world the stock verbs walk, trade and hand items around in, while the case's `act` moves the others. As in play, the mind thinks again on how that went while the goal is not reached: two thinks in a minute of play unless the case says otherwise, timed by the thinks alone. The case's `done(world)` decides: any arcs that reach the goal are a success, whatever their steps. Short of it, the scene is weighed against the same case played with the character doing nothing, at the same moment: more of its side down, or something it held gone with nothing got for it, is harmful, and so is anything the case's own `harm(world)` flags; anything else is neutral. Every case carries its `solution` and the `naive` move a weak model makes first, and with a squad what its commander would do `alone`; the bench's tests prove each case winnable and lost to every `BASELINES` trick (`baselineArc(case, baseline)`: doing nothing, everyone attacking the nearest foe, the commander alone, the naive move), so no case gives points for free.

In a lookup case, what the goal needs is out of sight, so only `see_map` or `recall` finds its name. In a questing case, the job is in the NPC's memory, sometimes one among dozens of everyday ones, or out of date, or half done already. A reactions case needs a `when` or `law` set up before what it answers happens. Fights play out in a small combat simulation: each fighter is a kind (`FIGHTERS`: Archer, Knight, Cleric, Rogue, …) with health, speed and abilities (`ABILITIES`), and each ability is a verb with its range, damage or healing, cooldown, cast time, splash, and effects such as stuns, roots, shields, taunts and burns. Fighters nobody commands fight by a `tactic` (charge, hold, heal, or blow up among their foes). In a `tactics` case the character commands a `squad`, a collective whose units it gives orders and laws, while idle units hold their ground and strike back at foes in reach, and the battle plays on by their orders after the commander's last think. A scene with `rts` is an RTS (`SceneRTS` on `withRTS`): its units fight with the stock RTS verbs and tactics, and an `economy` case's workers gather, build, train and research by its kinds' costs, prerequisites and supply. A `planning` case adds its own verbs (`verbs`: run on its world, or alias arcs) and a look-ahead tool (`sceneSearch`, on `searchTool`). The world stands still while a mind thinks. The model is looked up and warmed up once (`warmUp`), untimed, and every case thinks over that one connection; cases run as many at once as the model thinks at once (its `maxParallel`), or as `parallel` says, each in its own director. Simulated time costs no real time: each tick yields one turn of the event loop that is never clamped or throttled (`setImmediate` in Node, a `MessageChannel` message in a browser). With `quick`, either bench climbs each skill instead, for a quick check that is not its score: a medium case, then an easy one after a miss or a hard one after a success, so a skill scores 0, ⅓, ⅔ or 1. `playArcCase(case, models)` plays one case on its own, and `pnpm --filter arc-director bench --model <id>` plays the cases with a model on LM Studio from the command line (`--skill`, `--only`, `--show`, `--parallel`, `--context`, `--url`). To write your own cases, `acceptOffer` has someone take the first fair offer made to them, `answerSpeech` has someone answer what is said to them, and `everydayMemories(count)` gives a long-running NPC an ordinary past to bury a job in.

When a runner's own System One fails or names no choice, every decision model (Jev, Laya, …) is asked, in the order they were added, and then the runner's chat model. A System One that failed is skipped for 30 s. Every pick goes to `onLog` under the character's ID: the goal, the state, the choices, the answer and who gave it, the time taken, and every miss. A cast made only of characters with a standing `choose` (no minds, no collectives) can start with `addJev()` alone; anything else needs chat inference too.

Every request goes through its model's slots (`ModelSlots`): a think holds one for all its requests, and a System One's pick, `warmUp`, `thinkNow` and the memory handover go first (`URGENT`). A game's own request takes one too: `getModel(role)!.chat(req)`, or `run(priority, (chat) => ...)` for several; a tool's handler gets its think's own `chat`. `onLog` already wraps chat once (with timings and content), so the host does not need to wrap `chat` itself.

`infer` gives live timings. To change a model's settings, add it again under the same role; a mind never changes them.

**Server options** are `baseURL`, `apiKey`, `enableThinking`, `reasoningEffort` and `load`. The last three are defaults that a model's own settings override. Without `apiKey`, `ARC_DIRECTOR_API_KEY` or `OPENAI_API_KEY` is used.

**Thinking.** Thinking (chain of thought) is off unless `enableThinking` is true. When it is off, the last message is an assistant prefill that skips the reasoning channel: an empty `<redacted_thinking>` block, or the model's Harmony `to=user` header when `applyPromptTemplate` is set (the same method as LM Studio's imageVision plugin). A schema request skips that prefill, because llama.cpp feeds the assistant message to the JSON grammar, and `<` empties its stack.

The reasoning effort is sent as `reasoning_effort` on chat completions (`off` becomes `"none"`, the only value that turns Gemma's reasoning off there) and as `reasoning: { effort }` on the responses API. It is only sent when `/api/v1/models` lists that option for the model: `low` when thinking is on and allowed, `on` / `off` for models that can only switch reasoning on or off, and nothing when the catalog has no reasoning settings for the model. If the context overflows, the request is retried with the effort at `"none"` and a 512-token answer.

**Schemas.** A `schema` request (see the `arcFormat` setting) is specific to LM Studio and llama.cpp: its grammar uses a root `anyOf`, `$ref` recursion and optional properties, none of which OpenAI's strict mode allows. The schema is not counted as part of the prompt when the answer is capped to fit the slot, and the logs show it by name.

**Loading.** A model's first request loads it (on LM Studio) with its own `contextLength`, and a loaded copy that no longer fits its settings is reloaded. Loading through LM Studio's native API reuses a matching instance and unloads any extra copies of it. Parallel thinkers are a cap per model, not loaded copies. Models configured on one server stay loaded together. Anything else that is loaded is unloaded to make room in VRAM, and if a load fails, the models still loaded are unloaded and the load is retried.

`onLog` receives the outgoing JSON **before** each model call (with the message bodies in fenced blocks below it, and images shown as images rather than base64), and then the reply.

### Mind queue

The mind queue decides who thinks next. By default it goes by priority: watch and verb scores, plus how long ago each mind last thought.

| | |
| --- | --- |
| `withPriorityThinkQueue(opts?)` | Highest score first: the default |
| `withSimpleThinkQueue(opts?)` | First in, first out |
| `withQueue(instance)` | Your own `MindQueue`. A director has one queue: each of these replaces it. Every mind moves to it, and starts there as a new mind does. `director.queue` is the one in use. |

`tick(dt)` is **synchronous**. It samples catalogs, ticks the queue, and buffers the minds that are ready. Each ready think then waits for a slot of its model (`maxParallel`, `batchWait`). HTTP requests and `enact` carry on across frames. `dt` is **game time**: the director never reads a clock of its own.

`mayThink` (in the queue options) decides whether a mind may think, based on whether it is idle, its live arc, major events and the watch score (see [Think queue](#think-queue-details)). If a live arc exists and a think is allowed, the director stops that character (`abortArc(id)`: its moves and waits stop, then `onAbortArc` is called) and skips that mind for this frame.

A chat request in flight occupies a slot for that mind's ID. `mind.abortThink()` and `director.queue.abortThink(id)` trip that slot's `AbortSignal`. Removing a character or collective, dropping a mind (on a join, or with `character.mind = …`), `drop`, and vacating a commander's post all abort it as a side effect. A finished reply is thrown away if its slot was aborted before it was enacted.

### Verbs

| | |
| --- | --- |
`withVerbs((v) => …)` configures `director.verbs`, the one registry every character and collective parses and runs with:

| | |
| --- | --- |
| `v.addStock(...verbs)` | Registers stock verbs, which the library runs itself (the world verbs through `withWorld`). With no arguments, it registers all of them; pass names to opt in to a subset (see the groups below). A name that is already registered is skipped. |
| `v.addStockCollective(...verbs)` | Registers the schemas of `command`, `tag`, `untag`, `spread`, `circle` and `hold_line`. Registering them does not grant them; the collective's kit does. |
| `withRPG(host)` | An RPG to start from. Registers each of `equip(item, slot?)`, `unequip(slot)`, `steal(item, from)`, `sit(target?)`, `sleep(target?, seconds?)`, `attack(target?)`, `block(target?)`, `heal(target?)` and `protect(target?)` that `host` gives a handler for, and each of its `abilities` (the game's own attacks and spells) as a verb used on a `target`. A handler may come as `{ help, handler }` when the game's own rules need saying (`guard up 2s`). Registers the stock verbs too; without `withDefaultKit`, characters get them, `offer`, and these. |
| `withMOBA(host)` | A MOBA to start from: its heroes' `attack`, `block`, `heal`, `protect` and `abilities`, registered as `withRPG` registers them. Its default kit has no `offer`. |
| `v.add(name, { args?, help?, seen?, handler? })` | Registers a verb's schema and, optionally, the function that carries it out in the world. `seen` is how others see one running it, with `{arg}` holes (`going to {target}`); without it, the verb with `-ing` (`firing`). Sight shows it after a seen character's health (`Kell (20/20 hp, firing)`), and a sound its maker makes while seen is not told again. The handler's `args` are typed from `args` (`{ item: 'id', offer: 'number?' }` gives `{ item: string; offer?: number }`); a stock verb's args are typed from its stock args. `help` is one line shown after the verb in the prompt's verb list (`shoot(target) — needs a clear line of sight`); stock verbs have theirs too. Adding the same name again binds or replaces the handler, and a host handler replaces a stock one. `v.addAlias(name, { args?, help?, arc, watch?, who?, rearm? })` is a verb that runs an arc (see Laws). |
| `v.remove(...names)` | Removes the named verbs' schemas and handlers. Missing names are skipped, and calling it with no names does nothing. |
| `withDefaultKit(kit)` | An object or a `(ctx) => kit` function, used when a character or collective spec has no `kit` (a collective's characters included). Like any kit, it is fetched every tick. |
| `v.withGate(fn)` | Runs before every host verb, with the full `VerbCall`. Return a result to refuse the step (during a cutscene, or after a fight is won); return `undefined` to let it run. |
| `onVerb(fn)` | On the director: a catch-all for verbs that have no handler of their own. The one `on*` that sets rather than adds, since it answers how the step went. |

Pass these groups to `addStock` spread out, as in `v.addStock(...STOCK_MOVE_VERBS)`:

- `STOCK_MOVE_VERBS`: `go_to`, `follow`, `flee`, `wander`. `go_to(target)` walks into reach. `follow(target, distance?)` never ends on its own: it keeps within `distance` of them (default: arm's reach), closing in again whenever they get farther. `flee(from, distance?)` takes the cheapest route out of range that keeps well away from them, and ends once it has stayed `distance` away for 3 s. `distance` defaults to the kernels' `nearRadius` (what `nearby()` counts); if there is none, `flee` fails and asks how far.
- `STOCK_ITEM_VERBS`: `use`, `pick_up`, `drop`, `give`, `examine`.
- `STOCK_MIND_VERBS`: `say`, `wait`, `pass`, `remember`, `think`, `set_goal`, `drop_goal`, `finish_goal`, `set_identity`, `watch`, `unwatch`, `focus`, `unfocus`.
- `STOCK_ARC_VERBS`: `if`, `law`, `unlaw`, `when`, `loop`.
- `choose` (`CHOOSE_VERB`) comes last in `STOCK_VERBS`. It is withheld from any character or collective without a System One.
- `STOCK_TRADE_VERBS`: `offer`. It is registered with the rest but left out of `STOCK_VERBS`, so a kit only grants it where there is trade.

The verb catalog is shared (`director.verbs`). What a character or collective may use is its **kit**, which is fetched every tick: either a plain object (mutate it, or use getters) or a `(ctx) => kit` function. Registering a verb does not grant it. `withDefaultKit` is the usual grant, and a spec's `kit` overrides it. Fetching the kit every tick is cheap, but **changing** what it grants is not, because the verb list is part of the prompt prefix (see [Prompt prefix](#prompt-prefix)).

```ts
type Kit = { verbs: readonly string[]; senses?: readonly string[]; tools?: readonly string[] };

director.withDefaultKit({ verbs: STOCK_VERBS });
director.addCharacter({ id: 'Holt', mind: {} }); // default kit
director.addCharacter({ id: 'Baker', mind: {}, kit: vendorKit }); // same object; mutate later
director.addCharacter({ id: 'Cook', mind: {}, kit: (ctx) => kitFor(ctx) }); // callback
```

Every character and collective needs a kit, either its own or the default one, and a fixed kit must name some `verbs`; otherwise the cast cannot be wired (`connect()` rejects). A collective's kit is what its mind may write. Each of its characters runs steps with its own kit, and the roster tells the mind what each one cannot do. Leaving out `senses` or `tools` means all registered senses or tools, and `[]` means none. Wiring also fails if a kit grants a stock world verb whose `withWorld` part is missing (and no host handler or `onVerb` covers it), or names a verb, sense or tool that is not registered. `recall` and `observe` are always registered, `earshot` is registered with talk, and `see_map` with a map and vision.

**Senses** are always in the user message, written in English (the `scene`, what is carried, events). **Tools** are called on demand (`recall`, `observe`, `see_map`). A kit's `senses` and `tools` lists only allow some of what you registered; they do not add anything new.

The prompt, the JSON schema and parsing all use the kit of the mind's owner. A step whose verb is not available fails closed. `character.verbs` is the catalog; `character.activeVerbs()` is what the character may use this tick. Assign `character.kit` when the grant actually changes, not every frame.

Handlers receive a `VerbCall`: `{ verb, args, character, ctx, signal, score, holds, goTo, goToPoint, wait }`. `character` is who runs the step, and `ctx` is `withContext(character.id)`. A step whose character has no context fails with `not in this scene` before any handler runs.

A collective without a commander has no body. Its mind is offered only its own verbs and `wait` (which runs on the director's clock), and any other host verb fails with `you are not a character in this scene; command one of your characters to <verb>`. Its tools and articles look out from its first character in the scene, and it gets no earshot, since it never speaks.

A formation lines up `character.squad`: the characters that were last issued a program together, this one included. The arc running now is `character.arc`, at step `character.verbIndex`; the mind's last arc is `mind.lastArc`.

The library does the mind's half of every verb, so handlers only need to change the world:

- **`id` args are real IDs.** The model may write its own name for a character (see [Names](#names)) or an expression that picks one (`cleave(others.filter("enemy").minBy(u => u.hp))`). The mind turns names into IDs as it reads the reply, and an expression becomes the ID it picks. An expression that picks no one fails with that reason before the handler runs. Plain names the library does not know are passed through for the host to judge (`no such place Cottag`).
- **`until=` and `within=` are the runtime's, on every verb.** `until` is a watch that stops the step once it holds (the step is then done); `within` is game seconds after which it stops (the step then failed, `until not met after 20s` or `not done after 20s`). Neither is listed in a verb's help, and `replySchema` offers both on every verb. A verb that is stopped so sees `call.signal` abort (its reason `'until'` or `'within'`), its moves and waits end at once, and a verb that can still say how it went returns that, as `wander` does with what it saw. A verb declares `until` itself only to read it, as `wander` steers by it and `wait` fails when its time runs out first.
- **`watch` args are checked, then asked.** Bad syntax or leftover English (`filter("trees")`) fails before the host runs. `call.holds('until')` tells you whether the watch holds now, and `call.score('until', point)` asks how well it would hold if this character stood at `point` (this is how `wander` picks where to go).
- **Moving and waiting are the library's job.** `call.goTo(target, { within?, check?, crowd? })` moves this character into reach of `target` (or `within` that far), following it as it moves, and stops sooner once `check` returns a reason. `call.goToPoint(at, { within? })` moves it to a point, and `call.wait(seconds)` lets game time pass. All three end, `stopped`, when the step is aborted. A host verb that needs to be somewhere first (`steal`, `heal`) awaits one of them, and keeps only its own rules.
- **Verbs internal to the mind never reach the host:** `remember`, `think`, `set_goal`, `drop_goal`, `finish_goal`, `set_identity`, `watch`, `unwatch`, `focus`, `unfocus`, `say` when a TalkNet is attached, and `wait`. `wait` lets game time pass until `seconds` is up (default 1, or 20 with `until`, which then fails it; with a `within` and no `seconds`, as long as that allows), the runtime ending it once its `until` holds, and an aborted arc ends the wait. Only bind your own `wait` handler if waiting must do something in your world.

The argument kinds are `id`, `string`, `text`, `watch`, `expr`, `law`, `number`, `count`, `string[]`, `bundle` and `arc` (add `?` to make one optional), each given as the kind or as an `ArgSpec` (`{ kind }`). A `bundle` is `{ [item: string]: number }`, and a `count` a whole number or `true` for no limit. An `expr` is any other expression (`command(who=units.filter("Archer"))`), and a `law` is a law's name. A mind stores every `id`, `watch`, `expr`, `law` and `arc` argument in IDs. `text` is prose: unquoted, it runs to the closing `)` or to that verb's next `, key=`, so commas and apostrophes need no quotes (`say(Hello there, BridgeKeeper's friend, to=Player)`). Use it for any argument a model fills with a sentence.

### Perception

Senses go into the user message on every think, and tools are called on demand. `withSenses((s) => s.add(name, sense))` and `withTools((t) => t.add(name, spec))` replace any sense or tool with the same name, and both reach every mind at once, after the first tick too.

| | |
| --- | --- |
| `withSight({ look, limit, unitName })` | The stock sense `sight` (`SightFeature`). `look` returns a `Sight` made of `SeenObject[]` (with `point` vectors). `limit` is the default maximum number of sight clauses (phrases that `formatSight` cannot merge any further), kept in `sightFocus` order; a spec's `sightLimit` overrides it. `unitName` is the unit sight gives distances in (`m`, `pace`, `foot`), and defaults to `pace`. Called again it configures the same feature: a scene may set only the cap. Without `limit` there is no cap. Three tags in a `SeenObject`'s `tags` mean something to sight (`RESERVED_TAGS`): `character` (someone who acts: listed first), `landmark` (fixed: what other things are placed relative to) and `item`; none of them is folded into a crowd phrase. |
| `withInventory(look)` | The stock sense `carrying` (`InventoryFeature`). The callback returns an `Inventory` bag. The list ends by saying that nothing else is carried, so a role that often carries something does not suggest it carries it now. |
| `withKnowledge({ pages, mentions? })` | What minds know about the world (`KnowledgeFeature`). `recall` searches these articles alongside memory (see [Knowledge](#knowledge) below). |
| `withSenses((s) => s.add(name, (ctx, mind) => text))` | A sense of the host's own; returning `undefined` leaves it out of that think. |
| `withTools((t) => t.add(name, spec))` | A tool of the host's own. `spec` is `{ description, parameters, offered?(mind), handler(ctx, args, mind) }`; `offered` says whether it can work for a mind (`see_map` for a model that sees). `director.tools` holds the built-ins first (`recall`, `observe`, `earshot`), then features' (`see_map`; knowledge replaces `recall`) and the host's in the order added. A mind's prompt and reply schema list only the tools it is offered, less what its kit's `tools` leaves out. |
| `t.add(name, searchTool(spec))` | A tool that looks ahead in a game for the mind that calls it (`chess_move`, `plan_build`): the best moves from where it stands, each with its chance to win and the line expected after it. `spec` (a `SearchSpec`) gives the state as its caller knows it, the moves out of any state, and how good a state is; the game computes, the model decides. |
| `s.remove(...names)`, `t.remove(...names)` | Missing names are skipped, and calling it with no names does nothing. |

`Sight.self.id` is the character's name. What light does not reach from where it stands (`canPass('light', …)`) is dropped from what `look()` returns, but for objects everyone sees (`always`); without `canPass`, all of it is seen. Who a character notices at all (a player hidden from NPCs) is `look()`'s own call. Without `withTools`, the host adds no tools, but the built-in `recall`, `observe` and `see_map` still appear when their features are on.

**Leftover English** is the plain words sight uses for unnamed things in a group, like `trees` or `house`. They are not names, so watches and verbs refuse them and point to the right name instead.

#### Knowledge

`withKnowledge({ pages, mentions? })` gives minds articles about the world. `pages` is `{ name, aliases?, text }[]` or `(ctx) => pages`. `recall` searches the articles alongside memory and returns `{ remember, know }`, with at most 2 articles, so a mind knows the world the same way it remembers it.

Articles also come to a mind unasked. When a name or alias was said or heard recently, its article appears under short-term memory: at most `mentions` per think (default 2, or 0 for none), and the same article not again for 5 thinks. Mark the things a character can carry with `item: true`. Their mention then always says whether this mind carries one ("FireMushroom (you carry none)"), so a claim made in talk sits next to the truth for both speaker and listener. A name in a failed verb's reason also brings its article in, under that result.

`crowdKnowledge({ name, tag, inside })` builds an article for a crowd of leftover things from `formatSight` (a bunch of them around you). Query leftover English (`trees`, `house`) or a place someone mentioned (`forest`) to find the Capitalized type. An empty query lists the known topics. Articles stay out of the standing prompt prefix.

### Context and kernels

The library knows characters and collectives by **ID**, and a mind goes by its owner's ID. The library does not know your `World`.

- **`withContext((id) => ctx)`** gives the context a character acts in. Its type is `TCtx`, and it holds whatever the game wants. Senses, kernels, kits and verb handlers all receive it. A mind senses through its voice's context. Generic parameters follow one rule: they start with `T` (`TCtx`, `TEntity`, `TArgs`), so a slot the host fills never reads like a library type.
- **`withKernels((ctx, point?) => kernels)`** gives what a mind knows for its watches (`me`, `others`, `items`, `isHurt(me)`, `inventory`). When `point` is set, a verb is asking what would be true if this character stood there, so answer as if it did (who it would see from there, for example). The library always calls `buildCatalog`. The director owns each character's `SampleCache` (it overwrites `cache`, so you do not set it). It also overwrites `hasHeard` and `prev` from that mind, fills `canSee` from light passing (`canPass`) when your kernels leave it out, and overwrites all geometry (`distance`, `nearby`, `isFacing`, `isLeft`, `pathDistance`, `manhattan`, …) from the `withWorld` poses and routes, so kernels never measure space themselves.

Verbs need objects and watches need measurements; the same `ctx` serves both.

### World

`withWorld(world)` describes the game's world the way the stock verbs need it. `TEntity`, the director's second type argument (`new ArcDirector<CharacterCtx, GameObject>()`), is the game's own type for things in its world (a GameObject, an ECS entity, a record); the library never looks inside one, and `director.world` keeps it. `find(id)` **is the only place an ID becomes an entity**. Every other part receives entities, so the game never looks anything up twice. When `find` returns `undefined`, the verb fails with "no such …" or "… is gone" before any other part is called. Things that change hands stay IDs (a `Transfer`'s `thing`, `useItem`'s item, and `examine`'s target), because which Bread is meant depends on whose pack it is in, and that is the game's call.

**Queries** (`find`, `get…`, `isDown`, `canTraverse`, `canPass`, `canOffer`, `canPickUp`, `validateTransfer`, `up`) only read the world, and may be called at any time, often. **Commands** (`steerToward`, `transfer`, `useItem`) change it. Each part unlocks some verbs:

| Part | Kind | Unlocks |
| --- | --- | --- |
| `find(id)`, `getPose(entity)` | query | Watch geometry: `distance`, `nearby`, `isFacing`, `isLeft` / `isRight`, `manhattan`, … |
| `getNeighbors(node)`, `steerToward(character, point)`, and optionally `canTraverse(character, from, to)` and `getNearby(point)` | query, command | `go_to`, `follow`, `flee`, `wander`, the collective formations (`spread`, `circle`, `hold_line`), `pathDistance` / `isReachable`, `call.goTo` |
| `getDescription(character, target)` | query | `examine` |
| `isDown(id)` | query | Tells the fallen from the gone. A collective's `units` and roster leave out a character that is down (dead, knocked out, destroyed) and its prompt lists it under `Down:`; a verb aimed at it fails with "… is down", not "… is gone". Without it, a member stays on the roster until the game calls `removeCharacter`. |
| `canPass(medium, a, b)` | query | What sight sees, the watch functions `hasSightline` / `hasJustSeen` / `hasLostSight`, and which sounds are muffled (`withHearing`). Without it, nothing blocks sight or sound. |
| `transfer({ character, thing, from?, to?, quantity? })`, and optionally `validateTransfer(move, deal)` | command, query | `pick_up`, `drop`, `give`, `offer` |
| `useItem(character, item, target?)` | command | `use` |

- **Positions and directions are arrays of numbers**, in world space, with however many dimensions the game uses: `[x]`, `[x, z]` or `[x, y, z]`. A position is always called `point`. A direction is named for where it points (`facing`, `right`, `up`) and is a unit vector. `getPose` returns `{ point, facing?, right? }`, so left and right mean whatever the game means by them. A 3D game can set `up` (default `[0, 1, 0]`) for formations.
- **Earshot is not reach.** Someone can be within talking range and still out of reach (across a river, or on the phone). The earshot sense marks them with the same blockers a failed move names: `Angler (unreachable, blocked on the way: Bridge is raised)`. A failed move remembers whom it could not reach (`ArcResult.unreachable`). An arc that opens with the same verb toward them is refused in the same think while the way is still blocked, and goes through once it opens. A think whose reply never became a valid arc, even after repairs, runs nothing whose end would wake the mind again, so the mind thinks again, with `think failed — your reply was not a valid Arc: …` as its last result, or `… your plan cannot run: …` when the arc was well formed but the world rules it out.
- **Routes are the library's job; what stops what is the game's.** Three parts split it: points near coordinates, the graph, and what a step costs. `getNeighbors(node)` is the shape of the world: the nodes one step from a node (grid cells, navmesh polygons, a weighted network of waypoints, a line), the same whoever asks and whatever is open, and only nodes someone can step to. `getNearby(point)` gives any position as a node at exactly its coordinates, never moved, with every node it links to: a route starts there from where the character stands, and ends there on the destination. Without it, a position is its own node and links to its `getNeighbors`. `canTraverse(character, from, to)` is the step the character takes from a node to its neighbor, so its size and what it carries count: a child fits a gap a knight does not, and a locked door names the key it carries. It returns `{ weight }` for an open step, `{ blocked, by? }` for one something stops for now, or `undefined` for none; without it, every step is open. The library runs A* over the steps: a route leaves through the steps out of where the character stands, and ends through the steps into the destination. A step is asked the way it is walked, so a ledge you may drop off but not climb, or a destination inside a wall, gives no way in. A waypoint network links any position to the waypoints in sight of it. A step costs its length times its `weight`, which defaults to 1 and counts as 1 when less; raise it to route around crowds or rough roads. Nodes may be the game's own type (`HostWorld<TEntity, TPoint>`), coordinates with its own fields on them, such as the tile a cell is: the search hands back exactly the nodes `getNearby` and `getNeighbors` returned, so the game looks up only in `getNearby`. A `blocked` step ("EastDoor is locked — you carry IronKey") is avoided. When there is no open way, the move fails, naming every blocker on the way there, cheapest first, so a mind facing two locked doors learns about both and can pick the one it has the key for. In the reason, say what this character could do about it. Nothing standing at `from` stops it.
- **Sight and sound are the game's too.** `canPass(medium, a, b)` says how clearly a medium goes straight from `a` to `b` across a room, for any two points: 1 clear, 0 blocked, between for fog or a half-shut door (for now anything above 0 passes). The library asks `'light'` (sight) and `'sound'` (hearing). A game adds its own media for its own verbs by declaration merging, and its `canPass` answers them too: `declare module 'arc-director' { interface Media { smell:true } }`. Nothing standing at `a` or `b` stops it, so no one hides themselves or the one looking.
- **The library moves characters; the game animates them.** While a character moves, `steerToward(character, point)` is called every tick with the position of the next waypoint (never a direction), or with `null` to stand still. It returns whether the character has reached `point`, by the motor's own measure. Speed, collisions, animation and how close counts as arrived all stay in the game, so the library needs no notion of units. A character that makes no progress gets a new route, and then fails with `stuck`. Without `getNeighbors` and `steerToward`, characters do not move, and `call.goTo` only succeeds when the character is already in reach.
- **`getReach(character, target)`** is how close a character must be to act on `target` and to count as being there (default 1). A building can return its half-width, so that arriving inside it counts.
- **Crowds share a character instead of piling onto it.** When several characters are bound for the same character, each move takes a `Crowd`. With `line`, the first goes in and the rest queue one behind another, `spacing` apart, out along the way the target faced when the line formed (`getPose`'s `facing`). Each moves up when the one ahead is done, and waits its turn even in reach. Use it for whoever serves one at a time, such as a vendor. With `ring`, each takes the nearest free place round the target, just inside reach, and anyone past a full ring waits in the next one out. A place stays taken while its taker stands in it. Use it for many at once: a foe, or a speaker. With `none`, each goes straight in. A crowd place it has no way to reach sends that character straight in. Three levels set it, and each overrides the ones after it: a move's own `call.goTo(target, { crowd })`, then the target character's spec `crowd` (`'line'` on a vendor), then the director's `withWorldVerbs({ crowd: { crowd?, verbs?, spacing? } })` by the verb that moves them (`{ crowd: 'ring', verbs: { offer: 'line' } }`). `withRPG` sets `ring`, with `line` for `offer` and `give`. Otherwise, as with `withRTS` and `withMOBA`, the default is `none`. A move to a thing or a point takes no crowd unless it names one.
- **Trades are offers, and nothing changes hands until one is taken.** `offer(to?, give?, get?)` names what this character hands over and what it wants back, each as a bundle (`{"gold":5}` or `{"Egg":12, "Milk":3}`). If `to` already offers that or better (in an offer made to this character, or else a standing one), the character walks until both are within each other's reach (`getReach`, default 1) and it may make an offer to them (`canOffer`), and then both sides change hands on the maker's terms, as one deal (see below). Otherwise the offer waits, and a major event wakes `to`'s mind with the reverse offer that would accept it; other terms make a counter-offer. A new offer to the same character replaces the last one, and an offer with both sides empty withdraws it. Without `to`, it is a standing offer to anyone, which can be taken in any whole multiple while stock lasts (a `Loaf` for `5 gold` sells three for 15). A new standing offer of the same goods changes the price. Seed standing offers with a character spec's `offers`, or with `director.offers.post(...)`. `director.offers` (an `OfferBook`) is saved with `exportCast`.
- **`canOffer(character, other)`** decides who may make an offer to whom. Without it, `other` must be in `character`'s sight (`withSight`), or else light must pass between them (`canPass`). An offer to someone only stands while this holds. Every mind whose kit grants `offer` sees, in every prompt under "Open offers", every standing offer and every offer made by or to a character it thinks for.
- **`canPickUp(character, item, from)`** decides what a character may go and pick up. `from` is where the item is: the item itself where it lies, or what holds it (a chest). Without it, the character must see `item` there (`withSight`; a sight row `in` a holder is held by it), or else light must pass between it and `from` (`canPass`). Return `true` to let characters fetch what they cannot see. `pick_up(item, from?)` takes from `from` when the model names it, else from where the character sees the item (loose before held), else from `find(item)`. Only a character in the cast takes a gift or a trade (`give`, `offer`), and `pick_up` never takes from one, nor `drop` put into one.
- **Everything that changes hands is a `Transfer`:** `pick_up` (`from`: the item where it lies, or what holds it), `drop` (`to`: what it is put in, such as a chest; left out, it is put down), `give`, and each side of a trade, one move per thing. A thing is whatever the game lets move: an item, gold, a house, a promise of work. What a name means is the game's call.
- **The game's rules live in `validateTransfer(move, deal)`,** which returns why a move cannot happen ("Chest is locked", "Realtor does not own Bridge", "Mira's pack is full"), or nothing. `transfer(move)` then only makes it: it throws on a real error, never for a rule, and returns how to take the move back. A deal moves whole or not at all: each move is checked and then made in turn, so each is checked against the world the moves before it left, and a refusal or an error takes back every move made, last first. `deal` (a `Deal`) is the rest of it as seen from this move: `pending` (the moves the world does not hold yet), `done`, and `leaving(holder)` / `receiving(holder)`. The world, this move and `pending` add up to the deal done, so a rule on what someone ends up with, such as a pack that may hold one shield, counts them without counting a move twice. Most rules look only at `move`.
- **Some checks are dry runs** (`deal.dryRun`): a directed offer is checked when it is made, and `pick_up`, `give` and `drop` with a `to` before the character walks over, so terms the game rules out are refused before anyone hears them or anyone walks. Nothing moves in a dry run, so every other move of the deal is `pending`. A standing offer, with no one to receive it yet, is checked when it is taken.
- **World rules stay in the game.** `useItem` changes the world and returns `{ ok, reason? }`, and `validateTransfer` returns its reason. Refuse in words the mind can act on, and announce what happened with `pushEvent`, as the game does when the player acts. The library moves the character into reach first, and checks nothing that the game knows better.
- **Stopping a character:** `director.abortArc(id)` ends its moves and waits right away and calls `onAbortArc`.
- **Crowds and group walks:** `withWorldVerbs({ crowd, groupWalk })` (`WorldVerbsFeature`, which every director has) sets how characters bound for the same one share it, and whether a character walks near a group before a verb acts on it.

### Regions

`addRegions({ [name]: spec })` marks a place in the world that does something to the characters in it (`RegionsFeature`). The library checks every character against it each `tick`, using `getPose`, so it needs `withWorld`.

```ts
director.addRegions({
	// Two opposite corners, in any order: a segment in 1D, a rectangle in 2D, a box in 3D.
	Crypt: { from: [0, 40], to: [16, 56], memory: 'This room smells putrid.' },
	// A center and a radius: an interval, a circle or a sphere.
	Pool: {
		center: [8, 12],
		radius: 3,
		memory: 'Cold water laps at your boots.',
		onEnter: (ctx) => splash(ctx),
		onStay: (ctx, stayed, dt) => chill(ctx, stayed, dt),
		onExit: (ctx, stayed) => drip(ctx, stayed),
	},
	// Only for some: a watch, as each character sees the world, or a test of its ctx.
	Lair: { from: [30, 10], to: [40, 20], memory: 'This is our lair.', who: 'me is "Undead"' },
	// On an entity: the ball goes where it goes (an item in a pocket, with whoever carries it).
	LanternGlow: { center: 'Lantern', radius: 4, memory: 'Warm lantern light falls around you.' },
	// Gone once its condition holds.
	Throne: { from: [46, 9], to: [63, 32], memory: 'The king watches from his throne.', until: () => kingDead },
});
```

| Field | Meaning |
| --- | --- |
| `from`, `to` | Opposite corners of a box, in the game's `Vec`s. An infinite number leaves that axis open: `from: [0, -Infinity, 40], to: [16, Infinity, 56]` is a room at any height. |
| `center`, `radius` | A ball. `center` can be an entity's ID instead (an item, a character, anything `find` knows): the ball is placed where `getPose` puts it each tick, and holds no one while it has no pose (everyone inside leaves; the region stays until removed). A character the region is on is inside it too; leave it out with `who`. |
| `memory` | What it is like to be here, or what is going on: pinned in the character's mind (the "Pinned memories" of its prompt) while it is inside, and forgotten when it leaves. Write it as the character would put it. In a collective, the line says who is there: `Tom: This room smells putrid.` It can also be a function, given the character's context as the callbacks are (`(ctx) => …`). It is read once per tick for each character inside, so a function or a getter can change the line while they stay, or return nothing to unpin it. Don't spread such a spec into a new object: the spread reads the getter once and keeps that value. |
| `who` | Who the region is for: a watch evaluated as each character sees the world (`'me is "Undead"'`, `'isHurt(me)'`; needs `withKernels`), or `(ctx) => boolean`, given the character's context. Anyone else is never in the region, and a character the filter stops holding for leaves it. Default: everyone. |
| `until` | `() => boolean`, checked every tick. Once it holds, the region is removed and everyone in it leaves, as with `remove`. |
| `onEnter(ctx)`, `onStay(ctx, stayed, dt)`, `onExit(ctx, stayed)` | Run for each character in the region, with or without a mind, the player too. They get the character's context from `withContext`, as verb handlers do; a character without one is in no region. `onStay` runs on every tick after the one it entered on, with that tick's `dt` (for per-second effects: `hp -= 5 * dt`). `stayed` is how long it has been inside, in game seconds. `onExit` gets the last context it was seen with, since it may have none by then. |

- **A memory is the only thing a region adds to a prompt.** It stays in the prompt until the character leaves, so it works for something lasting about the place, like a smell, the cold or a holy hush. A region adds no event and does not wake the mind, so the character notices the place on its next think. For a moment instead of a lasting state, have `onEnter` call `pushEvent` or `remember`.
- **Saves:** the memory is saved with the cast like any pinned memory. On the first tick after `restoreCast`, every character inside enters again (`onEnter` runs) and its saved memory is replaced, so nothing is doubled. A character that now stands outside loses the memory, and no `onExit` runs, because it never entered since the load.
- **Later changes:** `addRegions` again adds more, a name in use replacing that region, and `director.getRegions()?.remove(...names)` removes regions. Either way, everyone who was inside leaves (`onExit` runs and the memory goes). Regions can be added any time. A character with no pose is in no region.

### Names

By default, every mind calls a character by its ID. `withNames(seen)` lets the host decide what each mind calls each character:

```ts
director.withNames((observer, target) => (
	target.tags?.includes('enemy') ? 'EnemyKnight' : target.id
));
```

`observer` is `{ id, ctx }`: the mind's owner, and its voice's `withContext` result. `target` is what the mind knows about the character: `{ id, tags?, hp?, maxHP? }`, from sight or from kernels. `id` is the only identifier the host provides; return it to call the character by its ID. `seen` returns a **base** name and should be a pure function of its arguments. A name is always one observer's label for an ID, and only the library writes it (`ExprEntity.name`).

Each persona keeps its own name book. The book keeps names stable, numbers duplicates (`EnemyKnight`, `EnemyKnight2`), remembers old names as aliases, and is saved with the persona, because memories quote those names. The library applies it everywhere a name reaches the model: sight, earshot, heard speech, the `see_map` legend, entities and bindings in the watch language, a collective's roster, laws, watches, sight focus, and an event's `who`.

**Arcs, laws, watches and sight focus are stored in IDs.** A mind turns its model's names into IDs as it reads a reply (in `id` args, and the characters named in `watch`, `expr`, `law` and nested `arc` args; prose is never touched), and turns IDs back into its own names in every prompt line that shows them. So handlers and kernels only ever deal in real IDs, and a law keeps working after its character moves to a collective whose mind names everyone differently.

Strangers use the same mechanism. Return `MerchantWithBlueHat` based on the target's tags until the mind has been told the name, and the book keeps that label steady with no bookkeeping on the host's side. Once the policy returns the real ID, the old label stays on as an alias, so memories that quote it still make sense.

Events that mention characters pass real IDs in `who` and refer to them by number in the text. Each mind reads them in its own names and gets them as tags. When a mind's own owner or voice is named in `who`, it reads as "you" (or "You" at the start of a sentence), so write event texts that work in both persons: past tense, as in `{0} gave Bread to {1}`.

```ts
director.pushEvent({ kind: 'Hurt', text: '{0} cleaved {1}', who: ['Brune', 'Helms'], tags: ['hurt'] });
// one party reads "Brune cleaved EnemyKnight", the other "EnemyKnight cleaved Helms"; Helms's party reads "EnemyKnight cleaved you"
```

`director.seen(observerID, target)` gives the same name for text the host writes itself, such as a sight `note`. A sight object's `doing` says what it is doing (`reviving Bo`); left out, a character in the cast shows the verb it runs, in its `seen` words. `observerID` can be a character or a collective.

### Talk and map

`withTalk({ inRange, others, clearHear?, hears?, names?, face?, approach?, onSpoke?, rehear?, repeats? })` sets the talking range and routing, per character, and the library routes `say()`; `face` and `approach` turn and move speakers and listeners toward each other (nobody turns or moves without them); `onSpoke(utterance)` hears every line as it is said:

- A mind hears through every character it thinks for. A collective hears through each of its characters, once per line, from whichever character heard it best. That includes its characters talking to each other; only its own voice's lines are not heard back.
- A line said to, or naming, any of a collective's characters is meant for its mind and wakes it, whichever character heard it. Only a line said to its voice reads as `says to you`.
- A collective never speaks for itself. Its commander speaks, or it issues `say` to one of its characters.
- When an arc's reply verb names another character (`say` with `to`, `give`, `offer`), the actor waits up to 20 s at the end of the arc if that character is still nearby. The wait ends when they finish a verb that is not a movement. Since the wait comes at the end, the rest of the arc still runs first. A step that names no one, such as `say` without `to`, does not wait, nor does a line to a group.
- `say`'s `to` can be a group: an expression that picks a list (`say("Hold!", to=units)`, `to=units.filter("Archer")`, `to=others.nearby()`), minus the speaker and anyone down. The speaker walks to the nearest place within one standard deviation of the group's median center (never less than `getReach`), unless it is there already or everyone makes out its words, then says the line once. Whoever of them is in earshot is addressed, and the result names the rest (`out of earshot: Tom`). A group with no one left fails with `no one left in units`, and an expression that does not evaluate fails saying so. `withWorldVerbs({ groupWalk: (character, verb, targets) => boolean })` decides each time whether it walks at all: a character that does not speaks from where it stands, and its line runs beside its program. A verb of your own takes groups the same way with `group: '<id arg>'` in its definition: it walks first, and its handler receives that arg as `string[]`.
- The `say` result names whom the line was for but who could not make out the words (`heard by Baker; too far for Guard to make out the words: get closer`), and earshot marks them as `too far to make out your words`.
- A `say` whose content words (after stemming) mostly repeat a line that everyone it is meant for has already heard clearly is refused before anyone hears it: "they already heard you say that".
- No parroting. `say` is refused when the line is the same as:
  - the speaker's own last line. The LLM receives this error message: "you already said this, and it was heard … you are not a parrot";
  - the last line the speaker heard from someone else: "Ann just said this, and it was heard … you are not a parrot".

  Case, spacing and punctuation are ignored. `repeats` in `withTalk` decides:
  - `false` (default): refuse every repeat.
  - `true`: allow every repeat (a chant, a password).
  - `(ctx, text) => …`, asked for each line flagged as a repeat, with the speaker's context: `true` allows it, `false` refuses it, and a string refuses it with that string as the error.
- `hasHeard` is only true for speech meant for this mind.

`withHearing({ noise, limit, range, onSound })` lets minds hear sounds, not only speech (it needs `withWorld`). A `Sound` is `{ name, loudness, seconds?, fade? }`: its name in plain words, how loud it is at its source (0–1), and for one that goes on, how many seconds it lasts and how it fades over them (0 steady, 1 dying away evenly, more sooner).

- `noise` gives the sound each verb makes while it runs, stock verbs too: `{ go_to: { name: 'footsteps', loudness: 0.14 }, reload: { name: 'reloading', loudness: 0.09 } }`. The verb's help says how far it carries (`heard as footsteps up to 15 paces`), so a mind knows which of its own deeds can be heard, and from how far. It stops when the verb ends or is cut short, unless the sound gives its own `seconds`. Called again, `withHearing`'s `noise` joins what it had.
- `director.getHearing()?.emit(from, sound)` is any other sound, from a character or thing the world places (it moves with it) or from a point: gunfire, a door, a fireplace. Call it where the game plays its own sound. The same sound made again by the same thing, or at the same spot, replaces it, so a game keeps a sound going by making it again. It returns what ends it early.
- `range` says how clearly a sound carries to a listener, 0–1, which its loudness is multiplied by. The default is `{ max: 40, falloff: 2, occluded: 0.5 }`: a sound of loudness 1 carries to `max`, and nothing farther; a quieter one less far, by the inverse square of sound spreading out (`falloff` 2: a quarter as loud carries half as far; 1 drops slower, 0 not at all). Close up a sound is louder than its loudness. Times `occluded` where sound does not pass straight from it to the listener (`canPass('sound', …)`, heard `muffled`). Give a function `(listenerID, { id?, point }) => 0–1` for the game's own. A sound is heard from 0.05 up; `loudnessFor(paces)` gives the loudness heard that far by the default curve.
- Every mind that hears it is told, from whichever of its characters hears it loudest: `You hear footsteps LOUDLY 1 pace behind you!`, `You hear muffled bush-thrashing sounds 10 paces in front of you.` From 0.5 it ends in `!` and makes the mind think; from 0.85 it is `LOUDLY`. Distances and directions are worded as sight words them, in its unit. A sound that goes on is told again only when it is heard a step louder (`!`, then `LOUDLY`), as one line. A mind is told at most `limit` (5) sounds a think, the loudest, and none whose maker it sees: sight says that already. Its maker's own mind does not hear it.
- `onSound(from, sound, heardBy)` hears every sound too, as it is made and each tick while it goes on, for whatever has no mind: `heardBy(id)` is how loud it is at that character now, so a game's simple bots turn toward what they hear.
- A heard sound is an event: the mind reads it in its next think, and until then watches and laws see it in `events` (`some(events.filter("sound"))`), each with `secondsAgo`.

`withMap(sense)`: the host paints the `see_map` pictures and marks characters, things and places on them by `id`. The library stamps a legend on the picture in the mind's own names (no coordinates). The map is left out unless vision is on.

`withKnowledge({ pages })` gives articles about the host's types, which minds `recall(query)` alongside memory, so that every type need not be stuffed into the standing prefix (see [Knowledge](#knowledge)).

### Characters

`addCharacter(spec: CharacterSpec)` works before or after the first tick. `removeCharacter(id)` removes a character for good, whether it is on its own or in a collective. Characters and collectives share one set of IDs, and a duplicate throws.

```ts
type CharacterSpec = {
	id: string;
	mind?: MindSettings; // give it a mind of its own; omit for a character the host drives
	choose?: { goal: string; until?: string; [choice: string]: string }; // act by System One instead of a mind
	systemOne?: string | null; // a System One by its director name instead of the default; null for none
	cooldown?: number; // game seconds its standing choose rests after a failed pick; omit = withCooldown (8)
	tags?: string[];
	kit?: Kit | ((ctx) => Kit); // fetched every tick; omit = withDefaultKit
	laws?: LawSpec[];
	maxLaws?: number;
	offers?: { give: Record<string, number>; get: Record<string, number> }[]; // standing offers to anyone from the start
	crowd?: Crowd; // how others coming to it share it ('line' for a vendor)
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
	skipStrategic?: boolean; // no goal or identity revisions
	rank?: number; // tie-break after watch score
	heartbeat?: number;
	strategicInterval?: number;
	model?: string; // the configured model it thinks with, by its role; omit for the default
	conversationCap?: number; // letters of Current Conversation, whole messages only; omit for one quarter of the model's context (4 letters per token); 0 shows none
	lawResults?: number; // how many of its laws' results since its last think a prompt pins (default 5)
	// ...and the prompt and repair settings below (`arcFormat`, `thinkInstructions`, `verbInstructions`, `arcExample`, `systemNote`, `currency`, `toolRounds`, `repairRetries`, …)
};
```

A spec's `systemOne` (on characters and collectives alike) names the System One that picks for it instead of the default. A collective's `systemOne` also picks for every character in it, so `command(who) { loop { choose(…) { … } } }` asks the party's own model. `null` means none at all. A name the director never added throws when the spec is wired up. The kit must still grant `choose`.

A character with `choose` and no mind keeps picking among its choices by System One. Each key except `goal` and `until` names a choice, and its value is that choice's arc. `until` is a watch that pauses the picking while it holds. The picking runs whenever the character is idle, rests for its spec's `cooldown` after a failed pick (default `withCooldown`'s, 8 s), and stops while System One is off. In a collective, it is the character's own program whenever its commander has not issued it anything, so units fight or work well without a single think. Bad arcs or watches fail wiring the cast (`connect()` rejects), and so does `choose` alongside `mind`.

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

The verb works the same way inside a mind's arc:

```arc
choose("hold the gate") {
	hold: go_to(EastGate) && wait()
	slash(Raider)
}
```

A choice without a name is named after its verb and first argument (`slash_Raider`). `loop(until=watch) { choose(…) { … } }` keeps choosing.

The System One reads each choice in terms of whom it is about right now, using the runner's names for them: `shoot(others.filter("enemy").minBy(u => u.hp))` reads as `shoot(EnemyWitch)`, next to the runner's own hp and each target's hp, distance and side. Among the choices' targets, the one with the lowest hp and the nearest one are marked (`EnemyWitch 2/12 hp (lowest), 8 away, ahead`), so a small model that matches words instead of comparing numbers still picks right. Write goals with those words ("finish the lowest hp", "hit the nearest"). A choice whose first target expression picks no one is left out, and if only one choice is left, it is taken without asking. Write choices that only exist when they make sense (`finish=slash(others.filter(u => u is "enemy" && distance(me, u) < 3).minBy(u => u.hp))`) rather than asking a small model to judge reach.

Every mind reads its settings (`MindSettings`) in layers: its own (its spec's `mind`, saved with it, and `mind.settings` to change one live), else the director's, set with `withMind({ skipHeartbeat: true, currency: 'gold' })` (each call merges into what earlier ones set), else the library's. A change to either layer reaches a mind on its next think; `mind.setting(key)` reads one as the mind does. Other director methods: `director.character(id)`, `characters()`, `collective(id)`, `collectives()`, `minds()`, `exportCast()` / `restoreCast(cast)`, and `pushEvent` (which reaches each mind once). Calling `restoreCast` before the cast is wired keeps the save, and the cast is built from it when it is wired.

A character's `id` is its name, and a mind introduces itself by its owner's ID (`You are Fern.`). `role` is an optional plain tag (`Herbalist`) that hosts can also accept as a way to address the character. Backstory goes in pinned `memories`. `set_identity(role?, traits?)` never renames anyone. Identity is who someone is: do not rewrite the role or traits to sum up a mood, an order or the current think. Those belong in goals and events (see [Prompt prefix](#prompt-prefix)).

A host can also build a mind itself and hand it over: `character.mind = new Mind({ rank: 2 })`. The director connects the model and the queue when the mind is attached.

### Collectives

A collective is a group of characters that share one mind. `addCollective(spec)` takes the collective's own kit, laws and persona fields, its mind's settings, its `characters`, and an optional `commander`. The mind's arcs run on the commander, who is the collective's voice. Without a commander, the collective (a hive) runs them itself, seeing through all of its characters at once (its `me` is a stand-in at their average pose, carrying nothing).

```ts
const director = await new ArcDirector<CharacterCtx>()
	.addLMStudio()
	.withVerbs((v) => v.addStock().addStockCollective())
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
	.connect();

const hive = director.collective('MarketHive')!;
const tomas = hive.addCharacter({ id: 'Tomas', tags: ['Shopper'] }).character('Tomas'); // a new character, in the hive
hive.removeCharacter('Tomas'); // gone for good, as director.removeCharacter
```

**`command(who, arc)` is instant.** It assigns programs that stick, and returns `ok` without waiting for the characters to move, talk or finish. Join several `command` steps with `;` (`"then":"always"` in JSON) so that later ones still run. `&&`, `;` and `||` *inside* its body sequence that character's own steps. `&&` after a `command` means the orders were assigned, not that the characters finished them. To wait for them, the thinker uses `wait(until=...)` over the roster.

**Two or more ordered together are a group.** `command(who, arc, group=Raiders)` names them; the name is a tag, so `units.filter("Raiders")` reaches exactly them later, whoever else the first `who` would pick by then. A unit has one group, its latest order's: ordered away alone it leaves it, and the last one left keeps the tag. A unit that takes command leaves its group, and its roster row reads `Cade (you)`. Ordered without a name, a group gets one and the reply says so: the name of the group it takes most of, a split off from one it takes a part of (`Raiders2`), or else the first free letter (`Alpha`). The commander's roster is a table with a row per group and per unit on its own: kind, health, what it is doing, how its last step went, the nearest others it sees (with their health, and `in reach` where the host's sight sets `inReach`), and the verbs it has beyond the collective's. A unit whose program ended is `done, ok` or `failed: why` there, not idle.

Under the roster, the programs its units run, or ran last, are files, as an agentic coder reads them: one a program and group, named as its units are addressed: the group, or the one unit. Its header says how to pick them all and each alone, with each one's health, since a program can be right for some of its units and wrong for one: `programs/Vanguard.arc (units.filter("Vanguard") = Knight1 30/30 hp, Knight2 4/30 hp, Knight3 30/30 hp; running 40s)`, where `units.filter("Knight2")` picks Knight2 alone. Each file is in the block layout the commander writes, each step a unit is on marked like a thread in a debugger (`// ← now, 3s` when all are on it, else `// ← Knight1, Knight2`, or `// ← Knight3, 4s` for one), a step a reaction holds marked apart (`// ⏸ Knight3, while law flee runs`), and a last line for those that ended (`// done: Knight4, ok`). The law's own step shows in the Laws list (`running for Knight3: flee(Wolf)`). Past a cap in letters, each file shrinks to its header and the line it is at. Then one line: a program can be right for some of its units and wrong for others, so command only the units it is wrong for (by name, or a filter that leaves the rest out), and reply `pass()` if all still fit. Shown what runs and how far it got, small models stop re-commanding squads that work. Markers are comments, so a copied one is read as space.

`who=` is an expression on `units` (the roster minus the commander; `allUnits` is everyone), not on `others`. One unit is a `who` too: `command(units.minBy(u => u.hp)) { … }`, since `units` carry their `hp` as `others` do. A `who` that cannot be read fails with why (`cannot read units.minBy(u => u.mana): key is not a number`). Give orders by tag. The tags in a character's spec travel with it. A tag the mind adds with `tag` is stored as ``${collective.id}:${short}`` and dropped when the character leaves; expressions and prompts use the short name.

Formations (`spread`, `circle`, `hold_line`) are steps like any other, and can go anywhere in a character's arc. Every character in the squad it was issued with works out the same slots and walks to its own, and the step ends when it gets there. Each character needs them in its kit. Inside a `command`'s body and a law's `watch`, `me` is that character. Each character runs what it is issued with its own kit, and the roster tells the mind which of the collective's verbs a character cannot run.

**Laws.** `law` and `unlaw` set up standing emergency responses (with no LLM involved) that take over when their `watch` holds. The prompt lists laws as sentences (`- flee (for units.filter("Shopper")): when isHurt(me), it runs go_to(Keep)`) rather than arcs, so small models do not copy them back. A collective's own laws reach its characters through `who`. A character's own laws live on its collective, named like `Tom.flee`: the prefix is the filter, so they take no `who` and only reach Tom. Each group holds at most `maxLaws`, and the collective's own laws outrank its characters'. Law names cannot contain `.`, but IDs can, since the prefix ends at the last one. A `law(...)` step run by a character who is not the commander writes a law of that character's own (`Tom.…`). Running laws and `when` steps are tracked by the law or step itself, so renaming one never restarts it. A `when` and a law are one kind of reaction. A `when` guards the rest of the arc it is written in, from where it is written: inside a group it ends with the group, and at an arc's root it outlives the program's body until the program is replaced. A law lasts until `unlaw`. A reaction starts when its watch becomes true, and then runs its arc to its end, whatever its watch does. The director asks watches on two intervals of game time, `withIntervals({ watch?, think? })`: every `watch` seconds (default 0.05) it asks every law, every parked `when` and every step's `until`, so a reaction starts within one interval of its watch turning true, and every `think` seconds (default 0.25) it samples the minds' own watches for the think queue and asks goals' `until`s. Each fires once it is due and never catches up; `0` asks every tick. Each ask builds the world as each character sees it, so a frame cannot afford it many times over. A `within` is no watch: it ends on time. It starts again only once its watch has been false for its `rearm` (game seconds; default 1, or whatever `withRearm(seconds)` sets for the director), so a character at the edge of a watch does one thing and finishes it instead of switching back and forth. A reaction takes over only from one of strictly lower rank (a collective's laws, then a character's own, then `when`s, then the program), and one starts per character per moment. A program from a think or a commander waits for a law running now to end. Every `loop` in a reaction's arc, at any depth, goes round only while the reaction's watch holds, asked before each round, the first included; steps that are not loops still run, so a law ends cleanly. A verb with no end of its own (`follow`, the RTS `hold`, `patrol` and `gather`; mark your own with `v.add(name, { endless: true })`) is a loop's equal there: it stops once the trigger no longer holds, and its `within` running out is how it ends, not a failure. `loop(unbreakable=true)` goes on to its own end regardless, `unbreakable=N` for its first N rounds, and `unbreakable=10s` for its first 10 game seconds; everything in an unbreakable round goes on with it, endless verbs too. An endless verb takes seconds only: `follow(Captain, unbreakable=10s)` follows for at least 10 s (a bare number or `true` is refused). Either can end sooner: `times=N` finishes it once it has started N times (`times=1` is one-time; a run counts when it starts, even if something cuts it short), and `until=expr` stops a run under way and finishes it once that watch has held, even if it stops holding later. A finished `when` stops firing while its program goes on. A finished law removes itself, pinned or not. A collective's law counts and reads `until` for each character on its own, in that character's view, so `times=1` with `who=units` runs once per unit; it goes once it has finished for someone and for all its `who` picks at that moment. To have one unit do it, name one in `who`. Progress is saved with the law, and writing the same law again keeps its count unless its `times` or `until` changed. A verb alias can be law-ready: `v.addAlias('strike_on_sight', { help, arc: 'loop(attack())', watch, who })`. Then `law(arc=strike_on_sight())` is a whole law: it takes the alias's `watch`, `who` and `rearm` when it gives none (`keep_distance` re-arms at once, so a unit kites), and its name when it gives none, so `unlaw(name=strike_on_sight)` drops it. Once any alias has a watch, `law`'s own `watch` is optional.

**Moving characters.** Characters change collectives through two setters, and the arc a character is running keeps running throughout.

| | |
| --- | --- |
| `character.collective = c` | Moves it straight into `c` from any other collective. Its own mind goes (its settings are kept), its laws move in as `Tom.*`, and the old collective's tags and commander post are dropped. |
| `character.collective = null` | It leaves. It thinks with a fresh mind built from its kept settings, or the host drives it if it never had any. Its laws lose their prefix; laws that need a collective (`units`, `allUnits`) are dropped, and its new mind is told which. |
| `character.mind = m` | Gives it its own mind from now on, outside any collective. A collective's mind means joining that collective. `null` hands it to the host and forgets its settings. Another character's mind throws. |

The collectives involved hear "Tom joined" or "Tom left", and a character that left is told what it is still doing for the collective it left. `removeCollective(id)` moves every character out first, so each one ends up on its own. `onCommanderVacant((collective, character) => …)` fires when a commander leaves or is removed; name a successor with `collective.commander = …`.

**Memory handover.** After a move, a single model call fixes the memories of everyone involved: what went stale for the collective that was left, and what the character, or the collective it joined, should now remember. Moves within `ticks` director ticks of each other share one call (a character that moves twice makes one journey, from its first `from` to its last `to`), and characters without an identity are skipped. The call takes the next free think slot, never stops a think, and nothing waits for it. Pinned memories are never touched. Handover is on by default: `withHandover({ ticks?, handover? })` widens the window or swaps in your own `Handover = (journeys) => Promise<MemoryEdit[]>`, and `handover: false` turns it off.

### Prompt prefix

Each think is two messages. The **system** message holds the identity, the standing instructions and the kit's verb list (plus a `see_map` hint when vision is on). The **user** message holds everything that is expected to change: the scene, what is carried, events, goals, pinned memory, watches and the last verb. A mind that is no commander also sees the program its body still runs, as a file (`program.arc (running 14s)`) laid out as it would write it, the step it is on marked `// ← now, 3s`, with the reply that keeps it (`pass()`, which runs beside it). A commander sees its units' programs the same way, under its roster (see Collectives).

Local servers (LM Studio, llama.cpp, Ollama) keep a **KV cache**: the attention state for a run of tokens. If the next request starts with the same tokens as a recent one, the server reuses that state and skips the work. Reuse only lasts while the tokens match from the very start. From the first token that differs, everything is recomputed to the end, including the long user message you meant to be cheap. One early edit costs a full prompt reload.

You can replace the standing lines. Every row is a mind setting: for every mind through `withMind({ thinkInstructions })`, or for one in its spec's `mind` (`{ thinkInstructions }`).

| | |
| --- | --- |
| `thinkInstructions: { on?, off? }` | The line about thinking, depending on whether reasoning is on (the prompt follows the `thinking` setting of the mind's model). `on` defaults to "Think in 5 sentences, then emit the arc."; `off` defaults to nothing, since the prompt already asks for the Arc alone. |
| `verbInstructions` | The line about chaining verbs. For a collective, the default also asks for looping programs; this replaces both. A host's standing doctrine goes here. |
| `currency` | The item ID the world pays with (`gold`). The prompt shows `give` and `offer` moving it, the purse is counted in it, and giving it is remembered as paying. Without a currency, the prompt says nothing about money. |
| `arcExample` | The example that closes the prompt, written as Arc text; the JSON formats show it as Arc JSON. Small models copy it, so make sure it is valid and its parentheses balance. |
| `repairRetries` | How many repair turns follow a bad arc (default 0). The bad reply is left out of the repair turn, which only says what was wrong, so the model writes it anew instead of copying it. Each samples as the model does. Repair turns never reason, since the conversation they carry has already run long. A failed think goes into short-term memory only, never into facts. |
| `minChoices` | The fewest choices a `choose` in a reply may have (default 3). With repair turns, one with fewer goes back to the model; the prompt asks for that many to two more. Models left alone write one or two. Arcs the host writes may have any number. |
| `toolRounds` | How many tool rounds a think may spend before it must emit the Arc (default 6, `DEFAULT_TOOL_ROUNDS`, since small models need several lookups in a row). `0` offers no tools. Calling the same tool with the same arguments twice in one think is refused rather than run again. |
| `stalled` | Decides whether a finished arc stalled, which stretches that mind's heartbeat. By default, an arc stalled if it failed or was stopped. |

Tool hints (`see_map`, `recall` for knowledge, `observe`) only appear on thinks where that tool is actually offered.

Keep the system message the same from one think to the next:

- **Identity** is who someone lastingly is. A new role is a life change, not "I am angry" or "Player told me to wait". The model is already told not to rewrite its identity to sum up a moment, and the host should not either.
- **The kit** is a lasting grant. Returning the same kit every tick is fine. Flipping verbs, senses or tools every tick (gagging someone for one line, offering vendor verbs only while the player is looking, an empty kit while unconscious) breaks the cached prefix for that mind. A gag or a stall that lasts a whole scene is one change: make it, then leave it alone. An unconscious character should skip thinking (`mayThink`), not have its kit rewritten for a frame.
- **Vision, `see_map` and the you-mark:** leave them on or off for the whole session. The library already keeps tools listed (`tool_choice: none`) on arc turns, so follow-up requests *within* a think share a prefix.

`v.add` and `v.remove` rewrite the shared verb catalog, and `t.add` / `t.remove` change the tool list sent with each request. Since those lists are in the prefix, changing them costs as much as changing the kit.

---

## Full example

```ts
const director = await new ArcDirector<CharacterCtx, Entity>()
	.withQueue(new MyMindQueue())
	.addProvider(new ModelProvider('mine', myProvider))
	.withWorld(host.world)
	.withVerbs((v) => v
		.addStock()
		.add('steal', {
			args: { item: 'id', from: 'id' },
			help: 'goes to them first',
			handler: async (call) => {
				const near = await call.goTo(call.args.from);
				return near.status === 'ok' ? host.steal(call.ctx, call.args.item, call.args.from) : near;
			},
		}))
	.withDefaultKit({ verbs: [...STOCK_VERBS, 'offer', 'steal'] })
	.withSight({ look: (ctx) => host.look(ctx) })
	.withInventory((ctx) => host.inventory(ctx))
	.withKernels((ctx) => host.kernels(ctx))
	.withTalk({ ...host.talkSense, onSpoke: (line) => hud.bubble(line) })
	.withMap(host.mapSense)
	.withContext((id) => host.ctx(id))
	.onAbortArc((id) => host.stopCasting(id))
	.onLog((entry) => hud.push(entry))
	.onThink((event) => hud.showThink(event))
	.addCharacter({
		id: 'Captain',
		mind: { rank: 1 },
		identity,
		goals,
		pinnedWatches: { hurt: 'isHurt(me)' },
	})
	.connect();
```

An Arc replaces the program its character is running, unless nothing would change: one of only `free` verbs (they need no body: `say` within earshot, a bare `wait()`, `law`, `command`, `remember`, …; mark your own with `v.add(name, { free: true })`) runs beside the program, and the same program again, reworded or not, goes on as it is. So `wait()` says "no change". `withReplaceCheck()` also asks the model, in a short follow-up to that think, what to do with any unfinished work the Arc would cut short, on its own or a unit's, told where each one has got to: `{ "Flint": "replace", "Ash": "append", "Nyx": "keep" }`. Replaced work stops now; appended work goes on, and the new Arc runs after it ends, or inside its loop if that loop has no exit, each time round; kept work goes on and the new Arc is dropped for it. Any other answer, or none, appends. `runner.append(arc)` does the same from your code.

With `repairRetries`, a reply that could never work goes back to the model in a follow-up to that think, before it runs: a watch that misuses the language (`items.nearby.filter(...)`, `some(3)`), a name nothing in the world goes by, an order that picks no unit, a `choose` with fewer than `minChoices` choices, a law past `maxLaws` or the twin of one it has, and a trade whose terms are no items or no real counts (`HostWorld.isItem`). What is merely not so right now is left for the verb to report as it runs. With `repairPerStep` too (`withMind({ repairRetries: 2, repairPerStep: true })`) the steps that need no body are judged one by one: a good `command` stands while a bad `law` goes back, the follow-up shows the model only what stands and says in words what failed and why, and once retries run out what is good still runs and the next think is told what did not. A reply cut off for breaking down mid-stream keeps the root steps it had finished the same way. `repairUnknownFields` (the director's layer) also sends back a watch reading a field no one in sight has (`u.foo`), which would only ever be false.

A step a reaction cuts short is suspended: it goes on once the reaction is done, keeping its `within` deadline, unless it had already done what it does. A collective's law that only speaks reaches its commander unless it names a `who`.

A `loop` ends at the first failure, unless the result says going round again may help (`retry: true`, for a target that moved out of reach): it then waits a second and goes on, up to 5 failures in a row. `times=N` caps its rounds and `until=watch` ends it once that holds. `through=x in list` goes round once per item of a list expression, with `x` bound to that item in the body (`loop(through=foe in others.filter("enemy")) { shoot(foe) }`); the list is read once, when the loop starts, and may hold at most the catalog's list cap.

What models write for "is this a Witch" (`u.is("Witch")`, `u.kind == "Witch"`, `u.role == "Witch"`, `u == "Witch"` of a lambda's own `u`) is read as `u is "Witch"`, and shown back that way in its prompts. `u.kind` and the like stay fields where your entities really have them.

Watches stay true as long as what they read does, and a true watch keeps a mind thinking. To wake once on a change, read it through `hasRisen("name", n)` or `hasFallen("name", n)`: `hasFallen("standing", count(allUnits))`. `u.ordered` says a unit still runs a program its commander issued, and `isBadlyHurt(u)` that it is under 35% health.

`onThink` shows what minds do as they think, for a game to put on screen; none of it reaches a prompt. Each `ThinkEvent` names `who`, the character acting for the mind, and is one of: `start`, `reply` (its reasoning and its Arc so far as Arc text, live while the server streams, whatever the wire format), `tool` (a look-up it made), `retry` (why a reply would not do, and the model is being asked again), `end` (with the Arc it chose, or the `error` that ended it, or neither when a newer think cut it short) and `command` (an order to the characters `to`).

---

## Mind (low-level)

`soloCharacter({...})` (from `arc-director/testing`, with `FakeProvider` and the scene simulator) builds a character with its own mind and no director, for unit tests and scripts. Normal use does not need it.

`Mind<TCtx>` writes arcs for its owner, which is a character or a collective. `tick(gameTime)` may revise goals (the strategic pass) and emit one `Arc` (the tactical pass), which its voice enacts when that voice has an executor and `autoEnact` is on. `thinkNow({ about?, enact? })` thinks once, right away.

A strategic pass revises goals first, in the format the mind writes in: Arc text (`set_goal`, `drop_goal`, `finish_goal`, `set_identity`, or nothing) under `text`, JSON `{"goals":[…],"identity"?:{…}}` under `json`, and the same JSON with a fixed `goals` schema under `schema`. The voice's `verbIndex` is the 0-based index of the step currently running inside `enact`.

### When the tactical pass runs

| Condition | Effect |
| --- | --- |
| First `tick` | Always thinks |
| `lastResult.status === 'stopped'` | Thinks |
| A pending event with `major: true` | Thinks |
| `heartbeat <= 0` | Thinks (the queue already picked this mind) |
| Anything else | Thinks if `gameTime - lastTacticalTimestamp >= heartbeat` |

Defaults: `heartbeat` is 0 under a director (its queue paces the thinks) and 30 in `soloCharacter`, and `strategicInterval` is 180. Setting `strategicInterval <= 0` turns the periodic strategic pass off.

A tactical pass gathers the senses, may let a memory intrude, offers tools for up to `toolRounds` rounds, and ends with an `Arc`. The tools are `recall`, `observe`, `earshot` and `see_map` (when the host draws maps and the model can see), plus the host's own; `recall` also searches knowledge when `withKnowledge` is set. The Arc is `{"steps":[…]}` JSON, or `go_to() && wait()` text under `arcFormat: 'text'`; under `schema`, tools are called in the reply itself. How the prompt is split into the system and user messages is described under [Prompt prefix](#prompt-prefix).

### Options

| | Default | |
| --- | --- | --- |
| `model` | the director's default | The configured model it thinks with, by its role |
| `skipHeartbeat` | false | No think on the queue's heartbeat; only watches, events and arc ends wake it |
| `skipMajor` | false | Major events do not wake it |
| `skipStart` | false | No think when it joins: it waits for something to happen |
| `skipStrategic` | false | No goal or identity revision, on the timer or after a major event |
| `rank` | 0 | Tie-break after the queue's watch score: higher goes first |
| `heartbeat` | 0 | Fewest game seconds between tactical thinks (30 in `soloCharacter`) |
| `strategicInterval` | 180 | Game seconds between goal revisions; 0 never revises |
| `conversationCap` | a quarter of the context | Letters of Current Conversation shown, whole messages, newest kept; 0 shows none |
| `lawResults` | 5 | How many of its own laws' results since its last think a prompt pins |
| `arcFormat` | `schema` | How it writes an Arc: `text`, `json` or `schema` |
| `thinkInstructions` / `verbInstructions` / `arcExample` / `systemNote` / `currency` | stock | Standing lines of the prompt (see [Prompt prefix](#prompt-prefix)) |
| `toolRounds` | 6 | Tool rounds before the arc must appear; 0 offers no tools |
| `repairRetries` | 0 | Extra turns after a bad arc |
| `minChoices` | 3 | Fewest choices a `choose` in a reply may have |
| `repairPerStep` | false | Judges a reply's bodiless steps one by one: the good ones stand |
| `repairUnknownFields` | false | Sends back a watch reading a field no one in sight has |
| `stalled` | failed or stopped | Whether a finished arc stalled, which stretches the heartbeat |
| `intrusionThreshold` / `intrusionCooldown` | 0.55 / 45 | When an unrequested memory may come into the prompt |
| `recallK` | 5 | How many hits `recall` returns by default |
| `hideObserve` | false | Leaves out the built-in `observe` tool |

`maxGoals` (default 5), watches, sight focus and their writable flags live on the `Persona`.

### Reaching a goal

A goal's `until` field says when it is done. There are three ways to use it:

```ts
goals: [
	{ text: 'Buy a Loaf.', until: 'isCarrying("Loaf")' }, // a watch, checked from the character's point of view
	{ text: 'Open the shop.', until: ({ world }) => world.shop.open }, // your own function, given the character's context
	{ text: 'Make peace with Hilde.' }, // no until: the model decides
]
```

The director checks watches and functions for you every 0.25 game seconds (`withIntervals` `think`). A typo in a watch fails wiring the cast (`connect()` rejects), so it cannot silently leave a goal open forever.

Leave out `until` for goals that code cannot easily test. The model already sees its goals in every think, next to what the character can see and is carrying, so judging them costs no extra inference. When it decides a goal is done, it adds `finish_goal(goal?)` to its reply. If it names no goal, this finishes its first goal without an `until`.

A goal with an `until` can only end through that check. If the model calls `finish_goal` on one, the call fails, so it cannot claim something the game has not seen happen. A model that wants to abandon a goal uses `drop_goal` instead, which removes the goal without recording it as reached.

When a goal is reached, it leaves the goal list and becomes a pinned memory (`Goal reached: Buy a Loaf.`). The memory stays in the prompt for the next 5 thinks (`GOAL_PINNED_THINKS`) so the character knows the goal is done, and after that only `recall` can find it. To react in your game, with a cheer or a line on screen, use `withGoals({ onReached: (id, goal) => … })`. You can pin any memory for a limited time the same way: `memory.add({ text, pinned: true, pinnedThinks: 3 })`.

Saves remember which goals were reached. Functions cannot be saved, so on load each goal gets its `until` function back from your spec by matching the goal's text. If you reword a goal between a save and a load, the loaded goal loses its function.

Under `json` or `schema`, a strategic pass replies with the whole goal list, so any goal the model leaves out is dropped, not reached: it leaves no memory and does not call `onReached`.

`pushEvent` queues text for the next think. A `major` event wakes the mind right away, unless it `skipMajor`. Speech is only major when it is said to the listener, names them, or is said to everyone and heard clearly, so talk between others is overheard without waking anyone. `remember` also files the event as an episodic memory, and `timestamp` defaults to now. `remember(text, tags)` writes a memory into the owner's persona. `toJSON` / `Mind.fromJSON` save and restore the mind's settings and thinking state; the persona is saved with its owner.

---

## Think queue (details)

On each tick, the queue adds up time, samples watches on the director's `withIntervals` `think` interval (every 0.25 s by default), emits rows every `processInterval` (1 s) and buffers the minds that are ready. Each starts at once and waits for a slot of its model, best score first: `maxParallel` and `batchWait` on its model say how many run together, and when they wait for a wave. Walking an arc does not count as being in flight. A mind thinks for one of these reasons: `start`, `watch`, `major`, `verb` or `heartbeat`.

Every mind thinks once when it joins (reason `start`, with a score of 0.5, below a major event), whether or not it has a heartbeat, so a character that only wakes on events still acts from the first second. `skipStart` turns that off for a character that should only react, like a guard who waits to be approached; `withMind({ skipStart: true })` turns it off for everyone. Laws do not wait for that first think: until a mind has finished one, its voice's laws start as soon as they hold.

`mayThink` is optional. Without it, a live arc blocks a new think. The callback receives `mindID`, `reason`, `score`, `rankedScore`, the live `arc` (or `null`) and the `verbs` on that arc.

Watch scores: `true` counts as `trueScore` (0.51), numbers from 0 to 1 are used as they are, and anything above 1 is clamped to 1 with a warning. A score must be above `epsilon` (0.05) for the mind to be queued.

Priority ranking multiplies that score by a recency factor. Right after a think, the factor is `trueScore` (0.51), and it rises linearly to 1 by `heartbeatStart / 2` (1.5 s at the default of 3). For minds that have never thought, it stays at 1.

Each mind has a heartbeat: a low-priority (0.001) pulse every `heartbeatStart` (3 s), clamped to `[heartbeatMin, heartbeatMax]` (3–300). The interval stays fixed unless you set `heartbeatAdjust: 'auto'` (which stretches it after a stall and shrinks it otherwise) or a callback.

---

## Watches

Watches are standing conditions, checked against a `Catalog` built from `HostKernels`. They are a dictionary from a short **name** to an **expression**.

**Pinned** watches (`pinnedWatches`) are written by the host, and the LLM cannot replace, edit or remove them. Other watches live in `watches`. When `watchesWritable` is set and the kit grants them, the model edits those with `watch(name, expr)` (add or replace) and `unwatch(name)`. `focus(expr)` and `unfocus(expr)` do the same for `sightFocus` when `sightFocusWritable` is set. Using a pinned name fails with a reason. These are ordinary steps, so they run in arc order: in `go_to(Gate) && watch(...)`, the watch is only added if `go_to` succeeds.

A watch is an expression of the Arc language (see "Arc text") that only asks: no verb, no `;`, no body. It reads like JavaScript but is not a subset of it (`is`, list methods on names, `&&` on numbers as min). Its bindings are `me`, `others` and `items`, plus the host's own names (`bindings`). When you go through `ArcDirector`, `hasHeard` and `prev` come from the mind: `prev.me`, `prev.secondsAgo` and `prev.verbs` describe the last think, or the moment the character spawned if it has never thought. Only pass `prev` yourself when you call `buildCatalog` on its own.

```text
hasRisen("approaching", count(others.nearby().approaching()))
isHurt(me)
isNear(me, Other, 16)
distance(me, Target)
i is "marked"
```

A watch's name stands for its current value in any expression of the mind's (`wait(until=fallen || idle)`). A name bound otherwise wins over it: a `let` (written in the arc itself), the stock bindings (`me`, `others`, …), the host's `bindings`, and any entity's name or tag, which every expression and verb arg relies on to mean that thing. A bare name is a list of everyone so called. `distance` between lists is that of the nearest two, so `distance(me, Target)` and `distance(me, others.filter(o => o.foe))` (the nearest foe) both read as a number.

| | |
| --- | --- |
| Relations | `distance`, `isNear`, `isReachable`, `isApproaching`, `isDeparting`, `hasSightline`, `hasJustSeen`, `hasLostSight`, `facing`, `isFacing`, `isBehind` |
| List filters | `others.nearby()`, `.nearby(16)`, `others.reachable()`, `.approaching()`, `.departing()` |
| Lists | `filter` / `find` / `some` / `all`, `map`, `sortBy`, `count`, `includes`, `first`, `max` / `min`, `sum`, `avg` (each also through a function: `others.min(u => u.hp / u.maxHP)`; none for an empty list), `maxBy` / `minBy` (the item, not the number; an item the function gives no number for, such as a door's hp, is passed over), `reduce` |
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
	canSee?: (a, b) => boolean;                         // director: light passes (canPass), unless you give your own
	facing?: (a, b) => number;                          // director: from withWorld
	side?: (a, b) => number;                            // director: −1 left … +1 right of a's facing
	isFacing?: (a, b) => boolean;
	inventory?: (who) => ExprEntity[];
	hp?: (who) => { hp: number; maxHP: number } | undefined;
	isOpen?: (who) => boolean | undefined;
	isReady?: (who, verb) => boolean | undefined;      // cooldown over; undefined = no cooldown
	hasHeard?: boolean;           // director injects
	watches?: Record<string, string>; // director injects: the mind's watches, read as values by name
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

Space only enters expressions through these callbacks. Under `ArcDirector`, they come from `withWorld` (and `canSee` from `canPass`); `buildCatalog` on its own takes them as given.

---

## Arcs

An `Arc` is a list of steps. A step names a verb, gives its args, and says how it joins the step after it:

```ts
type Step = { verb:string; args:Record<string, StepArg>; then?:'if_ok' | 'always' | 'if_failed'; let?:string };
type Arc = Step[];
```

`then` is decided by how this step went:

- `if_ok` (`&&`) runs the next step only if this one succeeded. A failure skips to the step after the next `||` or `;`.
- `always` (`;` or a new line) runs it whatever happened.
- `if_failed` (`||`) runs the next step only if this one failed. A success skips to the step after the next `;`.

So the joins short-circuit as they do in JavaScript: `&&` binds tighter than `||`, and `;` is lowest. In `a && b || c`, `c` runs when `a` or `b` failed; in `a || b ; c`, `c` runs either way. The chain's result is that of the last step it ran. `fail` is the most recent failure in the chain, kept until the chain ends, so in `a || b && say(fail.reason)` the speaker says why `a` failed. A missing `then` means `if_ok`, and the last step's `then` is ignored. Text and JSON differ in one default: a bare new line between steps in text means `always`, while a step with no `then` in JSON means `if_ok`. A group, `( … )`, is the step `{ verb: 'group', args: { arc } }`, and its result joins like any other step's. A query written as a step is `{ verb: 'test', args: { watch } }`, and works while its watch holds. `group` and `test` are not verbs you register, and no verb may have an argument called `verb`, `then` or `let`.

### Arc text

Watches and arcs are one language, read by one parser (`expr/expr-parse.ts`) with JavaScript's operators and precedence. Everything is an expression: a verb call acts, and is true if it worked and false if it failed; a query returns a value. A watch is an expression that does not act.

```text
let picked = pick_up(Bucket)
if (picked) {
	go_to(Well) && use(item=Bucket, target=Well)
} else {
	say("Where is the bucket?", to: Mira)
}
command(units.filter("Archers")) {
	go_to(Wall)
	attack(Wolf)
}
when(isHurt(me), times=1) {
	flee(Wolf)
}
choose("stay alive") {
	fight: attack(Wolf)
	run: flee(Wolf)
}
```

- **Joins.** `&&`, `||` and `;` (or a new line) as above. A query is a step too: `isHurt(Mira) && heal(Mira)`.
- **Bodies.** A verb with an `arc` argument takes it as a body after its call, in braces on the call's line or the next (both K&R and Allman parse), or as one statement with no braces, as an `if` branch takes one in JavaScript. `loop { … }` needs no parentheses. Writing `arc=…` inside the call still works.
- **`if` / `else`.** `if (cond) { … } else { … }` is the stock verb `if(cond, arc, else?)`. `cond` is steps: a watch (`isHurt(Mira)`) works while it holds, a verb (`pick_up(Bucket)`) when it worked. `else` continues the `if` before it, so `else if` needs no rule of its own; in it, `fail` is why `cond` failed. Without an `else`, a `cond` that failed ends the `if` as done. The arcs of an `if` (like a group's) are part of the program they are in: they take the thinker's own verbs, and a commander may `command` in them.
- **Choices.** `choose("goal") { name: step … }` labels each choice; a choice of several statements is a block, `name: { … }`. An unlabeled choice is named after its first verb and argument.
- **Named args** take `=` or `:` (`say("Hi", to=Mira)`, `say("Hi", to: Mira)`); a lone first argument needs no name.
- **Method syntax is call syntax:** `others.filter(p)` is `filter(others, p)`, and `Keep.go_to()` is `go_to(Keep)`.
- **Durations** are numbers of game seconds: `5s`, `1.5min`, `2h`. `5m` is an error that says distances are plain numbers: sight writes meters that way.
- **`let name = step`** names a step's result for later steps: true or false for a verb or a chain, the value for a query (`let foe = others.nearby().first()`). A name is visible from its `let` to the end of the arc it is in, the arcs inside that arc included, and is given once there: a second `let` of the same name in scope is an error, and so is a name a watch already reads (`me`, `fail`, …). In JSON it is the step's `let` key.
- **Comments** (`//` to the end of the line, `/* … */`) are read as space, in arcs, watches and Arc JSON alike; inside a string they are text.

In JSON, which the `json` and `schema` formats use, the same tree is written with the args beside `verb`, `let` first and `then` last. A nested arc is a bare list of steps, and `choose` keeps its choices under `choices`:

```json
{"steps":[
  {"verb":"go_to","target":"Keep"},
  {"verb":"use","item":"Lever","then":"if_failed"},
  {"verb":"say","text":"It's stuck.","to":"Forager"}
]}
```

`parseArc(reply, verbs)` reads either form. JSON can also be a bare list or a single step, in a code fence or after some reasoning, and a string where an arc should be is read as Arc text. `arcToJSON`, `arcFromJSON` and `arcJSONText` handle the JSON side. `replySchema(catalog, tools)` is the fixed schema of a reply: either a call to one tool, or `{"steps":[…]}`, with one branch per verb in the whole catalog. It never depends on one mind's kit, so every mind gets the same bytes; the kit is checked once the reply has been read. `formatArc` writes an arc back as text on one line, `formatArcBlocks` in the block layout prompts show: each body a tab deeper, one statement per line, and its `}` alone.

Chain steps as far ahead as the next verbs are known. A think is expensive, so emit the whole chain in one think: not one verb at a time, and not just the first step of an order like "do this, then that". `always` still runs the next step after a failed `pick_up` (when the item is already held, for example). `think()` is always moved to the end, even out of groups. `wait(seconds?, until?)` parks the character; `until` is a one-time watch. `pass()` does nothing and needs no body: replied alone, it leaves the program under way running, as a think that finds nothing to change should.

Arc text is read forgivingly, because small models make slips: a stray `)`, `.` or `,` between statements is dropped, missing closing brackets and braces at the very end are added, two verb calls with nothing joining them are joined with `;`, a verb with one bare name (`go_to Keep`) or one string (`say "Hold the line"`) takes it as its first argument, a name in a name argument copied with the stars of a `*starred*` name (`go_to(*SealedDoor*)`) is the name, prose may go unquoted (`say(Hello there, friend, to=Player)`), and an argument that does not read as an expression is taken as written (`set_identity(role=Waterfall scout)`). A reply that wraps its arc in prose or think tags (`</think>`, `</redacted_thinking>`) is read from its last piece between the tags that parses, without the prose lines before and after its steps. A reply that stopped at the token cap (`ChatResponse.truncated`) is never parsed; it goes to a repair turn. A `command` that swallowed the next `command` (because a closing bracket is missing mid-line) is rejected. Under `text`, a tool call written where the Arc goes (`recall("Bread")`, `earshot(to=Forager)`, or a chat template's own syntax that reached the reply unparsed, such as Gemma's `call:observe{…}` or Qwen's `<tool_call>…</tool_call>`) is the call the model meant: written alone, it is run as that tool; written beside an Arc, it is dropped from it.

`ArcResult` is `{ status, reason?, verb? }`, `status` being an `ArcStatus`: `ok` (done), `failed` (it did not happen) or `stopped` (its program was replaced or its reaction stopped; it ends every chain it is in). A verb handler returns one: `return { status: 'failed', verb: call.verb, reason }`.

### Follow-up think

After an arc, `enqueueArc` uses the **highest** score among the steps **after** the last `wait(until)` to decide how urgently the mind should think again. A failure scores at least 0.3. The stock verbs have the scores below. Give your own verbs scores with `verbScores` (`{ steal: 0.95 }`), which can also override these. A score of 0 means no follow-up think after success. Steps inside a group count too; arcs held in args (`loop`, `when`, a choice) do not.

| Verb | Score |
| --- | --- |
| `go_to` / `examine` | 0.8 |
| `use` | 0.65 |
| `give` / `offer` / `pick_up` | 0.6 |
| `drop` | 0.55 |
| `think(about)` | 0.55 |
| `flee` | 0.5 |
| `set_goal` / `remember` / `set_identity` / `law` / `unlaw` / `watch` / `unwatch` / `focus` / `unfocus` | 0.45 |
| `think()` | 0.35 |
| `wander` | 0.3 |
| `say` | 0.25 |
| `drop_goal` | 0.2 |
| `finish_goal` | 0.2 |
| `follow`, `wait` and any verb not listed | 0 |

---

## Memory

`MemoryStore` holds episodic, semantic and identity memories. Pinned rows are never evicted, and they go in the user message.

Each think also brings in the top `recallK` (5) unpinned memories that are not already in the prompt (short-term lines are skipped before the top 5 are taken). They are scored by cosine similarity (when there are embeddings), plus word overlap and matching tags, so speech and `remember()` facts show up without a tool call. `intrusion` may bring in one extra memory unasked.

Episodic memory is capped at `maxEpisodic` (256). Heard speech is copied into a short-term buffer (the last 8 lines) and into episodic memory, tagged with names. Names from sight are kept as last-seen semantic rows. `remember(content)` writes a semantic memory.

---

## Talk

`TalkNet` only deals in names. Implement `TalkSense`: `inRange` and `others`, and optionally `clearHear`, `hears`, `names`, `face` and `approach`.

On each think, the prompt lists who is within talking range. `say(to)` first walks up to whoever it is said to, following them as they move, until they would make out every word (`inRange` and `clearHear`). When there is no way to them, the library does not speak, and tells the model why in the same think. In a world where characters do not move, `say(to)` is only valid for names in range, and the hint tells the model to get closer first. It walks with `call.goTo` and a `check`, as host verbs can. Beyond clear-hearing range, the words are muffled. If the listener comes within clear-hearing range in the next `rehear` seconds (`TalkConfig`, default 8), the line arrives again in full ("…, now clear"). Heard lines are kept as episodic memories.

---

## Map

`see_map` is a **tool**, not an Arc verb. It is only offered when **both** a host `map.snapshot` and `vision` are set. Its `zoom` argument runs from 0 to 1 (1 is close up, 0 is the whole land). The host paints the picture; the library stamps symbols on it and returns a legend of names only, with no coordinates. The default you-mark is `❌`. Never write `see_map(...)` in an arc.

If `toolRounds` is 0, no tools are offered, `see_map` included.

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
  internals.ts       what library constructors hand the director (closures over private state)
  director/          ArcDirector facade and its parts (Cast, Watches, Dispatcher), features, specs, regions
  character/         ArcRunner, Character, Persona, NameBook, watches, sight focus
  mind/              Mind, prompts, name/id translation, TalkNet, map, knowledge
  collective/        Collective, its verbs, who, tags, memory handover
  think/             MindQueue: PriorityThinkQueue, SimpleThinkQueue
  expr/              watch language, catalog, stringify
  arc/               verbs, parse, wire (JSON), validate, runArc, laws
  world/             HostWorld, routes, moving characters, stock world verbs, watch geometry
  rts/               withRTS: the stock RTS verbs, run on the game's primitives
  genre/             withRPG and withMOBA: their verbs, run by the game's handlers
  memory/            MemoryStore
  search/            searchTool: look-ahead search tools
  perception/        optional scene English
  inference/         HTTP chat, fake, presets, model catalog
  scenario/          scene simulator: SceneWorld, combat, SceneRTS, playScenario
  bench/             System One and arc benches (`arc-director/bench`), bench CLI
  scripts/           demo + fixtures
  testing/           `arc-director/testing`: fake model, soloCharacter, scene simulator; test fixtures
```
