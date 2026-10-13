export { Component, type ComponentState } from './core/Component.js';
export { GameObject, allocID, allocSerial, resetAllocID } from './core/GameObject.js';
export { captureWorld, diffWorld, restoreWorld, type ObjectState, type WorldSave, type WorldState } from './core/save.js';
export { Transform, type Vec3 } from './core/Transform.js';
export { World } from './core/World.js';
export { Chunk } from './core/Chunk.js';
export { ChunkBound, ChunkStreamer, StreamingAnchor } from './core/ChunkStreamer.js';
export { Game } from './core/Game.js';
export { Time, resetTime, MAX_DT } from './core/Time.js';
export { Rigidbody } from './core/Rigidbody.js';
export { BoxCollider } from './core/BoxCollider.js';
export { SHOVE_YIELD, stepPhysics, resolveBody, canOccupy } from './core/physics.js';
export type { TerrainSample } from './core/World.js';
export type { Constructor, ComponentClass, ComponentInit } from './core/types.js';

export { Camera } from './render/Camera.js';
export { Light, type LightKind } from './render/Light.js';
export { MeshRenderer } from './render/MeshRenderer.js';
export { Renderer, type RendererLook, type RenderStats } from './render/Renderer.js';
export { OutlinePass } from './render/OutlinePass.js';
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
export { midiHz, scoreProblems } from './audio/midi.js';
export { registerInstrument, type InstrumentEnvelope, type InstrumentPlay } from './audio/instruments.js';
export { speech, voiceFor, type SpeechVoice } from './audio/speech.js';
export type {
	ListenerPose,
	Note,
	Score,
	SfxKind,
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
export { holdInHand, lookAt, reach, drawBow, type Hand, type Grip } from './assets/toonPose.js';
export { Animator } from './render/Animator.js';
