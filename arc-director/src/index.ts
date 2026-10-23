export { extractJson, isRecord, type JsonSchema } from './json.js';

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
export { showLoadingBar, type LoadingBarOptions } from './inference/loadingBar.js';
export { BROWSER_DECISION_MODELS, browserModelURL, BrowserProvider, DEFAULT_BROWSER_MODEL, Skaldic, SKALDIC_BROWSER_MODELS, inPageFetch, type BrowserProviderOptions } from './inference/browser.js';
export { fittingModel, gpuMemory, memoryOf, type GPUMemory } from './inference/device.js';
export { DownloadCancelled, ModelDownload, type DownloadObserver, type DownloadProgress, type DownloadSubscription } from './inference/download.js';
export { HttpProvider, parseChatTimings, mergeClientTimings, loadConfigFits, type HttpProviderConfig, type HttpLoadConfig, type ModelSettings, type ReasoningEffort, REASONING_EFFORTS, serverRoot } from './inference/http.js';
export {
	type ApplyPromptTemplate,
	type PromptTemplateMessage,
} from './inference/assistantThink.js';
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
	fakeInference,
	lmStudioConfig,
	ollamaConfig,
	LM_STUDIO_URL,
	OLLAMA_URL,
	LM_STUDIO_LOAD,
	type HttpInferenceOpts,
} from './inference/presets.js';
export {
	FakeProvider,
	goToNamedInteractable,
	hashEmbed,
	type FakeChatFn,
	type FakeEmbedFn,
} from './inference/fake.js';

export type { Arc, ArcResult, CountMap, Join, Step } from './arc/types.js';
export { arcSteps, firstStep, isArc, isHoistedWhen, isIssue } from './arc/types.js';
export { ArcError, BlockedArcError, JOIN_SYMBOL, JOINS, SYMBOL_JOIN } from './arc/types.js';
export { VerbRegistry, registerStockVerbs, STOCK_VERBS, STOCK_MOVE_VERBS, STOCK_ITEM_VERBS, STOCK_TRADE_VERBS, STOCK_MIND_VERBS, STOCK_ARC_VERBS, CHOOSE_VERB, GROUP_VERB, STOCK_VERB_DEFS, MIND_ONLY_VERBS, type StockVerb, type VerbArgKind, type VerbArgMap, type VerbDef, type VerbSpec } from './arc/stock-verbs.js';
export { replySchema, verbHelp } from './arc/schema.js';
export { validateArc, validateStep } from './arc/validate.js';
export { formatArc, formatArcBlocks, formatStep, parseArcText } from './arc/parse.js';
export { arcArg, arcFromJSON, arcJSONText, arcToJSON, parseArc } from './arc/wire.js';

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
} from './perception/types.js';
export type { Inventory } from './perception/inventory.js';
export { defaultLandmarkTier, groundAndFigure } from './perception/ground.js';
export { bareName, builtinLodLayers, pascalCase } from './perception/lod.js';
export {
	attachmentStringifier,
	basicPluralize,
	builtinStringifiers,
	proximityPairStringifier,
	tagCrowdStringifier,
} from './perception/stringifiers.js';
export { formatSight, formatSightClauses, joinSightClauses, orderSightClauses, mergeHiveClauses, dedupIntersectingClauses, clauseScore, quantizeDistance, hypotAt, bearingOf, DEFAULT_SIGHT } from './perception/sight.js';
export { AUDIBLE, clarityAt, DEFAULT_HEARING, heardText, LOUD, loudnessAfter, loudnessFor, noiseHelp, reachOf, type HearingRange, type Sound, type SoundListener, type SoundSource } from './perception/hearing.js';
export { formatInventory } from './perception/formatInventory.js';

export type { ArcFormat, ConversationTurn, MindEvent, Sense, ToolSpec } from './mind/types.js';
export type { Identity, Goal, Kit, KitSource, WatchInput, Watches } from './character/types.js';
export { NameBook, type NameBookJSON, type NameTarget } from './character/names.js';
export { Persona, type PersonaJSON, type PersonaSpec } from './character/persona.js';
export { ArcRunner, sayToOf, type ArcRunnerJSON, type RunnerDeps, type RunnerOptions } from './character/arc-runner.js';
export { Character, type CharacterJSON, type CharacterOptions } from './character/character.js';
export type { ChoicePrompt } from './character/choice.js';
export { Mind, conversationCapFor, DEFAULT_MENTION_CAP, DEFAULT_TOOL_ROUNDS, type MindDeps, type MindJSON, type MindOwner, type MindSettings } from './mind/mind.js';
export { idsOf, namesOf, mapArc, mapExpr, mapLawName, type WordMap } from './mind/ids.js';
export { soloCharacter, type SoloOptions } from './testing/solo.js';
export {
	applyWatchOps,
	asWatch,
	asWatches,
	findWatchName,
	formatWatch,
	formatWatches,
	hasWatch,
	watchKey,
	type WatchOps,
} from './character/watch.js';
export {
	stampMap,
	formatLegend,
	clampMapZoom,
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
export { ChatSystemOne, JevSystemOne, ModelSystemOne, type DecidingModel, type JevOpts, type SystemOne } from './inference/systemone.js';
export { nextTurn } from './turn.js';
export { sceneKinds, SceneWorld, THEM, US, type Scene, type SceneRTSSpec, type SceneRules, type SceneSpot, type SceneVerb } from './scenario/world.js';
export { ABILITIES, abilityHelp, FIGHTERS, type Ability, type Effect, type FighterKind, type StatusKind, type Tactic } from './scenario/combat.js';
export { acceptOffer, answerSpeech, idleScenario, playScenario, SCENE_TICK, sceneSearch, type Scenario, type ScenarioEnd, type SceneCtx, type SceneSearch } from './scenario/play.js';
export { SceneRTS } from './scenario/rts.js';
export { arcRepairHint, repeatOutputHint, sayRangeHint, shortTermBlock, stablePrefix, volatileBlock, watchCheatSheet, DEFAULT_THINK_INSTRUCTIONS, DEFAULT_VERB_INSTRUCTIONS, DEFAULT_COLLECTIVE_INSTRUCTIONS, type PromptStyle, type ThinkInstructions, SEE_MAP_HINT, seeMapHint, knowledgeHint } from './mind/prompt.js';
export {
	TalkNet,
	DEFAULT_TALK_CONFIG,
	muffleSpeech,
	speechMentionsName,
	type SayResult,
	type SayTo,
	type SpeechUtterance,
	type TalkConfig,
	type Repeats,
	type TalkMind,
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
	withThinkQueue,
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
	type WithThinkQueue,
} from './think/queue.js';
export {
	Collective,
	STOCK_COLLECTIVE_VERBS,
	STOCK_COLLECTIVE_VERB_DEFS,
	STOCK_FORMATION_VERBS,
	registerStockCollectiveVerbs,
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
export { ArcDirector, type CastJSON } from './director/director.js';
export type { RegionShape, RegionSpec } from './director/regions.js';
export { search, searchText, searchTool, type SearchCandidate, type SearchMove, type SearchResult, type SearchSpec } from './search/search.js';
export { RTS_COMMANDER_VERBS } from './rts/rts.js';
export { registerStockRTSVerbs, STOCK_CITY_VERBS, STOCK_ECONOMY_VERBS, STOCK_RTS_VERB_DEFS, STOCK_RTS_VERBS, STOCK_SIDE_VERBS, STOCK_UNIT_VERBS, type StockRTSVerb } from './rts/verbs.js';
export type { KindSpec, PolicySpec, RTSHost, WorkDone } from './rts/types.js';
export { STOCK_MOBA_VERB_DEFS, STOCK_RPG_VERB_DEFS, type MOBAHost, type RPGHost } from './genre/verbs.js';
export { DEFAULT_MAX_PARALLEL, type BrowserModelSpec, type EmbeddingSpec, type InferenceSource, type ModelSpec } from './director/models.js';
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
	StartOpts,
	VerbCall,
	VerbHandler,
	AliasPart,
	VerbAlias,
} from './director/types.js';
export { RESERVED_TAGS } from './world/types.js';
export type { HostWorld, Outcome, PathStep, Pose, Transfer, Vec } from './world/types.js';
export { Deal } from './world/deal.js';
export type { Crowd, CrowdSettings, MoveOpts } from './world/mover.js';
export { OfferBook, bundleText, countOf, covers, isEmpty, offerText, type Offer, type OfferMatch } from './world/offers.js';
export { awayGoal, findRoute, pointGoal, reachablePoints, type Blocked, type Route, type RouteGoal, type RouteWorld } from './world/route.js';
