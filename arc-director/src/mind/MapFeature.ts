import { Feature, type PromptPart } from '../director/Feature.js';
import type { ArcDirector } from '../director/ArcDirector.js';
import type { Mind } from './mind.js';
import type { ToolSpec } from './mind-types.js';
import type { JsonValue } from '../json.js';
import { DEFAULT_YOU_SYMBOL, isMapSnapshot, parseMapZoom, stampMap, type MapPrev, type MapSense } from './map.js';

/**
 * A map of the land a mind looks at as it thinks: the `see_map` tool, for minds whose model sees images. The host draws
 * it (`withMap(sense)`); each mind gets it stamped with its own names, and a look again without a change is only its
 * legend.
 */
export class MapFeature<TCtx = unknown> extends Feature<TCtx> {
	/** Each mind's last look, to tell an unchanged map. */
	private readonly _last = new WeakMap<Mind<TCtx>, MapPrev & { legend:string }>();

	constructor(private _sense:MapSense) {
		super();
	}

	/** Draw the map with `sense` from now on. */
	public configure(sense:MapSense):this {
		this._sense = sense;
		return this;
	}

	public override promptPart():PromptPart {
		return { youSymbol: this._sense.you?.trim() || DEFAULT_YOU_SYMBOL };
	}

	public override install():void {
		this.director.withTools((t) => t.add('see_map', this.tool));
	}

	/** The `see_map` tool, for a mind whose model sees: what `install` registers, and what a solo character is given. */
	public get tool():ToolSpec<TCtx> {
		return {
			description: 'Map of the land: every named person, place, and thing on it, and where. Look here before you ask where something is. Look here before you wander. Never ask where something is until this cannot find it. zoom 1 is close around you, 0 the whole land. A second look soon, without moving, is the same legend and no new picture.',
			parameters: { type: 'object', additionalProperties: false, properties: { zoom: { type: 'number', minimum: 0, maximum: 1 } } },
			offered: (mind) => mind.thinksWith.vision,
			handler: (ctx, args, mind) => this.look(mind, args),
		};
	}

	/** `mind`'s look at the map: its legend, and the picture shown with the answer; the legend alone when it has not changed. */
	private async look(mind:Mind<TCtx>, args:unknown):Promise<JsonValue> {
		const zoom = parseMapZoom(args);
		const prev = this._last.get(mind);
		let snap;
		try {
			snap = await this._sense.snapshot(mind.thinkThread(), zoom, prev);
		}
		catch (err) {
			return { ok: false, zoom, reason: err instanceof Error ? err.message : String(err) };
		}
		if (!snap) {
			return { ok: false, zoom, reason: 'no map' };
		}
		if (prev && snap.image === prev.image) {
			return { ok: true, zoom, legend: prev.legend, unchanged: true, reason: 'map unchanged since last look' };
		}
		if (!isMapSnapshot(snap)) {
			return { ok: false, zoom, reason: 'no map' };
		}
		const stamped = await stampMap(snap, (id) => mind.nameOf(id));
		mind.showNext([
			{ type: 'text', text: 'The map. Legend is in the tool result; names only, no coordinates.' },
			{ type: 'image_url', image_url: { url: stamped.image } },
		]);
		this._last.set(mind, { timestamp: mind.now, zoom, legend: stamped.legend, image: stamped.image, x: snap.x, y: snap.y });
		return { ok: true, zoom, legend: stamped.legend };
	}
}

declare module '../director/ArcDirector.js' {
	interface ArcDirector<TCtx, TEntity> {
		/** {@link MapFeature}. */
		withMap(sense:MapSense):this;
		getMap():MapFeature<TCtx> | undefined;
	}
}
export function withMap<TCtx>(this:ArcDirector<TCtx>, sense:MapSense):ArcDirector<TCtx> {
	return this.configureFeature(MapFeature<TCtx>, () => new MapFeature<TCtx>(sense), (map) => map.configure(sense));
}
