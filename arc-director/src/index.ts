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
	PREFERRED_MODELS,
	MODEL_TIERS,
	asModelList,
	fetchModelCatalog,
	isEmbeddingModel,
	isLoadedModel,
	isThinkingModel,
	isVisionModel,
	thinkOffMode,
	pickSingleChatModel,
	modelIDsMatch,
	type ModelInfo,
	type ModelTier,
	type ThinkOff,
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

export type { ActionPlan, ActionResult, Join, Step } from './action/types.js';
export { ActionError, JOIN_SYMBOL, JOINS, SYMBOL_JOIN } from './action/types.js';
export { VerbRegistry, registerStockVerbs, STOCK_VERBS, STOCK_MOVE_VERBS, STOCK_ITEM_VERBS, STOCK_MIND_VERBS, STOCK_VERB_ARGS, type StockVerb, type VerbArgKind, type VerbArgMap, type VerbSpec } from './action/registry.js';
export { actionPlanSchema, verbHelp } from './action/schema.js';
export { asPlan, asStep, validatePlan, validateStep } from './action/validate.js';
export { formatPlan, formatStep, parsePlan, parsePlanText } from './action/parse.js';

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
export { formatSight, quantizeDistance, hypotAt, bearingOf, DEFAULT_SIGHT } from './perception/sight.js';
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
export { Agent, type AgentDeps, type AgentJSON, type AgentOptions } from './agent/agent.js';
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
export { runPlan, deferThinks, planSteps, THINK_ABOUT_CAP } from './agent/run.js';
export { planRepairHint, sayRangeHint, shortTermBlock, stablePrefix, volatileBlock, WATCH_CHEAT_SHEET, SEE_MAP_HINT, seeMapHint } from './agent/prompt.js';
export {
	TalkNet,
	DEFAULT_TALK_CONFIG,
	muffleSpeech,
	speechMentionsName,
	roleMentionTitles,
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
	actionThinkScore,
	planActionScore,
	waitForOf,
	ACTION_THINK_SCORES,
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
export { ArcDirector } from './director/director.js';
export type {
	AgentSpec,
	DirectorLog,
	InferClock,
	KernelSource,
	StartOpts,
	VerbCall,
	VerbHandler,
} from './director/types.js';

