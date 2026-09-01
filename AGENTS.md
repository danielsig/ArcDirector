# Agent notes

This repo is an **LLM NPC framework** with a small 3D game attached so we can test it. The library is the product; the dungeon/glen is the host.

| Folder | Package | Job |
|--------|---------|-----|
| `arc-director/` | `arc-director` | Engine-agnostic agents: plan, memory, perception, talk, HTTP inference. No Vue, no Three, no physics. |
| `kindling/` | `@arc-director/kindling` | GameObject runtime: `Game`, `World`, `Component`, tick, physics, Three.js view. Hosts subclass; they do not own this. |
| `game/` | `@arc-director/game` | Example host used for testing: walkable world, items, streaming chunks, Vue HUD, adapter into ArcDirector. Subclasses Kindling. |
| `brainstorming/` | none | Concept art and old notes. |

pnpm workspace at the repo root (`package.json`, `pnpm-workspace.yaml`).

## Stack

- **Language:** TypeScript (strict), pnpm workspaces, not a single root `src/`. 2–3 letter acronyms `ID` / `HP` / `NPC` / `URL` / `UTC` (`NPCDirector`, `npcID`; never `Id`, `Hp`, `Npc`, `Url`, `Utc`). Not units (`Mb` ≠ `MB`, `Ms` ≠ `MS`).
- **`arc-director`:** pure TS library. Local models over HTTP (LM Studio / Ollama).
- **`kindling`:** Unity-shaped runtime. Owns canvas, `Renderer`, frame loop, `GameObject` / `Transform` / physics. Three.js is the scene graph.
- **`game`:** Vue 3 (Composition API, one SFC per file) + Vite. Subclasses Kindling `Game` / `World` / `GameObject` / `Component`. Simulation is not Vue state; HUD is DOM over the canvas.

## Kindling (rough)

Unity-shaped, not Unity. `@arc-director/kindling` owns the canvas, `Renderer`, RAF loop, and scene (`world.native`). Hosts **subclass** `Game` / `World` / `GameObject` / `Component`; they do not own this package. Identity on a GameObject is `id`. Deeper API: `kindling/README.md`. Playground: `pnpm --filter @arc-director/kindling dev` → `http://localhost:5174/`.

### Types

| Type | Role |
|------|------|
| `Game` | Canvas, renderer, `start`/`stop`, `tick` → `simulate`. Generic over `World`. |
| `World` | Object list, Three.js `Scene`, `add` / `remove` / `destroy`, `sampleTerrain`. |
| `GameObject` | `id`, `name`, `parent`/`children`, component list. |
| `Transform` | Always present. Wraps `Object3D`. `position` / `yaw` / `pitch` / `roll` are world. |
| `Component` | Host logic. `enabled`, `static order`. |
| `Time` | `time`, `deltaTime`, `fixedDeltaTime` (0.02), `fixedTime`. Clamp `MAX_DT` = 0.05. |
| `Rigidbody` | XZ `velocity`; optional `grounded` Y snap. |
| `BoxCollider` | XZ AABB; `solid` / `isTrigger` / `pad` (crowd). |
| `Camera` / `Light` / `MeshRenderer` | View. Renderer finds the first enabled `Camera`. |
| `Renderer` | WebGL, fog/hemi/fill/sun look, resize. Null when headless. |

### Hierarchy

`GameObject.setParent(parent, worldPositionStays = true)` reparents in both Kindling and Three.js. Adding a parent to a world registers the whole tree. `World.destroy` / `Game.destroy` queues end-of-frame destroy (children follow, `onDestroy`). `World.remove` unregisters one object now (no `onDestroy`, children stay).

### Component callbacks

Lifecycle (Unity-like): `awake` + `onEnable` when the object joins a world → `fixedUpdate` (if a fixed step is due) → `start` once → `update` → physics → `lateUpdate` → end-of-frame destroy (`onDisable` then `onDestroy`). Toggle `enabled` fires `onEnable` / `onDisable`. Disabled components skip `start` and the tick hooks.

Per type: `static order` (lower first). Optional `static update` / `fixedUpdate` / `lateUpdate(dt, list)` run once per type, then instance overrides.

### Frame

`simulate(dt)`: drain `fixedUpdate` → `start` → `update` → `stepPhysics` → `lateUpdate` → `flushDestroy`. Hosts that own pause override `tick` and **do not** call `super.tick` (that would advance `Time` twice). Set `Time.deltaTime` / `Time.time`, then `this.simulate(dt)`.

## Axes (Y-up, right-handed, Three.js)

Ground is **XZ**. **Y** is height (tile height underfoot). Yaw is around Y, in radians.

| Axis | Direction |
|------|-----------|
| **+X** | east (Abbey `EastGate` / vault chunk) |
| **−X** | west |
| **+Y** | up |
| **−Y** | down |
| **−Z** | north (top of a glyph map; yaw `0` faces this way) |
| **+Z** | south |

WASD is camera-relative on XZ. NPCs never see these numbers; actions and prompts use names only. URL `observer`/`ai` (and agent-only `view`) are **testing-only** (see below).

## Dev server

From the repo root:

```
pnpm --filter @arc-director/game dev
```

The game is served at `http://localhost:5173/` (Vite default). There is no path router. All deep links are **query params** on `/`.

## URL query schema

`scene` is the real deep link. **`observer` / `ai` are testing flags** kept in the address bar (and localStorage). **`view` is agent-only:** never add it when playing as a user. Player pose (position + camera yaw) autosaves to localStorage; `view` overrides that pose when present.

| Param | Kind | Meaning |
|-------|------|---------|
| `scene` | play | Scene id. `abbey_vault`, `glen`, or `marketplace`. Omit (or unknown id) → scene picker. |
| `observer` | test | `1` = player is inperceivable by NPCs (observer). `0` = NPCs can see, hear, and walk to the player. Also `true`/`false`. |
| `ai` | test | `1` = ArcDirector runs (NPCs think and move). `0` = paused (no inference, NPC motors frozen). Also `true`/`false`. |
| `view` | agent | Full camera shot: `x,y,z,yaw`. All four numbers or the param is ignored (no partial pose). X/Z are meters on the ground; Y is height; yaw is radians. `0` yaw looks toward −Z (north); `1.5708` (π/2) toward −X (west); `3.1416` (π) toward +Z (south). Yaw also faces the player. Camera follows the player. |

**Defaults** (when the param is omitted and nothing is stored): **`observer=1`**, **`ai=1`**. Menu **Testing** toggles write both to localStorage and the URL; they survive reloads. Query params override the stored values for the fields you set.

Pose comes from autosave (or last view blob if there is no autosave). **`view` overrides that pose as a whole.** World and agent JSON still load from autosave.

While a scene is running, the game `replaceState`s `observer` and `ai`. It never injects `view` for a normal play session. If `view` is already in the query (agent test), it is kept in sync so the bar stays a copyable shot. Returning to Scenes strips them.

### Examples

Scene picker:

```
http://localhost:5173/
```

Play (autosave pose, default flags):

```
http://localhost:5173/?scene=abbey_vault
```

Agent forced test view (prefer this when checking a specific place):

```
http://localhost:5173/?scene=glen&view=8,0,12,1.57
```

Marketplace (street looking west):

```
http://localhost:5173/?scene=marketplace&view=16,0,8,1.57
```

### Testing / screenshots

When the work is visual or location-specific, **agents must pass `view`**. Do not treat a default spawn / last-autosave glance as enough.

1. Open a `scene` + `view` URL (include `observer`/`ai` as needed). After moving, copy the bar. `view` stays in sync only if it was already present.
2. Wait until the canvas has rendered (spritesheet load).
3. Take a screenshot. Open the pause menu only with the top-right **Menu** button. Esc does not toggle it.

Need a distant chunk: put that X/Z in `view` so the streaming anchor (the player) loads it.

Recommended flag values:

| What you are testing | Flags |
|----------------------|--------|
| World, meshes, lighting, HUD, streaming (no NPC motion or inference) | `observer=1&ai=0` |
| Watch NPCs act without them noticing you (default) | `observer=1&ai=1` |
| Talk, give, or otherwise interact as a visible player | `observer=0&ai=1` |

Example: glen screenshot with ArcDirector paused:

```
http://localhost:5173/?scene=glen&view=8,0,12,1.57&observer=1&ai=0
```

Example: marketplace with ArcDirector paused:

```
http://localhost:5173/?scene=marketplace&view=16,0,8,1.57&observer=1&ai=0
```
