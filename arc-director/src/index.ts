// Every built-in shortcut (`withSight`, `getSight`, `addLMStudio`, …), on ArcDirector before a host calls one.
import './director/shortcuts.js';

export * from './host.js';

export type { JsonSchema } from './json.js';
export { pascalCase } from './text.js';

export type {
	ChatContent, ChatContentPart, ChatImagePart, ChatMessage, ChatRole, ChatTextPart, ToolCall, ToolChoice,
} from './inference/provider.js';
export { chatContentText, DEFAULT_SAMPLING, type Sampling } from './inference/provider.js';
export { showLoadingBar, type LoadingBarOptions } from './inference/loading-bar.js';
export { BROWSER_DECISION_MODELS, browserModelURL, BrowserProvider, DEFAULT_BROWSER_MODEL, Skaldic, SKALDIC_BROWSER_MODELS, inPageFetch, Wllama, type BrowserProviderOptions, type WllamaConfig } from './inference/browser.js';
export { fittingModel, gpuMemory, memoryOf, type GPUMemory } from './inference/device.js';
export { DownloadCanceled, ModelDownload, type DownloadObserver, type DownloadProgress, type DownloadSubscription } from './inference/download.js';
export { HttpProvider, loadConfigFits, type HttpProviderConfig, type HttpLoadConfig, type ModelSettings, type ReasoningEffort, REASONING_EFFORTS, serverRoot } from './inference/http.js';
export {
	type ApplyPromptTemplate, type PromptTemplateMessage,
} from './inference/assistant-think.js';
export {
	PREFERRED_MODELS, MODEL_TIERS, asModelList, fetchModelCatalog, isEmbeddingModel, isLoadedModel, isThinkingModel,
	isVisionModel, thinkOffMode, pickReasoningOption, modelGrade, isDecisionModel, isEncoderModel, findModel,
	pickSingleChatModel, modelIDsMatch, recommendedSampling, trainedOnArcDirector, type ModelInfo, type ModelTier,
	type ThinkOff, type ReasoningOption, REASONING_OPTIONS,
} from './inference/models.js';
export {
	lmStudioConfig, ollamaConfig, LM_STUDIO_URL, OLLAMA_URL, LM_STUDIO_LOAD, Http, LMStudio, Ollama, type HttpConfig,
} from './inference/presets.js';

export type { Arc, CountMap, Step } from './arc/arc-types.js';
export { arcSteps, firstStep, isArc } from './arc/arc-types.js';
export { ArcError, BlockedArcError } from './arc/arc-types.js';
export { Channel } from './arc/Channel.js';
export { VerbRegistry, STOCK_VERBS, STOCK_MOVE_VERBS, STOCK_ITEM_VERBS, STOCK_TRADE_VERBS, STOCK_MIND_VERBS, STOCK_ARC_VERBS, CHOOSE_VERB, GROUP_VERB, PASS_VERB, STOCK_VERB_DEFS, MIND_ONLY_VERBS, type StockVerb, type VerbArgMap } from './arc/stock-verbs.js';
export type { ArgCheck, ArgConstraint, ArgPath } from './arc/constraints.js';
export { replySchema, verbHelp } from './arc/schema.js';
export { DEFAULT_EXPLICIT_THINK_ALLOWED_INSIDE, MAX_ARC_DEPTH, validateArc } from './arc/validate.js';
export { parseArcText } from './arc/arc-parse.js';
export { formatArc, formatArcBlocks, formatStep } from './arc/arc-format.js';
export { arcFromJSON, arcJSONText, arcToJSON, parseArc } from './arc/wire.js';

export {
	FORGETFULNESS, MAX_EPISODIC, MemoryPool, MemorySharing, MemoryStore, recallChance, FORGOTTEN, type MemoryCategory, type MemoryDraft, type MemoryHolding, type MemoryJSON, type MemoryRecord, type Meaning, type RestsOn,
} from './memory/store.js';

export type {
	DescribeCtx, SightOpts, LodCtx, LodLayer, RelationshipHit, RelationshipStringifier, SightClause, StringifyCtx,
} from './perception/perception-types.js';
export { defaultLandmarkTier, groundAndFigure } from './perception/ground.js';
export { bareName, builtinLodLayers } from './perception/lod.js';
export {
	attachmentStringifier, basicPluralize, builtinStringifiers, proximityPairStringifier, tagCrowdStringifier,
} from './perception/stringifiers.js';
export { formatSight, bearingOf, sightingOf, DEFAULT_SIGHT, DEFAULT_SIGHT_RANGE, sightClarityAt, type SightField, type SightRange } from './perception/sight.js';
export { AUDIBLE, DEFAULT_HEARING, LOUD, loudnessFor, type SoundListener, type SoundSource } from './perception/hearing.js';
export { formatInventory, InventoryFeature } from './perception/carrying.js';

export type { ConversationTurn } from './mind/mind-types.js';
export { GOAL_PINNED_THINKS, type Identity, type WatchInput, type Watches } from './character/character-types.js';
export { Knows, KNOWS_ALL, NameBook, STRANGER, type Heard, type NameBookJSON, type Naming } from './character/NameBook.js';
export type { TextSegment } from './character/text-with-ids.js';
export { Persona, type PersonaJSON, type PersonaSpec } from './character/Persona.js';
export { ArcRunner, type ArcRunnerJSON, type Holder, type ProgramMark, type ProgramState, type RunnerDeps, type RunnerOptions } from './character/arc-runner.js';
export { Character, type CharacterJSON, type CharacterOptions } from './character/Character.js';
export type { ChoicePrompt } from './character/choice.js';
export { Mind, DEFAULT_TOOL_ROUNDS, type MindDeps, type MindJSON, type MindOwner, type MindSettings } from './mind/mind.js';
export { type WordMap } from './mind/ids.js';
export {
	asWatches, type WatchOps,
} from './character/watch.js';
export {
	stampMap, DEFAULT_YOU_SYMBOL, type MapMark, type MapPrev, type MapSnapshot, type StampedMap,
} from './mind/map.js';
export {
	crowdKnowledge, type KnowledgeEntry, type KnowledgeSource, type CrowdKnowledgeSpec,
} from './mind/knowledge.js';
export { type ArcPick, type LastChoice, type Reaction } from './arc/run.js';
export { runArc } from './arc/arc-machine.js';
export { DEFAULT_MIN_CHOICES, MAX_CHOICES } from './arc/choose.js';
export { ChatSystemOne, Jev, JevSystemOne, ModelSystemOne, type DecidingModel, type JevConfig, type JevOpts } from './inference/system-one.js';
export { DEFAULT_THINK_INSTRUCTIONS, DEFAULT_VERB_INSTRUCTIONS, DEFAULT_COLLECTIVE_INSTRUCTIONS, type ThinkInstructions } from './mind/prompt.js';
export {
	DEFAULT_TALK_CONFIG, SAY_TONES, SayTone, TalkInstructions, type TalkStyle, type SayResult, type SayTo, type SayToneDef, type SpeechUtterance, type TalkConfig, type Repeats,
} from './mind/talk.js';

export {
	evaluate, parse, dummyEntity, watchScore, ExprError, DEFAULT_TRUE_SCORE, type Catalog, type EvalResult,
	type StringifierKind, type Stringifiers,
} from './expr/index.js';
export {
	PriorityThinkQueue, SimpleThinkQueue, type PriorityThinkQueueOpts, type SimpleThinkQueueOpts, type ThinkRow,
	type MayThink, type MindQueue, type MindQueueOpts,
} from './think/queue.js';
export {
	Collective, STOCK_COLLECTIVE_VERBS, STOCK_COLLECTIVE_VERB_DEFS, STOCK_FORMATION_VERBS, shortTag, OwnMindFeature, type OwnMindCase, type OwnMindOptions, type CollectiveJSON,
	type CollectiveOptions, type StockCollectiveVerb,
} from './collective/index.js';
export { DEFAULT_MAX_LAWS, lawGroup, type Law } from './arc/laws.js';
export { ArcDirector, type CastJSON } from './director/ArcDirector.js';
export { Ticker } from './director/Ticker.js';
export { Feature, type FeatureTick, type WatchKernels } from './director/Feature.js';
export { GoalsFeature, type GoalsOptions } from './character/GoalsFeature.js';
export { FeelingFeature, feelLine, type FeelingCase, type FeelingsOptions } from './character/FeelingFeature.js';
export { AcquaintanceFeature, type AcquaintanceOptions } from './character/AcquaintanceFeature.js';
export { FEELINGS, Feeling, feelingsIn, type FeelingMap, type FeelingDef, type FeelingLevels, type Mood } from './character/feeling.js';
export { RegionsFeature, type RegionShape } from './director/RegionsFeature.js';
export { RequirementsFeature } from './director/RequirementsFeature.js';
export { SightFeature, type SightOptions } from './perception/SightFeature.js';
export { HearingFeature, type HearingOptions } from './perception/HearingFeature.js';
export { MapFeature } from './mind/MapFeature.js';
export { RTSFeature } from './rts/RTSFeature.js';
export { KnowledgeFeature, DEFAULT_MENTION_CAP, type KnowledgeOptions } from './mind/KnowledgeFeature.js';
export { TalkFeature, type SpokenLabel, type TalkOptions } from './mind/TalkFeature.js';
export { OffersFeature } from './world/OffersFeature.js';
export { WorldVerbsFeature, type WorldVerbsOptions } from './world/WorldVerbsFeature.js';
export { StealingFeature, STEAL_VERB_DEF } from './world/StealingFeature.js';
export { Verbs } from './director/Verbs.js';
export { Registry } from './director/Registry.js';
export { search, searchTool, type SearchCandidate, type SearchMove, type SearchResult, type SearchSpec } from './search/search.js';
export { RTS_COMMANDER_VERBS } from './rts/rts.js';
export { STOCK_CITY_VERBS, STOCK_ECONOMY_VERBS, STOCK_RTS_VERB_DEFS, STOCK_RTS_VERBS, STOCK_SIDE_VERBS, STOCK_UNIT_VERBS, type StockRTSVerb } from './rts/rts-verbs.js';
export type { KindSpec, PolicySpec, WorkDone } from './rts/rts-types.js';
export { GenreFeature, STOCK_MOBA_VERB_DEFS, STOCK_RPG_VERB_DEFS } from './genre/genre.js';
export { ModelRegistry, type LiveModel } from './director/model-registry.js';
export { DEFAULT_BATCH_WAIT, DEFAULT_MAX_PARALLEL, ModelProvider, type ModelSpec, type ProvidedModel, type ProviderConfig } from './director/ModelProvider.js';
export { ModelSlots, URGENT, type ModelChat, type ModelRun } from './director/ModelSlots.js';
export { emptyInferClock } from './director/director-types.js';
export type {
	InferClock, KernelSource, StockVerbArgs, StockVerbName, VerbArgs, VerbGate, AliasPart, VerbAlias,
} from './director/director-types.js';

export type { CrowdSettings, MoveOpts, ServingSpot } from './world/mover.js';
export { type Offer, type OfferMatch } from './world/offers.js';
export { awayGoal, findRoute, isOpen, pointGoal, type Blocked, type Route, type RouteGoal, type RouteWorld } from './world/route.js';
