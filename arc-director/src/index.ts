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
export { HttpProvider, parseChatTimings, mergeClientTimings, loadConfigFits, type HttpProviderConfig, type HttpLoadConfig, type ReasoningEffort, REASONING_EFFORTS, serverRoot } from './inference/http.js';
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
	connectHttpInference,
	lmStudioConfig,
	ollamaConfig,
	LM_STUDIO_URL,
	OLLAMA_URL,
	LM_STUDIO_LOAD,
	type HttpInferenceOpts,
	type ConnectedHttp,
} from './inference/presets.js';
export {
	FakeProvider,
	goToNamedInteractable,
	hashEmbed,
	type FakeChatFn,
	type FakeEmbedFn,
} from './inference/fake.js';

export type { Arc, ArcResult, Join, Step } from './arc/types.js';
export { firstStep, isHoistedWhen, isIssue } from './arc/types.js';
export { ArcError, JOIN_SYMBOL, JOINS, SYMBOL_JOIN } from './arc/types.js';
export { VerbRegistry, registerStockVerbs, STOCK_VERBS, STOCK_MOVE_VERBS, STOCK_ITEM_VERBS, STOCK_TRADE_VERBS, STOCK_MIND_VERBS, STOCK_ARC_VERBS, STOCK_VERB_DEFS, MIND_ONLY_VERBS, type StockVerb, type VerbArgKind, type VerbArgMap, type VerbDef, type VerbSpec } from './arc/stock-verbs.js';
export { arcSchema, verbHelp } from './arc/schema.js';
export { asArc, asStep, validateArc, validateStep, isArc } from './arc/validate.js';
export { formatArc, formatStep, parseArc, parseArcText } from './arc/parse.js';

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

export type {
	AgentEvent,
	AgentIdentity,
	Goal,
	GoalRevision,
	Kit,
	KitSource,
	Sense,
	ToolSpec,
	WatchInput,
	Watches,
} from './agent/types.js';
export { NameBook, type NameBookJSON, type NameTarget } from './agent/names.js';
export { Actor, type ActorDeps, type ActorJSON, type ActorOptions } from './agent/actor.js';
export { Agent, DEFAULT_MENTION_CAP, DEFAULT_TOOL_ROUNDS, type AgentDeps, type AgentJSON, type AgentOptions } from './agent/agent.js';
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
} from './agent/watch.js';
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
} from './agent/map.js';
export {
	GREP_WORLD_ENCYCLOPEDIA,
	encyclopediaPages,
	grepEncyclopedia,
	crowdEncyclopedia,
	type EncyclopediaEntry,
	type EncyclopediaSource,
	type CrowdEncyclopediaSpec,
} from './agent/encyclopedia.js';
export { runArc, deferThinks, arcSteps, THINK_ABOUT_CAP } from './agent/run.js';
export { arcRepairHint, repeatOutputHint, sayRangeHint, shortTermBlock, stablePrefix, volatileBlock, watchCheatSheet, DEFAULT_THINK_INSTRUCTIONS, DEFAULT_VERB_INSTRUCTIONS, DEFAULT_CROWD_INSTRUCTIONS, type ThinkInstructions, SEE_MAP_HINT, seeMapHint, encyclopediaHint } from './agent/prompt.js';
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
} from './agent/talk.js';

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
	Crowd,
	CrowdUnit,
	CrowdConductor,
	isCrowdConductor,
	STOCK_CROWD_VERBS,
	STOCK_CROWD_VERB_DEFS,
	STOCK_FORMATION_VERBS,
	registerStockCrowdVerbs,
	isFormationVerb,
	squadTag,
	shortTag,
	evaluateWho,
	buildCrowdCatalog,
	DEFAULT_MAX_LAWS,
	type CrowdUnitJSON,
	type CrowdUnitSpec,
	type CrowdConductorJSON,
	type CrowdConductorOptions,
	type StockCrowdVerb,
	type CrowdLaw,
	type CrowdLawSpec,
} from './conductor/index.js';
export { ArcDirector } from './director/director.js';
export type {
	ActorSpec,
	AgentSpec,
	DirectorLog,
	InferClock,
	KernelSource,
	NameObserver,
	SeenName,
	StockVerbArgs,
	StockVerbName,
	VerbArgs,
	VerbGate,
	StartOpts,
	VerbCall,
	VerbHandler,
} from './director/types.js';
export type { Deal, HostWorld, ItemMove, Outcome, PathStep, Pose, Vec } from './world/types.js';
export { findRoute, reachablePoints, type Blocked, type Route } from './world/route.js';
