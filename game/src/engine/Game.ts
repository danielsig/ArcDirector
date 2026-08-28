import { Game as KindlingGame, resetTime, Time } from '@arc-director/kindling';
import { resetHudPatch } from './patchHud';
import { World } from './World';
import { GameObject } from './GameObject';
import { Wallet } from './components';
import { NpcDirector } from '../npc/adapter';
import { rendererLook } from '../render/look';
import { loadNpcAnims } from '../render/humanAnims';
import { loadNature } from '../render/nature';
import { loadSpritesheet } from '../render/spritesheet';
import { loadSwordAnims } from '../render/swordAnims';
import type { HudModel } from '../ui/hudModel';
import { loadModelPref } from './modelPref';
import { ChunkStreamer } from '../world/ChunkStreamer';
import { decodeGlyphChunk } from '../world/decodeGlyphChunk';
import { spawnCamera, spawnNpc, spawnPlayer } from '../world/spawn';
import { DEFAULT_SCENE_ID, humanKindsForScene, sceneByID, type SceneDef } from '../data/scenes';
import { DirectorPulse, GroundPick, Hud, WorldStream, WorldView } from './systems';
import { Session } from './Session';
import { applyWorld, loadSave } from './gameSave';
import { loadViewPose } from './viewPersist';
import { loadDevFlags, resolveDevFlags } from './devFlags';
import { readUrlFlags } from './urlView';

const AUTOSAVE_ENABLED = false;

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
		this.renderer?.applyLook(rendererLook(this.scene.look));
		this.world.input.attach(canvas);
		const streamer = new ChunkStreamer(this.scene.chunks);
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
		const decodedByID = new Map(decoded.map((d) => [d.chunk.id, d]));
		for (const npc of this.scene.npcs) {
			const home = decodedByID.get(npc.chunkID) ?? startDecoded;
			spawnNpc(this.world, home.chunk, {
				id: npc.id,
				meshID: npc.meshID,
				localX: npc.localX,
				localZ: npc.localZ,
				yaw: npc.yaw,
				pack: npc.pack,
				packLoot: npc.packLoot,
				wallet: npc.wallet,
				merchant: npc.merchant,
				crowd: npc.crowd,
				companion: npc.companion,
			});
		}
		spawnCamera(this.world);
		const auto = AUTOSAVE_ENABLED ? loadSave(this.scene.id, 'auto') : null;
		const director = new NpcDirector(this.world, hud.chat, hud.aiLog, {
			sceneID: this.scene.id,
			ambient: this.scene.ambient,
			agents: auto?.agents,
			bargainDone: auto?.bargainDone,
		});
		this.world.pickedUp = (actor, name) => {
			director.afterPickUp(actor, name);
		};
		const systems = new GameObject('Systems', 'Systems');
		const view = systems.addComponent(new WorldView());
		view.getRenderer = () => this.renderer;
		const pick = systems.addComponent(new GroundPick());
		pick.getRenderer = () => this.renderer;
		const hudView = systems.addComponent(new Hud());
		hudView.model = this.hud;
		hudView.director = director;
		hudView.getRenderer = () => this.renderer;
		const stream = systems.addComponent(new WorldStream());
		stream.streamer = streamer;
		const pulse = systems.addComponent(new DirectorPulse());
		pulse.director = director;
		this.session = systems.addComponent(new Session());
		this.session.hud = this.hud;
		this.session.director = director;
		this.session.scene = this.scene;
		this.session.stream = stream;
		this.session.view = view;
		this.session.hudView = hudView;
		this.session.getCanvas = () => this.canvas;
		this.session.getRunning = () => this.running;
		stream.onGained = (keys) => this.session.overlayLoadedChunks(keys);
		this.world.add(systems);
		this.session.applyDevFlags(resolveDevFlags(readUrlFlags(), loadDevFlags()));
		this.session.homePose = this.session.readPose() ?? this.session.homePose;
		if (auto) {
			applyWorld(this.world, auto.world);
			this.session.applyPose(auto.pose);
			this.world.time = auto.time;
			this.session.live = auto;
		}
		else {
			const saved = loadViewPose(this.scene.id);
			if (saved) {
				this.session.applyPose(saved);
			}
		}
		this.session.applyShotFromUrl();
		stream.streamer.tick(this.world);
		stream.mark(this.world);
		if (this.session.live) {
			this.session.overlayLoadedChunks(new Set(this.world.chunks.keys()));
		}
		this.world.setMessage(this.scene.message);
		this.hud.menuOpen = false;
		this.hud.model = director.liveModel() || loadModelPref();
		this.hud.maxParallel = director.liveMaxParallel();
		this.session.persistAutosave();
		this.session.persistView();
		this.session.syncUrlView();
		this.session.refreshSlots();
	}

	protected override onStart():void {
		this.session.beginPlay();
		void this.loadArt();
	}

	private async loadArt():Promise<void> {
		const jobs:Promise<unknown>[] = [
			loadSpritesheet(),
			loadNpcAnims(humanKindsForScene(this.scene)),
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
		this.session.persistAutosave();
		this.session.persistView();
		this.world.input.detach();
		this.session.view.present.dispose();
		resetHudPatch();
		this.session.onDestroy();
		super.dispose();
	}

	override tick(dt:number):void {
		this.session.poll();
		if (!this.hud.menuOpen) {
			this.world.time += dt;
			Time.deltaTime = dt;
			Time.time = this.world.time;
			this.simulate(dt);
		}
		else {
			this.session.pausePresent();
		}
		this.world.input.endFrame();
	}
}
