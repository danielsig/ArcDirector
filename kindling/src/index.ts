export { Component } from './core/Component.js';
export { GameObject, allocID, resetAllocID } from './core/GameObject.js';
export { Transform, type Vec3 } from './core/Transform.js';
export { World } from './core/World.js';
export { Game } from './core/Game.js';
export { Time, resetTime, MAX_DT } from './core/Time.js';
export { Rigidbody } from './core/Rigidbody.js';
export { BoxCollider } from './core/BoxCollider.js';
export { SHOVE_YIELD, stepPhysics } from './core/physics.js';
export type { TerrainSample } from './core/World.js';
export type { Constructor, ComponentClass } from './core/types.js';

export { Camera } from './render/Camera.js';
export { Light, type LightKind } from './render/Light.js';
export { MeshRenderer } from './render/MeshRenderer.js';
export { Renderer, type RendererLook } from './render/Renderer.js';
export {
	insertAfterChunk,
	applyShaderFeatures,
	type ShaderInsert,
	type ShaderUniforms,
} from './render/shader.js';

export { Audio, type LoopSrc } from './audio/Audio.js';
export { AudioSource } from './audio/AudioSource.js';
export { midiHz, scoreProblems } from './audio/midi.js';
export { registerInstrument, type InstrumentEnvelope, type InstrumentPlay } from './audio/instruments.js';
export type {
	ListenerPose,
	Note,
	Score,
	SfxKind,
	SfxLayer,
	SfxOpts,
	SfxPatch,
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
