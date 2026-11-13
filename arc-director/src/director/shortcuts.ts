import { withGoals, GoalsFeature } from '../character/GoalsFeature.js';
import { withHandover, HandoverFeature } from '../collective/HandoverFeature.js';
import { withMOBA, withRPG, GenreFeature } from '../genre/genre.js';
import { addWllama, getWllama } from '../inference/browser.js';
import { addFake, getFake } from '../inference/fake.js';
import { addHttp, addLMStudio, addOllama, getHttp, getLMStudio, getOllama } from '../inference/presets.js';
import { addJev, getJev } from '../inference/system-one.js';
import { withKnowledge, KnowledgeFeature } from '../mind/KnowledgeFeature.js';
import { withMap, MapFeature } from '../mind/MapFeature.js';
import { withTalk, TalkFeature } from '../mind/TalkFeature.js';
import { withInventory, InventoryFeature } from '../perception/carrying.js';
import { withHearing, HearingFeature } from '../perception/HearingFeature.js';
import { withSight, SightFeature } from '../perception/SightFeature.js';
import { withRTS, RTSFeature } from '../rts/RTSFeature.js';
import { withSimpleThinkQueue, withPriorityThinkQueue } from '../think/queue.js';
import { withWorldVerbs, WorldVerbsFeature } from '../world/WorldVerbsFeature.js';
import { ArcDirector } from './ArcDirector.js';
import { featureGetter } from './Feature.js';
import { addRegions, RegionsFeature } from './RegionsFeature.js';

/**
 * The one place the built-in features', queues' and providers' shortcuts go onto `ArcDirector`: each `with*` / `add*`
 * is written and declared beside its feature, queue or provider, a feature's `get*` is declared there and built here,
 * and `index.ts` imports this once the class exists, so a host has them whatever it imports first.
 */
Object.assign(ArcDirector.prototype, {
	withGoals,
	getGoals: featureGetter(GoalsFeature),
	withHandover,
	getHandover: featureGetter(HandoverFeature),
	withWorldVerbs,
	getWorldVerbs: featureGetter(WorldVerbsFeature),
	addRegions,
	getRegions: featureGetter(RegionsFeature),
	withSight,
	getSight: featureGetter(SightFeature),
	withInventory,
	getInventory: featureGetter(InventoryFeature),
	withHearing,
	getHearing: featureGetter(HearingFeature),
	withTalk,
	getTalk: featureGetter(TalkFeature),
	withMap,
	getMap: featureGetter(MapFeature),
	withKnowledge,
	getKnowledge: featureGetter(KnowledgeFeature),
	withRTS,
	getRTS: featureGetter(RTSFeature),
	withRPG,
	withMOBA,
	getGenre: featureGetter(GenreFeature),
	withPriorityThinkQueue,
	withSimpleThinkQueue,
	addLMStudio,
	getLMStudio,
	addOllama,
	getOllama,
	addHttp,
	getHttp,
	addWllama,
	getWllama,
	addJev,
	getJev,
	addFake,
	getFake,
} satisfies Partial<ArcDirector>);
