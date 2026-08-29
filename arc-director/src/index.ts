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
export { HttpProvider, parseChatTimings, mergeClientTimings, type HttpProviderConfig, type HttpLoadConfig, type ReasoningEffort, REASONING_EFFORTS, serverRoot } from './inference/http.js';
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
	type ModelInfo,
	type ModelTier,
	type ThinkOff,
} from './inference/models.js';
export { InferenceQueue, withQueue } from './inference/queue.js';
export {
	FakeProvider,
	goToNamedInteractable,
	hashEmbed,
	type FakeChatFn,
	type FakeEmbedFn,
} from './inference/fake.js';

export type { ActionPlan, ActionResult, Join, Step } from './action/types.js';
export { ActionError, JOIN_SYMBOL, JOINS, SYMBOL_JOIN } from './action/types.js';
export { VerbRegistry, registerCoreVerbs, type VerbArgKind, type VerbArgMap, type VerbSpec } from './action/registry.js';
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
	LodCtx,
	LodLayer,
	PerceptionInput,
	PerceptionObject,
	RelationshipHit,
	RelationshipStringifier,
	StringifyCtx,
} from './perception/types.js';
export { defaultLandmarkTier, groundAndFigure } from './perception/ground.js';
export { builtinLodLayers, pascalCase } from './perception/lod.js';
export {
	attachmentStringifier,
	basicPluralize,
	builtinStringifiers,
	proximityPairStringifier,
	tagCrowdStringifier,
} from './perception/stringifiers.js';
export { describeScene, quantizeDistance } from './perception/describe.js';

export type {
	AgentEvent,
	AgentIdentity,
	Goal,
	GoalRevision,
	PerceptionRecipe,
	Pusher,
	ToolSpec,
} from './agent/types.js';
export { Agent, type AgentDeps, type AgentJSON, type AgentOptions } from './agent/agent.js';
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
export { runPlan } from './agent/run.js';
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
export { ThinkQueue, thinkRecencyScale, type ThinkQueueOpts, type ThinkRow, type HeartbeatAdjust } from './think/queue.js';
