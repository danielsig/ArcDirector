export { Component, type ComponentState } from './core/Component.js';
export { GameObject, allocID, allocSerial, resetAllocID } from './core/GameObject.js';
export { captureObjects, captureWorld, diffState, restoreWorld, saveWorld, type ChunkSave, type ObjectState, type WorldSave, type WorldState } from './core/save.js';
export { Transform, type Vec3 } from './core/Transform.js';
export { World } from './core/World.js';
export { Terrain, chunkBounds, gridKey, type Climb, type Cover, type Flight, type TerrainSample, type TileSpec } from './core/Terrain.js';
export { boundsOf, inBounds, type Bounds } from './core/bounds.js';
export { distanceXZ, type XZ } from './core/xz.js';
export type { ChunkCoord, LocalCoord, TileCoord } from './core/tile-coord.js';
export { NEIGHBORS4, SIDES, SIDE_OFFSETS, opposite, type Side } from './core/side.js';
export { Chunk } from './core/Chunk.js';
export { ChunkBound, ChunkStreamer, StreamingAnchor } from './core/ChunkStreamer.js';
export { Game } from './core/Game.js';
export { Time, resetTime, MAX_DT } from './core/time.js';
export { Input, MOUSE_LEFT, TOUCH_TAP } from './core/Input.js';
export { Rigidbody } from './core/Rigidbody.js';
export { BoxCollider } from './core/BoxCollider.js';
export { linecast, tilesAlong, type LineHit, type LinecastOpts } from './core/linecast.js';
export { SHOVE_YIELD, stepPhysics, resolveBody, canOccupy, type BlockerOpts } from './core/physics.js';
export { clamp, hash, lerpAngle, yawToForward, yawToward } from './core/math.js';
export type { Constructor, ComponentClass, ComponentInit, KindlingTypes } from './core/core-types.js';

export { Camera, type ImpactFrame } from './render/Camera.js';
export { Light, polygonCookie, spotThrough, type LightKind } from './render/Light.js';
export { MeshRenderer } from './render/MeshRenderer.js';
export { Renderer, type RendererLook, type RenderStats } from './render/Renderer.js';
export { ShadowCache, type ShadowMode, type ShadowSettings } from './render/ShadowCache.js';
export { OutlinePass, overInk, underInk } from './render/OutlinePass.js';
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
export { bevelBox, blob, instanced, lathe, mergeParts, ribbon, solidMesh, tube, type PathPoint, type PosedPart, type ProfilePoint } from './render/mesh-kit.js';
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
	Track,
	OverdriveFilter,
	ReverbFilter,
	Voice,
} from './audio/audio-types.js';

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
} from './assets/toon-model.js';
export { holdInHand, lookAt, reach, placeFoot, orientHand, aimHeld, closeHand, crouch, drawBow, otherHand, palmOf, restFoot, type Hand, type Grip, type Bend } from './assets/toon-pose.js';
export { Animator } from './render/Animator.js';
export { ease, move, type MovePhase, type MoveSample, type MoveTiming } from './assets/move.js';
