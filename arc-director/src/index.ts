export { extractJson, isRecord, type JsonSchema } from './json.js';
export { pascalCase } from './text.js';

export type {
	ChatContent,
	ChatContentPart,
	ChatImagePart,
	ChatMessage,
	ChatRequest,
	ChatResponse,
	ChatRole,
	ChatTextPart,
	InferenceProvider,
	JsonSchemaResponseFormat,
	ToolCall,
	ToolChoice,
	ToolDef,
} from './inference/provider.js';
export { chatContentText, DEFAULT_SAMPLING, type Sampling } from './inference/provider.js';
export { showLoadingBar, type LoadingBarOptions } from './inference/loading-bar.js';
export { BROWSER_DECISION_MODELS, browserModelURL, BrowserProvider, DEFAULT_BROWSER_MODEL, Skaldic, SKALDIC_BROWSER_MODELS, inPageFetch, type BrowserProviderOptions } from './inference/browser.js';
export { fittingModel, gpuMemory, memoryOf, type GPUMemory } from './inference/device.js';
export { DownloadCanceled, ModelDownload, type DownloadObserver, type DownloadProgress, type DownloadSubscription } from './inference/download.js';
export { HttpProvider, parseChatTimings, loadConfigFits, type HttpProviderConfig, type HttpLoadConfig, type ModelSettings, type ReasoningEffort, REASONING_EFFORTS, serverRoot } from './inference/http.js';
export {
	type ApplyPromptTemplate,
	type PromptTemplateMessage,
} from './inference/assistant-think.js';
export {
	PREFERRED_MODELS,
	MODEL_TIERS,
	asModelList,
	fetchModelCatalog,
	isEmbeddingModel,
	isLoadedModel,
	isThinkingModel,
	isVisionModel,
	thinkOffMode,
	pickReasoningOption,
	modelGrade,
	isDecisionModel,
	isEncoderModel,
	findModel,
	pickSingleChatModel,
	modelIDsMatch,
	recommendedSampling,
	trainedOnArcDirector,
	type ModelInfo,
	type ModelTier,
	type ThinkOff,
	type ReasoningOption,
	REASONING_OPTIONS,
} from './inference/models.js';
export {
	lmStudioConfig,
	ollamaConfig,
	LM_STUDIO_URL,
	OLLAMA_URL,
	LM_STUDIO_LOAD,
	type HttpInferenceOpts,
} from './inference/presets.js';

export type { Arc, ArcResult, CountMap, Join, Step } from './arc/arc-types.js';
export { arcSteps, firstStep, isArc, isHoistedWhen } from './arc/arc-types.js';
export { ArcError, BlockedArcError, JOIN_SYMBOL, JOINS, SYMBOL_JOIN } from './arc/arc-types.js';
export { VerbRegistry, STOCK_VERBS, STOCK_MOVE_VERBS, STOCK_ITEM_VERBS, STOCK_TRADE_VERBS, STOCK_MIND_VERBS, STOCK_ARC_VERBS, CHOOSE_VERB, GROUP_VERB, STOCK_VERB_DEFS, MIND_ONLY_VERBS, type StockVerb, type VerbArgKind, type VerbArgMap, type VerbDef, type VerbSpec } from './arc/stock-verbs.js';
export { replySchema, verbHelp } from './arc/schema.js';
export { validateArc } from './arc/validate.js';
export { formatArc, formatArcBlocks, formatStep, parseArcText } from './arc/arc-parse.js';
export { arcArg, arcFromJSON, arcJSONBlocks, arcJSONText, arcToJSON, parseArc } from './arc/wire.js';

export {
	MemoryStore,
	cosine,
	defaultRecallScore,
	type MemoryCategory,
	type MemoryDraft,
	type MemoryRecord,
	type RecallScoreFn,
} from './memory/store.js';

export type {
	Bearing,
	DescribeCtx,
	SightOpts,
	LodCtx,
	LodLayer,
	RelationshipHit,
	RelationshipStringifier,
	SeenObject,
	Sight,
	SightClause,
	StringifyCtx,
} from './perception/perception-types.js';
export type { Inventory } from './perception/format-inventory.js';
export { defaultLandmarkTier, groundAndFigure } from './perception/ground.js';
export { bareName, builtinLodLayers } from './perception/lod.js';
export {
	attachmentStringifier,
	basicPluralize,
	builtinStringifiers,
	proximityPairStringifier,
	tagCrowdStringifier,
} from './perception/stringifiers.js';
export { formatSight, formatSightClauses, joinSightClauses, orderSightClauses, mergeHiveClauses, quantizeDistance, bearingOf, DEFAULT_SIGHT } from './perception/sight.js';
export { AUDIBLE, clarityAt, DEFAULT_HEARING, heardText, LOUD, loudnessAfter, loudnessFor, noiseHelp, reachOf, type HearingRange, type Sound, type SoundListener, type SoundSource } from './perception/hearing.js';
export { formatInventory } from './perception/format-inventory.js';

export type { ArcFormat, ConversationTurn, MindEvent, Sense, ThinkEvent, ToolSpec } from './mind/mind-types.js';
export { GOAL_PINNED_THINKS, type Identity, type Goal, type Kit, type KitSource, type WatchInput, type Watches } from './character/character-types.js';
export { NameBook, type NameBookJSON, type NameTarget } from './character/NameBook.js';
export { Persona, type PersonaJSON, type PersonaSpec } from './character/Persona.js';
export { ArcRunner, sayToOf, type ArcRunnerJSON, type RunnerDeps, type RunnerOptions } from './character/arc-runner.js';
export { Character, type CharacterJSON, type CharacterOptions } from './character/Character.js';
export type { ChoicePrompt } from './character/choice.js';
export { Mind, DEFAULT_MENTION_CAP, DEFAULT_TOOL_ROUNDS, type MindDeps, type MindJSON, type MindOwner, type MindSettings } from './mind/mind.js';
export { idsOf, namesOf, mapArc, mapExpr, mapLawName, type WordMap } from './mind/ids.js';
export {
	applyWatchOps,
	asWatches,
	findWatchName,
	formatWatches,
	hasWatch,
	type WatchOps,
} from './character/watch.js';
export {
	stampMap,
	formatLegend,
	parseMapZoom,
	DEFAULT_YOU_SYMBOL,
	type MapMark,
	type MapPrev,
	type MapSense,
	type MapSnapshot,
	type StampedMap,
} from './mind/map.js';
export {
	KNOW_CAP,
	knowledgePages,
	knowledgeFor,
	crowdKnowledge,
	type KnowledgeEntry,
	type KnowledgeSource,
	type CrowdKnowledgeSpec,
} from './mind/knowledge.js';
export { runArc, deferThinks, THINK_ABOUT_CAP, type ArcPick, type LastChoice } from './arc/run.js';
export { CHOICE_RESERVED, MAX_CHOICES } from './arc/choose.js';
export { ChatSystemOne, JevSystemOne, ModelSystemOne, type DecidingModel, type JevOpts, type SystemOne } from './inference/system-one.js';
export { nextTurn } from './turn.js';
export { arcRepairHint, repeatOutputHint, sayRangeHint, stablePrefix, volatileBlock, DEFAULT_THINK_INSTRUCTIONS, DEFAULT_VERB_INSTRUCTIONS, DEFAULT_COLLECTIVE_INSTRUCTIONS, type PromptStyle, type ThinkInstructions, seeMapHint } from './mind/prompt.js';
export {
	TalkNet,
	DEFAULT_TALK_CONFIG,
	type SayResult,
	type SayTo,
	type SpeechUtterance,
	type TalkConfig,
	type Repeats,
	type TalkListener,
	type TalkSense,
} from './mind/talk.js';

export {
	evaluate,
	parse,
	buildCatalog,
	dummyEntity,
	stringifyVal,
	observeExpr,
	watchScore,
	SampleCache,
	ExprError,
	leftoverFilterHint,
	DEFAULT_TRUE_SCORE,
	DEFAULT_EPSILON,
	FACING_COS,
	type Catalog,
	type ExprEntity,
	type EvalResult,
	type ExprVal,
	type HostKernels,
	type StringifierKind,
	type Stringifiers,
} from './expr/index.js';
export {
	ThinkQueue,
	SimpleQueue,
	thinkRecencyScale,
	verbThinkScore,
	arcScore,
	waitUntilOf,
	VERB_THINK_SCORES,
	THINK_BARE_SCORE,
	THINK_ABOUT_SCORE,
	withPriorityQueue,
	withSimpleQueue,
	DEFAULT_BATCH_THINKS,
	DEFAULT_BATCH_WAIT,
	type ThinkQueueOpts,
	type SimpleQueueOpts,
	type ThinkRow,
	type ThinkReason,
	type ThinkBatchOpts,
	type MayThink,
	type HeartbeatAdjust,
	type MindQueue,
	type MindQueueOpts,
	type WithMindQueue,
} from './think/queue.js';
export {
	Collective,
	STOCK_COLLECTIVE_VERBS,
	STOCK_COLLECTIVE_VERB_DEFS,
	STOCK_FORMATION_VERBS,
	isFormationVerb,
	squadTag,
	shortTag,
	shortTags,
	evaluateWho,
	buildCollectiveCatalog,
	chatHandover,
	HANDOVER_MEMORY_CAP,
	HANDOVER_THREAD,
	type Handover,
	type Journey,
	type MemoryEdit,
	type CollectiveJSON,
	type CollectiveOptions,
	type StockCollectiveVerb,
} from './collective/index.js';
export { DEFAULT_MAX_LAWS, lawGroup, type Law, type LawSpec } from './arc/laws.js';
export { ArcDirector, type CastJSON } from './director/ArcDirector.js';
export type { RegionShape, RegionSpec } from './director/regions.js';
export { search, searchText, searchTool, type SearchCandidate, type SearchMove, type SearchResult, type SearchSpec } from './search/search.js';
export { RTS_COMMANDER_VERBS } from './rts/rts.js';
export { STOCK_CITY_VERBS, STOCK_ECONOMY_VERBS, STOCK_RTS_VERB_DEFS, STOCK_RTS_VERBS, STOCK_SIDE_VERBS, STOCK_UNIT_VERBS, type StockRTSVerb } from './rts/rts-verbs.js';
export type { KindSpec, PolicySpec, RTSHost, WorkDone } from './rts/rts-types.js';
export { STOCK_MOBA_VERB_DEFS, STOCK_RPG_VERB_DEFS, type MOBAHost, type RPGHost } from './genre/genre-verbs.js';
export { DEFAULT_MAX_PARALLEL, type BrowserModelSpec, type EmbeddingSpec, type InferenceSource, type ModelSpec } from './director/model-registry.js';
export type {
	CharacterSpec,
	CollectiveSpec,
	DirectorLog,
	InferClock,
	KernelSource,
	NameObserver,
	SeenName,
	StockVerbArgs,
	StockVerbName,
	VerbArgs,
	VerbGate,
	StandingChoice,
	VerbCall,
	VerbHandler,
	AliasPart,
	VerbAlias,
} from './director/director-types.js';
export { RESERVED_TAGS } from './world/world-types.js';
export type { HostWorld, Outcome, PathStep, Pose, Transfer, Vec } from './world/world-types.js';
export { Deal } from './world/deal.js';
export type { Crowd, CrowdSettings, MoveOpts } from './world/mover.js';
export { OfferBook, bundleText, countOf, covers, isEmpty, offerText, type Offer, type OfferMatch } from './world/offers.js';
export { awayGoal, findRoute, pointGoal, reachablePoints, type Blocked, type Route, type RouteGoal, type RouteWorld } from './world/route.js';
