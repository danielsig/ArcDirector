/**
 * The host contract: what a game implements or hands ArcDirector, in the order a port implements it. The C# and C++
 * ports implement this file; `index.ts` exports it with the rest of the library.
 *
 * Where TypeScript takes either a value or a function, a port offers one form, the one named here: a kit, a goal's
 * `until` and a region's `memory` / `who` are functions of the context (a watch string is `ctx => isMet(watch, ctx)`
 * on the port side); a hearing range is the object of numbers; a genre verb is `{ help?, handler }`; a `NamingText` is
 * the function of `name` (a plain string is one that calls it for no one).
 */

// The world: one interface, with parts that unlock verbs (`geometry`, `routes`, `transfers`, `useItem`, `getDescription`).
export { Medium, RESERVED_TAGS } from './world/world-types.js';
export type { HostWorld, Outcome, Passage, Pose, RayHit, Transfer, Vec, WorldGeometry, WorldRoutes, WorldTransfers } from './world/world-types.js';
export { Axes } from './world/axes.js';
export { WORLD_VERB_PART, type WorldPart } from './world/world-verbs.js';
export { Deal } from './world/deal.js';

// What a character perceives, as the host hands it over.
export { Bearing, BearingMode } from './perception/perception-types.js';
export type { Sighting, SeenObject, Sight } from './perception/perception-types.js';
export type { Inventory } from './perception/carrying.js';
export type { HearingRange, Sound } from './perception/hearing.js';
export type { MapSense } from './mind/map.js';
export type { TalkSense } from './mind/talk.js';

// The watch language: what the host shows of the world (`withKernels`), and its own functions (`withFunctions`).
export type { ExprEntity, ExprVal, NativeFn } from './expr/index.js';

// Specs: who is in the cast, and what they may do.
export type { CharacterSpec, CollectiveSpec, Requirement, StandingChoice } from './director/director-types.js';
export type { Goal, Kit, KitSource } from './character/character-types.js';
export type { LawSpec } from './arc/laws.js';
export type { RegionSpec } from './director/RegionsFeature.js';
export type { ArgSpec, VerbArgKind, VerbDef, VerbSpec } from './arc/stock-verbs.js';
export type { JsonValue } from './json.js';

// What the director tells the host, and asks of it.
export type { DirectorLog, NameObserver, SeenName, VerbCall, VerbHandler } from './director/director-types.js';
export type { ArcFormat, MindEvent, Sense, ThinkEvent, ToolSpec } from './mind/mind-types.js';
export type { NameTarget } from './character/NameBook.js';
export type { ArcResult, ArcStatus, Join } from './arc/arc-types.js';
export { showNamingText, type NamingText } from './character/text-with-ids.js';
export type { Crowd } from './world/mover.js';
export type { ThinkReason } from './think/queue.js';
export type { PromptStyle } from './mind/prompt.js';

// Inference: the seam every model server is reached through.
export type {
	ChatRequest, ChatResponse, InferenceProvider, JsonSchemaResponseFormat, ToolDef,
} from './inference/provider.js';
export type { SystemOne } from './inference/system-one.js';

// Genre hosts.
export type { RTSHost } from './rts/rts-types.js';
export type { MOBAHost, RPGHost } from './genre/genre.js';
