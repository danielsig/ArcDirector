import { Game as KindlingGame, captureWorld, resetAllocID, resetTime, type ShadowMode, GameObject } from '@arc-director/kindling';
import { resetHudPatch } from './patchHud';
import { World } from './World';
import { Wallet, Named } from './components';
import { GameHost } from '../director/adapter';
import { rendererLook } from '../render/look';
import { loadNature } from '../render/nature';
import { loadSpritesheet } from '../render/spritesheet';
import type { HudModel } from '../ui/hudModel';
import { flagsFromURL, prefs, setPrefs, type ShadowTier } from '../prefs';
import { decodeGlyphChunk } from '../world/decodeGlyphChunk';
import { getDef } from '../items/defs';
import { equipItem } from '../items/equip';
import { instantiateDef } from '../items/instance';
import { spawnCamera, spawnRaven, spawnNPC, spawnPlayer } from '../world/spawn';
import { DEFAULT_SCENE_ID, sceneByID, type PlayerDef, type SceneDef } from '../data/scenes';
import { loadCharacterModels } from '../render/characterModels';
import { DirectorPulse, GroundPick, Hud, WorldStream, WorldView } from './systems';
import { Session } from './Session';
import { readSave } from './save';
import { loadViewPose } from './viewPersist';
import { readURLCamera, readURLFlags, readURLView } from './urlView';
import { CameraFocus } from './CameraFocus';
import { startSceneMusic } from '../audio/songs';
import { syncWaterAudio } from '../audio/water';
import { AutoShadows } from './autoShadows';

/** Keys the game uses, so the browser does not also scroll, move focus or open Quick Find. */
const GAME_KEYS = new Set([
	'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyE', 'KeyF', 'KeyG', 'KeyX',
	'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
	'Space', 'Tab', 'Backquote', 'Enter', 'NumpadEnter', 'Escape',
]);

/** What each shadow tier asks of the renderer. */
export const SHADOWS:Record<ShadowTier, { mode:ShadowMode; point:number; sun:number }> = {
	off: { mode: 'off', point: 256, sun: 2048 },
	simple: { mode: 'static', point: 256, sun: 2048 },
	low: { mode: 'dynamic', point: 256, sun: 2048 },
	high: { mode: 'dynamic', point: 512, sun: 4096 },
};

/** The scene's purse, gear and name for the player. */
function dressPlayer(world:World, def:PlayerDef | undefined):void {
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

/** The scene's chunks, player, cast, ravens and camera into `world`; returns its decoded chunks. */
export function spawnScene(world:World, scene:SceneDef):ReturnType<typeof decodeGlyphChunk>[] {
	const decoded = scene.chunks.map(decodeGlyphChunk);
	const startDecoded = decoded.find((d) => d.playerStart) ?? decoded[0];
	if (!startDecoded) {
		throw new Error(`scene ${scene.id} has no chunks`);
	}
	spawnPlayer(world, startDecoded.playerStart, startDecoded.chunk);
	dressPlayer(world, scene.player);
	const decodedByID = new Map(decoded.map((d) => [d.chunk.id, d]));
	for (const npc of scene.npcs) {
		spawnNPC(world, (decodedByID.get(npc.chunkID) ?? startDecoded).chunk, npc);
	}
	scene.ravens?.forEach((r, i) => spawnRaven(world, `Raven${i + 1}`, r.x, r.z, r.yaw));
	spawnCamera(world);
	return decoded;
}

/** Models and art a scene draws with; cached, so a second scene loads at once. */
export async function loadSceneArt(scene:SceneDef):Promise<void> {
	const jobs:Promise<unknown>[] = [
		loadSpritesheet(),
		loadCharacterModels(),
	];
	if (scene.look === 'glen' || scene.look === 'market') {
		jobs.push(loadNature());
	}
	try {
		await Promise.all(jobs);
	}
	catch (err) {
		console.error(err);
	}
}

export class Game extends KindlingGame<World> {
	public readonly session:Session;
	private readonly _hud:HudModel;
	private readonly _scene:SceneDef;
	private readonly _autoShadows = new AutoShadows();

	constructor(hud:HudModel, sceneID = DEFAULT_SCENE_ID) {
		super(new World());
		const canvas = this.canvas;
		if (!canvas) {
			throw new Error('Kindling Game needs a document to create a canvas');
		}
		this._hud = hud;
		this._scene = sceneByID(sceneID);
		resetTime();
		resetAllocID();
		this.syncDisplay();
		this.renderer?.applyLook(rendererLook(this._scene.look));
		this.world.input.captures = (code) => GAME_KEYS.has(code) || code.startsWith('Digit');
		const decoded = spawnScene(this.world, this._scene);
		const host = new GameHost(this.world, hud.chat, hud.aiLog, {
			ambient: this._scene.ambient,
			scene: this._scene.id,
			playerTags: this._scene.player?.tags,
		});
		const director = this._scene.createDirector(host);
		host.bind(director);
		this.world.pickedUp = (character, name) => {
			host.hooks.afterPickUp?.(host, character, name);
		};
		const systems = new GameObject('Systems', 'Systems');
		const getRenderer = () => this.renderer;
		const view = systems.addComponent(WorldView, { getRenderer });
		systems.addComponent(GroundPick, { getRenderer });
		const hudView = systems.addComponent(Hud, { model: this._hud, director: host, getRenderer });
		const stream = systems.addComponent(WorldStream, { chunks: decoded.map((d) => d.chunk) });
		systems.addComponent(DirectorPulse, { director: host });
		const camera = readURLCamera();
		const focus = systems.addComponent(CameraFocus, { director: host, expr: camera.focus });
		this.session = systems.addComponent(Session, {
			hud: this._hud,
			director: host,
			scene: this._scene,
			stream,
			view,
			hudView,
			getCanvas: () => this.canvas,
			getRunning: () => this.running,
		});
		this.world.add(systems);
		stream.loadAll();
		this.session.fresh = captureWorld(this.world);
		// Read the shot before any pref change rewrites the URL with the spawn pose.
		const shot = readURLView();
		setPrefs(flagsFromURL(readURLFlags()));
		this.session.syncPrefs();
		this.session.homePose = this.session.readPose() ?? this.session.homePose;
		const save = readSave(this._scene.id);
		this._hud.savedUTC = save?.savedUTC ?? '';
		if (save && this._hud.loading) {
			this.session.restore(save);
		}
		else {
			const pose = loadViewPose(this._scene.id);
			if (pose) {
				this.session.applyPose(pose);
			}
		}
		this._hud.loading = false;
		this.session.applyShot(shot);
		if (camera.zoom !== undefined) {
			focus.zoom = camera.zoom;
		}
		stream.stream();
		this._hud.menuOpen = false;
		this._hud.keysOpen = false;
		this._hud.minimap.follow = this._scene.minimapFollow !== false;
		this._hud.model = host.arc?.modelID() || prefs().model;
		this.session.persistView();
		this.session.syncURLView();
	}

	protected override onStart():void {
		this.session.beginPlay();
		if (this.canvas) {
			this.world.audio.connectUnlock(this.canvas);
		}
		this.syncAudio();
		startSceneMusic(this.world.audio, this._scene.id);
		void this.world.audio.resume();
		void loadSceneArt(this._scene);
	}

	public override dispose():void {
		this.session.persistView();
		this.session.view.present.dispose();
		resetHudPatch();
		this.session.onDestroy();
		super.dispose();
	}

	public override tick(dt:number):void {
		this.session.poll();
		if (this._hud.shadows === 'auto' && this.renderer) {
			this._autoShadows.tick(dt, this.renderer.frameMS(1000));
		}
		this.syncDisplay();
		this.paused = this._hud.menuOpen;
		super.tick(dt);
		if (this.paused) {
			this.session.pausePresent();
		}
		this.syncAudio();
	}

	/** Menu display settings onto the renderer. */
	private syncDisplay():void {
		if (!this.renderer) {
			return;
		}
		const shadows = SHADOWS[this._hud.shadows === 'auto' ? this._autoShadows.tier : this._hud.shadows];
		this.renderer.detailMaps = this._hud.detailMaps;
		this.renderer.shadows = shadows.mode;
		this.renderer.pointShadowMapSize = shadows.point;
		this.renderer.directionalShadowMapSize = shadows.sun;
	}

	private syncAudio():void {
		this.world.audio.duck = this._hud.menuOpen ? 0.2 : 1;
		this.world.audio.musicVolume = this._hud.musicMuted ? 0 : this._hud.musicVolume;
		this.world.audio.sfxVolume = this._hud.sfxVolume;
		this.world.audio.muted = this._hud.audioMuted;
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
