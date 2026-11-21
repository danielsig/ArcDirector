import type { Component, ComponentState } from './Component.js';
import { ChunkBound } from './ChunkStreamer.js';
import { allocSerial, resetAllocID, type GameObject } from './GameObject.js';
import type { World } from './World.js';

/** A GameObject's component states by key, and its `recipe` when it has one. */
export type ObjectState = { recipe?:unknown; components:Record<string, ComponentState> };

/** Every object's state, by id. */
export type WorldState = Record<string, ObjectState>;

/** What differs from fresh among some objects: changed fields by id (whole state, with its `recipe`, for an object fresh lacked) and ids that are gone. */
export type ChunkSave = { changed:WorldState; removed:string[] };

/**
 * What differs from a fresh world: the scene's own objects (no `ChunkBound`) against its boot state, each chunk that
 * has loaded against its own fresh state or the restored slice still waiting for it (a chunk with nothing changed is
 * left out), and the `allocID` serial.
 */
export type WorldSave = ChunkSave & { chunks:Record<string, ChunkSave>; serial:number };

/** `Container`, then `Container#1` for a second one on the same object. */
function keyed(go:GameObject):[string, Component][] {
	const seen = new Map<string, number>();
	return go.components().map((c) => {
		const name = c.constructor.name;
		const n = seen.get(name) ?? 0;
		seen.set(name, n + 1);
		return [n === 0 ? name : `${name}#${n}`, c];
	});
}

/** Saved state of `objects`. */
export function captureObjects(objects:Iterable<GameObject>):WorldState {
	const out:WorldState = {};
	for (const go of objects) {
		const components:Record<string, ComponentState> = {};
		for (const [key, c] of keyed(go)) {
			const state = c.saveState();
			if (Object.keys(state).length > 0) {
				components[key] = state;
			}
		}
		out[go.id] = go.recipe === undefined ? { components } : { recipe: structuredClone(go.recipe), components };
	}
	return out;
}

/** The world's own objects: those bound to no chunk (the player, the cast, the systems). */
function sceneObjects(world:World):GameObject[] {
	return world.objects.filter((go) => !go.getComponent(ChunkBound));
}

/** Saved state of the world's own objects, the boot baseline `saveWorld` diffs against (chunks take their own). */
export function captureWorld(world:World):WorldState {
	return captureObjects(sceneObjects(world));
}

/** What `now` changed against `fresh`. */
export function diffState(fresh:WorldState, now:WorldState):ChunkSave {
	const changed:WorldState = {};
	for (const [id, state] of Object.entries(now)) {
		const was = fresh[id];
		if (!was) {
			changed[id] = state;
			continue;
		}
		const components:Record<string, ComponentState> = {};
		for (const [key, fields] of Object.entries(state.components)) {
			const diff:ComponentState = {};
			for (const [field, value] of Object.entries(fields)) {
				if (JSON.stringify(value) !== JSON.stringify(was.components[key]?.[field])) {
					diff[field] = value;
				}
			}
			if (Object.keys(diff).length > 0) {
				components[key] = diff;
			}
		}
		if (Object.keys(components).length > 0) {
			changed[id] = { components };
		}
	}
	return { changed, removed: Object.keys(fresh).filter((id) => !now[id]) };
}

/** The world against `fresh` (its `captureWorld` at boot), and its chunks (`Terrain.save`). */
export function saveWorld(world:World, fresh:WorldState):WorldSave {
	return { ...diffState(fresh, captureWorld(world)), chunks: world.terrain.save(), serial: allocSerial() };
}

/** Apply `save` to a freshly built world; its chunks' slices apply as each loads. `spawn` rebuilds (and adds) an object from its `recipe`. */
export function restoreWorld(world:World, save:WorldSave, spawn:(recipe:unknown)=>GameObject | undefined):void {
	applyState(world, sceneObjects(world), save, spawn);
	world.terrain.restore(save.chunks, spawn);
	world.flushDestroy();
	resetAllocID(save.serial);
}

/** Apply `save` to `objects`: destroy the removed, load the changed, and rebuild with `spawn` what `objects` lacks. */
export function applyState(world:World, objects:readonly GameObject[], save:ChunkSave, spawn:(recipe:unknown)=>GameObject | undefined):void {
	const byID = new Map(objects.map((go) => [go.id, go]));
	for (const id of save.removed) {
		const go = byID.get(id);
		if (go) {
			world.destroy(go);
		}
	}
	for (const [id, state] of Object.entries(save.changed)) {
		const go = byID.get(id) ?? (state.recipe === undefined ? undefined : spawn(state.recipe));
		if (!go) {
			continue;
		}
		const components = new Map(keyed(go));
		for (const [key, fields] of Object.entries(state.components)) {
			components.get(key)?.loadState(fields);
		}
	}
}
