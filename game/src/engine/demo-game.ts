import { ChunkStreamer, Game, register, resetAllocID, resetTime, type ShadowMode, GameObject } from '@arc-director/kindling';
import { ArcDirector, gpuMemory } from 'arc-director';
import { DemoWorld } from './demo-world';
import { Wallet, Named } from './components';
import { GameHost } from '../director/adapter';
import { loadNature } from '../render/nature';
import { loadSpritesheet } from '../render/spritesheet';
import type { HudModel } from '../ui/hud-model';
import { prefs, type ShadowTier } from '../prefs';
import { decodeGlyphChunk } from '../world/decode-glyph-chunk';
import { getDef } from '../items/defs';
import { equipItem } from '../items/equip';
import { instantiateDef } from '../items/instance';
import { spawnCamera, spawnRaven, spawnNPC, spawnPlayer, spawnRoom } from '../world/spawn';
import { THINGS } from '../kit/thing-registry';
import { DEFAULT_SCENE_ID, sceneByID } from '../scenes/scene-registry';
import { bodyOf, type PlayerDef, type Scene } from '../scenes/scene';
import { loadCharacterModels } from '../render/character-models';
import { DirectorPulse, GroundPick, Hud, MapPan, WorldView } from './systems';
import { Session } from './Session';
import { PlayerPose } from './PlayerPose';
import { SaveSlot } from './SaveSlot';
import { readURLCamera, readURLMinFps } from './url-view';
import { CameraFocus } from './CameraFocus';
import { syncWaterAudio } from '../audio/water';
import { autoShadowTier } from './auto-shadows';

/** Seconds per step a scrub runs the game to its moment in. */
const SCRUB_STEP = 1 / 60;
/** Keys the game uses, so the browser does not also scroll, move focus or open Quick Find. */
const GAME_KEYS = new Set([
	'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyE', 'KeyF', 'KeyG', 'KeyX',
	'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
	'Space', 'Tab', 'Backquote', 'Enter', 'NumpadEnter', 'Escape',
]);

/** What each shadow tier asks of the renderer.
 * Each tier's shadows (map sides in texels):
 * `point` lights, the `sun`'s still map, and the `mover` map moving things cast into round the player (`dynamic` only).
 **/
export const SHADOWS:Record<ShadowTier, { mode:ShadowMode; point:number; sun:number; mover:number }> = {
	off: { mode: 'off', point: 256, sun: 2048, mover: 1024 },
	simple: { mode: 'static', point: 256, sun: 2048, mover: 1024 },
	low: { mode: 'dynamic', point: 256, sun: 2048, mover: 1024 },
	high: { mode: 'dynamic', point: 512, sun: 4096, mover: 2048 },
};

/** The scene's purse, gear and name for the player. */
function dressPlayer(world:DemoWorld, def:PlayerDef | undefined):void {
	const player = world.findByID('Player');
	if (!player || !def) {
		return;
	}
	const purse = player.getComponent(Wallet);
	if (purse && def.wallet !== undefined) {
		purse.coins = def.wallet;
	}
	for (const defID of def.equip ?? []) {
		equipItem(player, instantiateDef(getDef(defID)), world);
	}
	const named = player.getComponent(Named);
	if (named && def.name) {
		named.aliases = [...(named.aliases ?? []), def.name];
	}
}

/**
 * The scene on a fresh clock: its chunks, player, cast, rooms, ravens and camera into `world`, its things' meshes ready to draw, lit
 * by its look. Returns its `Systems` object (not yet in the world, the land's view on it) and the chunk streamer.
 */
export function spawnScene(world:DemoWorld, scene:Scene):{ systems:GameObject; stream:ChunkStreamer } {
	resetTime();
	resetAllocID();
	for (const thing of THINGS) {
		Object.entries(thing.meshes ?? {}).forEach(([id, make]) => register(id, make));
	}
	world.daylight = scene.look.sun !== undefined;
	world.lightLevel = scene.lightLevel ?? 1;
	const decoded = scene.chunks.map(decodeGlyphChunk);
	decoded.forEach((d) => world.terrain.register(d.chunk));
	const startDecoded = decoded.find((d) => d.playerStart) ?? decoded[0];
	if (!startDecoded) {
		throw new Error(`scene ${scene.id} has no chunks`);
	}
	spawnPlayer(world, startDecoded.playerStart, startDecoded.chunk);
	dressPlayer(world, scene.player);
	scene.cast.forEach((member) => spawnNPC(world, bodyOf(member)));
	scene.rooms?.forEach((room) => spawnRoom(world, room));
	scene.ravens?.forEach((r, i) => spawnRaven(world, `Raven${i + 1}`, r.x, r.z, r.yaw));
	spawnCamera(world, scene.camera);
	world.renderer?.applyLook(scene.look);
	const systems = new GameObject('Systems', 'Systems');
	systems.addComponent(WorldView, { ground: scene.ground, outskirts: scene.outskirts });
	return { systems, stream: systems.addComponent(ChunkStreamer) };
}

/** Models and art a scene draws with; cached, so a second scene loads at once. */
export async function loadSceneArt(scene:Scene):Promise<void> {
	const jobs:Promise<unknown>[] = [
		loadSpritesheet(),
		loadCharacterModels(),
	];
	// Sunlit scenes have trees.
	if (scene.look.sun) {
		jobs.push(loadNature());
	}
	try {
		await Promise.all(jobs);
	}
	catch (err) {
		console.error(err);
	}
}

export class DemoGame extends Game<DemoWorld> {
	public readonly session:Session;
	private readonly _hud:HudModel;
	private readonly _scene:Scene;
	/** What `auto` shadows run as on this GPU. */
	private readonly _autoShadows = autoShadowTier(gpuMemory());

	constructor(hud:HudModel, sceneID = DEFAULT_SCENE_ID) {
		super(new DemoWorld());
		const canvas = this.canvas;
		if (!canvas) {
			throw new Error('Kindling Game needs a document to create a canvas');
		}
		const minFps = readURLMinFps();
		if (minFps !== undefined) {
			this.unfocusedHz = minFps;
		}
		this._hud = hud;
		this._scene = sceneByID(sceneID);
		this.syncDisplay();
		this.world.input.captures = (code) => GAME_KEYS.has(code) || code.startsWith('Digit');
		const { systems } = spawnScene(this.world, this._scene);
		const host = new GameHost(this.world, hud.chat, hud.aiLog, this._scene);
		host.bind(this._scene.direct(host, host.configure(new ArcDirector())));
		systems.addComponent(GroundPick);
		systems.addComponent(MapPan);
		systems.addComponent(Hud, {
			model: hud,
			director: host,
			overheads: { healthBars: this._scene.healthBars ?? false, carried: this._scene.carried, inspect: this._scene.inspect },
		});
		systems.addComponent(DirectorPulse, { director: host });
		systems.addComponent(CameraFocus, { director: host, expr: readURLCamera().focus });
		const pose = systems.addComponent(PlayerPose, { sceneID: this._scene.id });
		const slot = systems.addComponent(SaveSlot, { hud, director: host, sceneID: this._scene.id, pose });
		this.session = systems.addComponent(Session, { hud, director: host, scene: this._scene, pose, slot });
		this.world.add(systems);
		this.session.boot();
	}

	protected override onStart():void {
		this.session.director.connect();
		if (this.canvas) {
			this.world.audio.connectUnlock(this.canvas);
		}
		this.syncAudio();
		void this.world.audio.playMusic(this._scene.music);
		void this.world.audio.resume();
		void loadSceneArt(this._scene);
	}

	public override dispose():void {
		this.session.pose.persist();
		super.dispose();
	}

	public override tick(dt:number):void {
		this.session.poll();
		this.syncDisplay();
		this.paused = this._hud.menuOpen;
		const perf = this.world.perf;
		const start = performance.now();
		const director = perf.totalMS.director;
		// A scrub runs to its moment in small steps, then holds it: each frame poses again at dt 0, nothing moving on.
		for (let left = this.session.scrub ?? 0; left > 1e-6; left -= SCRUB_STEP) {
			super.tick(Math.min(SCRUB_STEP, left));
		}
		if (this.session.scrub !== null) {
			this.session.scrub = 0;
			dt = 0;
		}
		super.tick(dt);
		perf.add('simulate', performance.now() - start - (perf.totalMS.director - director));
		this.syncAudio();
	}

	protected override draw(now:number):void {
		const start = performance.now();
		super.draw(now);
		this.world.perf.add('render', performance.now() - start);
		this.world.perf.frame(now);
	}

	/** Menu display settings onto the renderer. */
	private syncDisplay():void {
		if (!this.renderer) {
			return;
		}
		const display = prefs();
		const shadows = SHADOWS[display.shadows === 'auto' ? this._autoShadows : display.shadows];
		this.renderer.detailMaps = display.detailMaps;
		this.renderer.shadows = shadows.mode;
		this.renderer.pointShadowMapSize = shadows.point;
		this.renderer.directionalShadowMapSize = shadows.sun;
		this.renderer.sunMoverSize = shadows.mover;
	}

	private syncAudio():void {
		this.world.audio.duck = this._hud.menuOpen ? 0.2 : 1;
		const sound = prefs();
		this.world.audio.musicVolume = sound.musicMuted ? 0 : sound.music;
		this.world.audio.sfxVolume = sound.sfx;
		this.world.audio.muted = sound.muted;
		const player = this.world.findByID('Player');
		if (!player) {
			return;
		}
		// Sounds come from where the camera looks; they fade with distance from the player.
		const p = player.transform.position;
		const ears = { x: p.x, y: p.y + 1.35, z: p.z };
		const cam = this.world.findByID('MainCamera');
		const eye = cam?.transform.position ?? ears;
		this.world.audio.setListener(eye.x, eye.y, eye.z, cam?.transform.yaw ?? player.transform.yaw, ears);
		syncWaterAudio(this.world, p.x, p.z);
	}
}
