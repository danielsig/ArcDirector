export { Component, type ComponentState } from './core/Component.js';
export { GameObject, allocID, allocSerial, resetAllocID } from './core/GameObject.js';
export { captureWorld, diffWorld, restoreWorld, type ObjectState, type WorldSave, type WorldState } from './core/save.js';
export { Transform, type Vec3 } from './core/Transform.js';
export { World, chunkBounds } from './core/World.js';
export { Chunk } from './core/Chunk.js';
export { ChunkBound, ChunkStreamer, StreamingAnchor } from './core/ChunkStreamer.js';
export { Game } from './core/Game.js';
export { Time, resetTime, MAX_DT } from './core/Time.js';
export { Input, MOUSE_LEFT } from './core/Input.js';
export { Rigidbody } from './core/Rigidbody.js';
export { BoxCollider } from './core/BoxCollider.js';
export { SHOVE_YIELD, stepPhysics, resolveBody, canOccupy, type BlockerOpts } from './core/physics.js';
export { clamp, hash, lerpAngle, yawToForward, yawToward } from './core/math.js';
export type { ChunkBounds, TerrainSample } from './core/World.js';
export type { Constructor, ComponentClass, ComponentInit, KindlingTypes } from './core/types.js';

export { Camera, type ImpactFrame } from './render/Camera.js';
export { Light, polygonCookie, spotThrough, type LightKind } from './render/Light.js';
export { MeshRenderer } from './render/MeshRenderer.js';
export { Renderer, type RendererLook, type RenderStats } from './render/Renderer.js';
export { ShadowCache, type ShadowMode, type ShadowSettings } from './render/ShadowCache.js';
export { OutlinePass, overInk } from './render/OutlinePass.js';
export {
	addEffect,
	addMeshEffect,
	afterimage,
	effectMaterial,
	puff,
	puffPicture,
	shockwave,
	starburst,
	streaks,
	sweep,
	type AfterimageLook,
	type PuffLook,
	type ShockwaveLook,
	type StarburstLook,
	type Streak,
	type SweepLook,
} from './render/effects.js';
export { ToonMaterial, toonRamp, type ToonMaterialParameters, type ToonPattern } from './render/ToonMaterial.js';
export { bevelBox, blob, lathe, mergeParts, ribbon, tube, type PathPoint, type PosedPart, type ProfilePoint } from './render/meshKit.js';
export {
	insertAfterChunk,
	applyShaderFeatures,
	patchShader,
	type ShaderInsert,
	type ShaderUniforms,
} from './render/shader.js';

export { Audio, type LoopSrc } from './audio/Audio.js';
export { AudioSource } from './audio/AudioSource.js';
export { Speaker } from './audio/Speaker.js';
export { overdrive, reverb } from './audio/filters.js';
export { scoreProblems } from './audio/midi.js';
export { midiHz } from './audio/synth.js';
export { registerInstrument, type InstrumentEnvelope, type InstrumentPlay } from './audio/instruments.js';
export { speech, voiceFor, type SpeechVoice } from './audio/speech.js';
export type {
	ListenerPose,
	Note,
	Score,
	SfxHandle,
	SfxKind,
	Vowel,
	SfxLayer,
	SfxOpts,
	SfxPatch,
	SoundFilter,
	OverdriveFilter,
	ReverbFilter,
	Voice,
} from './audio/types.js';

export {
	register,
	create,
	meshReady,
	proceduralBox,
	proceduralPlane,
	type MeshFactory,
} from './assets/meshes.js';
export { registerGltf } from './assets/gltf.js';
export {
	registerToonModel,
	registerToonClips,
	toonClip,
	toonModelData,
	humanBone,
	restTurn,
	setExpression,
	type ToonModelData,
	type ToonExpressionTarget,
	type ToonModelOptions,
} from './assets/toonModel.js';
export { holdInHand, lookAt, reach, placeFoot, orientHand, aimHeld, closeHand, crouch, drawBow, palmOf, restFoot, type Hand, type Grip, type Bend } from './assets/toonPose.js';
export { Animator } from './render/Animator.js';
export { ease, move, type MovePhase, type MoveSample, type MoveTiming } from './assets/move.js';
