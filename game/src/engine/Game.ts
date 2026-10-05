import { Game as KindlingGame, captureWorld, resetAllocID, resetTime, Time } from '@arc-director/kindling';
import { resetHudPatch } from './patchHud';
import { World } from './World';
import { GameObject } from './GameObject';
import { Wallet, Camera } from './components';
import { GameHost } from '../npc/adapter';
import { rendererLook } from '../render/look';
import { loadNPCAnims } from '../render/humanAnims';
import { loadNature } from '../render/nature';
import { loadSpritesheet } from '../render/spritesheet';
import { loadSwordAnims } from '../render/swordAnims';
import type { HudModel } from '../ui/hudModel';
import { flagsFromURL, prefs } from '../prefs';
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
	readonly session:Session;
	private readonly hud:HudModel;
	private readonly scene:SceneDef;

	constructor(hud:HudModel, sceneID = DEFAULT_SCENE_ID) {
		super(new World());
		const canvas = this.canvas;
		if (!canvas) {
			throw new Error('Kindling Game needs a document to create a canvas');
		}
		this.hud = hud;
		this.scene = sceneByID(sceneID);
		resetTime();
		resetAllocID();
		if (this.renderer) {
			this.renderer.detailMaps = this.hud.detailMaps;
			this.renderer.shadows = this.hud.shadows;
		}
		this.renderer?.applyLook(rendererLook(this.scene.look));
		this.world.input.attach(canvas);
		const decoded = this.scene.chunks.map(decodeGlyphChunk);
		const startDecoded = decoded.find((d) => d.playerStart) ?? decoded[0];
		if (!startDecoded) {
			throw new Error(`scene ${this.scene.id} has no chunks`);
		}
		spawnPlayer(this.world, startDecoded.playerStart, startDecoded.chunk);
		const player = this.world.findByID('Player');
		const purse = player?.getComponent(Wallet);
		if (purse && this.scene.playerWallet !== undefined) {
			purse.coins = this.scene.playerWallet;
		}
		if (player && this.scene.id === 'ruins') {
			equipItem(player, instantiateDef(getDef('iron_sword')), this.world);
		}
		const decodedByID = new Map(decoded.map((d) => [d.chunk.id, d]));
		for (const npc of this.scene.npcs) {
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
			});
		}
		spawnCamera(this.world);
		const host = new GameHost(this.world, hud.chat, hud.aiLog, {
			ambient: this.scene.ambient,
			scene: this.scene.id,
		});
		const director = this.scene.createDirector(host);
		host.bind(director);
		this.world.pickedUp = (actor, name) => {
			host.hooks.afterPickUp?.(host, actor, name);
		};
		const systems = new GameObject('Systems', 'Systems');
		const view = systems.addComponent(new WorldView());
		view.getRenderer = () => this.renderer;
		const pick = systems.addComponent(new GroundPick());
		pick.getRenderer = () => this.renderer;
		const hudView = systems.addComponent(new Hud());
		hudView.model = this.hud;
		hudView.director = host;
		hudView.getRenderer = () => this.renderer;
		const stream = systems.addComponent(new WorldStream());
		stream.chunks = decoded.map((d) => d.chunk);
		const pulse = systems.addComponent(new DirectorPulse());
		pulse.director = host;
		this.session = systems.addComponent(new Session());
		this.session.hud = this.hud;
		this.session.director = host;
		this.session.scene = this.scene;
		this.session.stream = stream;
		this.session.view = view;
		this.session.hudView = hudView;
		this.session.getCanvas = () => this.canvas;
		this.session.getRunning = () => this.running;
		this.world.add(systems);
		stream.loadAll();
		this.session.fresh = captureWorld(this.world);
		this.session.applyDevFlags(flagsFromURL(readURLFlags()));
		this.session.homePose = this.session.readPose() ?? this.session.homePose;
		const save = readSave(this.scene.id);
		this.hud.savedUTC = save?.savedUTC ?? '';
		if (save && this.hud.loading) {
			this.session.restore(save);
		}
		else {
			const pose = loadViewPose(this.scene.id);
			if (pose) {
				this.session.applyPose(pose);
			}
		}
		this.hud.loading = false;
		this.session.applyShotFromURL();
		stream.stream();
		this.world.setMessage(this.scene.message);
		this.hud.menuOpen = false;
		this.hud.minimap.follow = this.scene.minimapFollow !== false;
		const stored = prefs();
		this.hud.model = host.arc?.model || stored.model;
		this.hud.maxParallel = host.arc?.liveMaxParallel() ?? stored.maxParallel;
		this.hud.batchThinks = host.arc?.liveBatchThinks() ?? stored.batchThinks;
		this.hud.thinkingBudget = host.arc ? host.arc.liveThinking() : stored.thinkingBudget;
		this.hud.arcText = host.arc ? host.arc.liveArcText() : stored.arcText;
		this.session.persistView();
		this.session.syncURLView();
		this.applyAudioPref();
	}

	protected override onStart():void {
		this.session.beginPlay();
		if (this.canvas) {
			this.world.audio.connectUnlock(this.canvas);
		}
		startSceneMusic(this.world.audio, this.scene.id);
		void this.world.audio.resume();
		void this.loadArt();
	}

	private async loadArt():Promise<void> {
		const jobs:Promise<unknown>[] = [
			loadSpritesheet(),
			loadNPCAnims(packedKinds()),
			loadSwordAnims(),
		];
		if (this.scene.look === 'glen' || this.scene.look === 'market') {
			jobs.push(loadNature());
		}
		try {
			await Promise.all(jobs);
		}
		catch (err) {
			console.error(err);
		}
	}

	override dispose():void {
		this.session.persistView();
		this.world.input.detach();
		this.session.view.present.dispose();
		resetHudPatch();
		this.session.onDestroy();
		super.dispose();
	}

	override tick(dt:number):void {
		this.session.poll();
		if (this.renderer) {
			this.renderer.detailMaps = this.hud.detailMaps;
			this.renderer.shadows = this.hud.shadows;
		}
		if (!this.hud.menuOpen) {
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

	private applyAudioPref():void {
		const pref = prefs();
		this.hud.musicVolume = pref.music;
		this.hud.sfxVolume = pref.sfx;
		this.hud.audioMuted = pref.muted;
		this.world.audio.musicVolume = pref.music;
		this.world.audio.sfxVolume = pref.sfx;
		this.world.audio.muted = pref.muted;
	}

	private syncAudio():void {
		this.world.audio.duck = this.hud.menuOpen ? 0.2 : 1;
		this.world.audio.musicVolume = this.hud.musicVolume;
		this.world.audio.sfxVolume = this.hud.sfxVolume;
		this.world.audio.muted = this.hud.audioMuted;
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
