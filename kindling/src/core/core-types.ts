import type { Chunk } from './Chunk.js';
import type { Component } from './Component.js';
import type { World } from './World.js';

/**
 * The host's own subclasses, filled in once so Kindling hands them back typed (`go.world`, `world.chunks`,
 * `chunkAtWorld`, `tileAtWorld`). Each key is optional; left out, it stays Kindling's class.
 *
 * ```ts
 * declare module '@arc-director/kindling' {
 * 	interface KindlingTypes {
 * 		world:MyWorld;
 * 		chunk:MyChunk;
 * 	}
 * }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- filled in by the host
export interface KindlingTypes {}

/** The host's `World` subclass, or `World`. */
export type WorldType = KindlingTypes extends { world:infer W } ? W : World;
/** The host's `Chunk` subclass, or `Chunk`. */
export type ChunkType = KindlingTypes extends { chunk:infer C } ? C : Chunk;
/** What the host's chunks hold per tile. */
export type TileType = ChunkType extends Chunk<infer T> ? T : unknown;

/** Any class, abstract ones included (for lookups such as `getComponent`). */
export type Constructor<T> = abstract new (...args:never[])=>T;

/** Fields `addComponent` sets before `awake`. */
export type ComponentInit<T> = Partial<Omit<T, keyof Component>> & { enabled?:boolean };

export type ComponentClass<T> = Constructor<T> & {
	/** Lower runs first within `update` / `fixedUpdate` / `lateUpdate`. */
	order?:number;
	update?(dt:number, list:T[]):void;
	fixedUpdate?(dt:number, list:T[]):void;
	lateUpdate?(dt:number, list:T[]):void;
};
