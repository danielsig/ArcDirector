import { Game as KindlingGame, captureWorld, resetAllocID, resetTime, Time } from '@arc-director/kindling';
import { resetHudPatch } from './patchHud';
import { World } from './World';
import { GameObject } from './GameObject';
import { Wallet, Camera } from './components';
import { GameHost } from '../director/adapter';
import { rendererLook } from '../render/look';
import { loadNPCAnims } from '../render/humanAnims';
import { loadNature } from '../render/nature';
import { loadSpritesheet } from '../render/spritesheet';
import { loadSwordAnims } from '../render/swordAnims';
import type { HudModel } from '../ui/hudModel';
import { flagsFromURL, prefs, setPrefs } from '../prefs';
import { decodeGlyphChunk } from '../world/decodeGlyphChunk';
import { getDef } from '../items/defs';
import { equipItem } from '../items/equip';
import { instantiateDef } from '../items/instance';
import { spawnCamera, spawnNPC, spawnPlayer } from '../world/spawn';
import { DEFAULT_SCENE_ID, sceneByID, type SceneDef } from '../data/scenes';
import { packedKinds } from '../render/artCache';
import { DirectorPulse, GroundPick, Hud, WorldStream, WorldView } from './systems';
import { Session } from './Session';
import { readSave } from './save';
import { loadViewPose } from './viewPersist';
import { readURLFlags } from './urlView';
import { startSceneMusic } from '../audio/songs';
import { syncWaterAudio } from '../audio/water';

export class Game extends KindlingGame<World> {
	public readonly session:Session;
	private readonly _hud:HudModel;
	private readonly _scene:SceneDef;

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
		if (this.renderer) {
			this.renderer.detailMaps = this._hud.detailMaps;
			this.renderer.shadows = this._hud.shadows;
		}
		this.renderer?.applyLook(rendererLook(this._scene.look));
		this.world.input.attach(canvas);
		const decoded = this._scene.chunks.map(decodeGlyphChunk);
		const startDecoded = decoded.find((d) => d.playerStart) ?? decoded[0];
		if (!startDecoded) {
			throw new Error(`scene ${this._scene.id} has no chunks`);
		}
		spawnPlayer(this.world, startDecoded.playerStart, startDecoded.chunk);
		const player = this.world.findByID('Player');
		const purse = player?.getComponent(Wallet);
		if (purse && this._scene.playerWallet !== undefined) {
			purse.coins = this._scene.playerWallet;
		}
		if (player && this._scene.id === 'ruins') {
			equipItem(player, instantiateDef(getDef('iron_sword')), this.world);
		}
		const decodedByID = new Map(decoded.map((d) => [d.chunk.id, d]));
		for (const npc of this._scene.npcs) {
			const home = decodedByID.get(npc.chunkID) ?? startDecoded;
			spawnNPC(this.world, home.chunk, {
				id: npc.id,
				meshID: npc.meshID,
				localX: npc.localX,
				localZ: npc.localZ,
				yaw: npc.yaw,
				pack: npc.pack,
				packLoot: npc.packLoot,
				wallet: npc.wallet,
				hp: npc.hp,
				merchant: npc.merchant,
				marketNPC: npc.marketNPC,
				companion: npc.companion,
				hearOnly: npc.hearOnly,
			});
		}
		spawnCamera(this.world);
		const host = new GameHost(this.world, hud.chat, hud.aiLog, {
			ambient: this._scene.ambient,
			scene: this._scene.id,
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
		this.session.applyShotFromURL();
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
		void this.loadArt();
	}

	private async loadArt():Promise<void> {
		const jobs:Promise<unknown>[] = [
			loadSpritesheet(),
			loadNPCAnims(packedKinds()),
			loadSwordAnims(),
		];
		if (this._scene.look === 'glen' || this._scene.look === 'market') {
			jobs.push(loadNature());
		}
		try {
			await Promise.all(jobs);
		}
		catch (err) {
			console.error(err);
		}
	}

	public override dispose():void {
		this.session.persistView();
		this.world.input.detach();
		this.session.view.present.dispose();
		resetHudPatch();
		this.session.onDestroy();
		super.dispose();
	}

	public override tick(dt:number):void {
		this.session.poll();
		if (this.renderer) {
			this.renderer.detailMaps = this._hud.detailMaps;
			this.renderer.shadows = this._hud.shadows;
		}
		if (!this._hud.menuOpen) {
			this.world.time += dt;
			Time.deltaTime = dt;
			Time.time = this.world.time;
			this.simulate(dt);
		}
		else {
			this.session.pausePresent();
		}
		this.syncAudio();
		this.world.input.endFrame();
	}

	private syncAudio():void {
		this.world.audio.duck = this._hud.menuOpen ? 0.2 : 1;
		this.world.audio.musicVolume = this._hud.musicVolume;
		this.world.audio.sfxVolume = this._hud.sfxVolume;
		this.world.audio.muted = this._hud.audioMuted;
		const player = this.world.findByID('Player');
		if (!player) {
			return;
		}
		const p = player.transform.position;
		const cam = this.world.findByID('MainCamera')?.getComponent(Camera);
		this.world.audio.setListener(p.x, p.y + 1.35, p.z, cam?.yaw ?? player.transform.yaw);
		syncWaterAudio(this.world, p.x, p.z);
	}
}
