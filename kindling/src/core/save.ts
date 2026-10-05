import type { Component, ComponentState } from './Component.js';
import { allocSerial, resetAllocID, type GameObject } from './GameObject.js';
import type { World } from './World.js';

/** A GameObject's component states by key, and its `recipe` when it has one. */
export type ObjectState = { recipe?:unknown; components:Record<string, ComponentState> };

/** Every object's state, by id. */
export type WorldState = Record<string, ObjectState>;

/**
 * What differs from a fresh world: changed fields by id (whole state for objects
 * the fresh world does not have), ids that are gone, and the `allocID` serial.
 */
export type WorldSave = { changed:WorldState; removed:string[]; serial:number };

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

/** Saved state of every object in `world`. */
export function captureWorld(world:World):WorldState {
	const out:WorldState = {};
	for (const go of world.objects) {
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

/** What `now` changed against `fresh` (a `captureWorld` of the same scene, just built). */
export function diffWorld(fresh:WorldState, now:WorldState):WorldSave {
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
	return { changed, removed: Object.keys(fresh).filter((id) => !now[id]), serial: allocSerial() };
}

/** Apply `save` to a freshly built world. `spawn` rebuilds (and adds) an object from its `recipe`. */
export function restoreWorld(world:World, save:WorldSave, spawn:(recipe:unknown)=>GameObject | undefined):void {
	const byID = new Map(world.objects.map((go) => [go.id, go]));
	for (const id of save.removed) {
		const go = byID.get(id);
		if (go) {
			world.destroy(go);
		}
	}
	world.flushDestroy();
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
	resetAllocID(save.serial);
}
