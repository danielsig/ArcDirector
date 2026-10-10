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
export { chatContentText } from './inference/provider.js';
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

export type { Arc, ArcResult, Join, Step } from './arc/types.js';
export { arcSteps, firstStep, isArc, isHoistedWhen, isIssue } from './arc/types.js';
export { ArcError, JOIN_SYMBOL, JOINS, SYMBOL_JOIN } from './arc/types.js';
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
export { builtinLodLayers, pascalCase } from './perception/lod.js';
export {
	attachmentStringifier,
	basicPluralize,
	builtinStringifiers,
	proximityPairStringifier,
	tagCrowdStringifier,
} from './perception/stringifiers.js';
export { formatSight, formatSightClauses, joinSightClauses, orderSightClauses, mergeHiveClauses, dedupIntersectingClauses, clauseScore, quantizeDistance, hypotAt, bearingOf, DEFAULT_SIGHT } from './perception/sight.js';
export { formatInventory } from './perception/formatInventory.js';

export type { ArcFormat, ConversationTurn, MindEvent, Sense, ToolSpec } from './mind/types.js';
export type { Identity, Goal, Kit, KitSource, WatchInput, Watches } from './character/types.js';
export { NameBook, type NameBookJSON, type NameTarget } from './character/names.js';
export { Persona, type PersonaJSON, type PersonaSpec } from './character/persona.js';
export { ArcRunner, sayToOf, type ArcRunnerJSON, type RunnerDeps, type RunnerOptions } from './character/arc-runner.js';
export { Character, type CharacterJSON, type CharacterOptions } from './character/character.js';
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
export { benchSystemOne, DECISION_BENCH, type BenchScore, type DecisionCase, type DecisionLevel, type DecisionSpot, type SkillScore } from './character/bench.js';
export { arcRepairHint, repeatOutputHint, sayRangeHint, shortTermBlock, stablePrefix, volatileBlock, watchCheatSheet, DEFAULT_THINK_INSTRUCTIONS, DEFAULT_VERB_INSTRUCTIONS, DEFAULT_COLLECTIVE_INSTRUCTIONS, type ThinkInstructions, SEE_MAP_HINT, seeMapHint, knowledgeHint } from './mind/prompt.js';
export {
	TalkNet,
	DEFAULT_TALK_CONFIG,
	muffleSpeech,
	speechMentionsName,
	type SayResult,
	type SayTo,
	type SpeechUtterance,
	type TalkConfig,
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
export { DEFAULT_MAX_PARALLEL, type EmbeddingSpec, type InferenceSource, type ModelSpec } from './director/models.js';
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
} from './director/types.js';
export type { Deal, HostWorld, ItemMove, Outcome, PathStep, Pose, Vec } from './world/types.js';
export { awayGoal, findRoute, pointGoal, reachablePoints, type Blocked, type Route, type RouteGoal } from './world/route.js';
