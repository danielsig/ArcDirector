/**
 * `arc-director/testing`: what tests, scripts and benches drive the library with. A fake model, a character wired
 * without a director, and the scenario simulator (a small text world with fights, trades and an RTS). Not for a host.
 */
export { fakeInference } from '../inference/presets.js';
export { FakeProvider, goToNamedInteractable, hashEmbed, type FakeChatFn, type FakeEmbedFn } from '../inference/fake.js';
export { soloCharacter, type SoloOptions } from './solo.js';
export { sceneKinds, SceneWorld, THEM, US, type Scene, type SceneRTSSpec, type SceneRules, type SceneSpot, type SceneVerb } from '../scenario/scene-world.js';
export { ABILITIES, abilityHelp, FIGHTERS, type Ability, type Effect, type FighterKind, type StatusKind, type Tactic } from '../scenario/combat.js';
export { acceptOffer, answerSpeech, idleScenario, playScenario, SCENE_TICK, sceneSearch, type Scenario, type ScenarioEnd, type SceneCtx, type SceneSearch } from '../scenario/play.js';
export { SceneRTS } from '../scenario/SceneRTS.js';
