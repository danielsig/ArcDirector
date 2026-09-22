import { Camera } from '@arc-director/kindling';
import { Camera as FollowCamera, HumanSprite, RigidBody } from './components';
import { Component } from './Component';
import { MeshRenderer } from './MeshRenderer';
import { Order } from './order';
import { PlayerInput } from '../actors/PlayerInput';
import type { SceneDef } from '../data/scenes';
import { GameHost } from '../npc/adapter';
import { playerSay, playerSayCatalog } from '../npc/playerTalk';
import { dumpLookMaps } from '../npc/aiLogSink';
import { patchInfer } from './patchHud';
import { parseSlash } from '../ui/sayCommands';
import type { HudModel, HudModelOption } from '../ui/hudModel';
import {
	clampParallelThinkers,
	prefs,
	setPrefs,
	type Prefs,
} from '../prefs';
import {
	fetchModelCatalog,
	isEmbeddingModel,
	isLoadedModel,
} from 'arc-director';
import {
	applyWorld,
	captureWorld,
	deleteSave,
	listSaves,
	loadSave,
	MAX_USER_SLOTS,
	mergeWorldSave,
	newUserSlotID,
	overlayStreamed,
	userSlotCount,
	writeSave,
	type GameSave,
} from './gameSave';
import {
	packViewPose,
	saveViewPose,
	type ViewPose,
} from './viewPersist';
import {
	applyURLView,
	readURLView,
	writeURLView,
} from './urlView';
import type { Hud, WorldStream, WorldView } from './systems';
import {
	characterHeight,
	characterLabel,
	characterOptions,
	resolvePlayerKind,
} from '../render/artCache';
import { hasHumanAnims, loadNPCAnims } from '../render/humanAnims';

const AUTOSAVE_ENABLED = false;

/** Host session: Vue calls save/load/say; Kindling runs keys, flags, persist. */
export class Session extends Component {
	static override order = Order.persist;
	hud!:HudModel;
	director!:GameHost;
	scene!:SceneDef;
	stream!:WorldStream;
	view!:WorldView;
	hudView!:Hud;
	getCanvas:()=>HTMLCanvasElement | null = () => null;
	getRunning:()=>boolean = () => false;
	homePose:ViewPose = {
		x: 0,
		y: 0,
		z: 0,
		yaw: 0,
		camYaw: 0,
		pitch: 40 * Math.PI / 180,
		distance: Math.hypot(11, 7.4),
	};
	live:GameSave | null = null;
	private persistAcc = 0;
	private lastPacked = '';
	private lastViewPacked = '';
	private lastFlagsPacked = '';
	private lastAudioPacked = '';
	private lastThinkersPacked = '';

	override awake():void {
		this.getCanvas()?.addEventListener('click', this.onClick);
		const lookHost = window as unknown as { __setLook?:(yaw:number, pitch:number)=>void };
		lookHost.__setLook = (yaw:number, pitch:number):void => {
			const world = this.gameObject.world;
			if (!world) {
				return;
			}
			const cam = world.findByID('MainCamera')?.getComponent(FollowCamera);
			const player = world.findByID('Player');
			if (cam) {
				cam.yaw = yaw;
				cam.orbitYaw = yaw;
				cam.pitch = pitch;
				cam.lateUpdate(8);
			}
			if (player) {
				player.transform.yaw = yaw;
			}
			world.forEachComponent(PlayerInput, (c) => {
				c.lookYaw = yaw;
			});
			const stateHost = window as unknown as { __lookState?:{ yaw:number; pitch:number } };
			stateHost.__lookState = { yaw, pitch };
		};
	}

	beginPlay():void {
		if (!this.hud.arcDirectorOn) {
			return;
		}
		void this.director.start().then(() => {
			if (this.getRunning()) {
				this.persistAutosave();
			}
		}).catch((err:unknown) => {
			console.error(err);
		});
	}

	override lateUpdate(dt:number):void {
		this.persistAcc += dt;
		if (this.persistAcc < 0.3) {
			return;
		}
		this.persistAcc = 0;
		this.persistAutosave();
		this.persistView();
		this.syncURLView();
	}

	override onDestroy():void {
		this.getCanvas()?.removeEventListener('click', this.onClick);
		this.director.dispose();
		const lookHost = window as unknown as { __setLook?:(yaw:number, pitch:number)=>void };
		lookHost.__setLook = undefined;
	}

	/** Runs every frame, including while the menu pauses simulation. */
	poll():void {
		this.persistFlags();
		this.persistThinkers();
		this.persistAudio();
		const world = this.gameObject.world;
		if (!world) {
			return;
		}
		world.arcDirectorOn = this.hud.arcDirectorOn;
		world.sayOpen = this.hud.sayOpen;
		if (this.hud.menuOpen && world.input.pointerLocked) {
			this.dropPointerLock();
		}
		if (this.hud.menuOpen) {
			this.hudKeys();
			return;
		}
		if (this.hud.sayOpen) {
			this.patchSayCatalog();
			world.sayOpen = true;
		}
		else if (world.input.pressed('Enter') || world.input.pressed('NumpadEnter')) {
			this.hud.sayOpen = true;
			world.sayOpen = true;
			this.patchSayCatalog();
			world.input.keys.clear();
			this.dropPointerLock();
		}
		else {
			world.sayOpen = false;
		}
		this.hudKeys();
	}

	pausePresent():void {
		const world = this.gameObject.world;
		if (!world) {
			return;
		}
		world.forEachComponent(PlayerInput, (c) => {
			c.moveX = 0;
			c.moveZ = 0;
		});
		world.forEachComponent(MeshRenderer, (c) => c.update(0));
		world.forEachComponent(Camera, (c) => c.update(0));
		this.view.sync();
		this.hudView.sync();
	}

	say(spoken:string):void {
		this.hud.sayOpen = false;
		const slash = parseSlash(spoken.trim());
		const help = !!slash?.ok && slash.verb === 'help';
		if (spoken.trim() && !help) {
			this.hud.observer = false;
			this.persistFlags();
		}
		playerSay(this.director, spoken);
	}

	save():void {
		const selected = this.hud.saveSlots.find((s) => s.id === this.hud.saveSelectedID);
		let id = selected && !selected.auto ? selected.id : '';
		if (!id) {
			if (userSlotCount(this.scene.id) >= MAX_USER_SLOTS) {
				this.hud.menuNotice = 'Eight saves — delete one first';
				return;
			}
			id = newUserSlotID();
		}
		const label = this.hud.saveLabel.trim() || new Date().toLocaleString();
		const save = this.buildSave(id, label);
		if (!save || !writeSave(save)) {
			this.hud.menuNotice = 'Save failed';
			return;
		}
		this.live = save;
		this.hud.saveSelectedID = id;
		this.hud.menuNotice = 'Saved';
		this.refreshSlots();
	}

	load():void {
		const save = loadSave(this.scene.id, this.hud.saveSelectedID);
		if (!save) {
			this.hud.menuNotice = 'Load failed';
			return;
		}
		this.applyGameSave(save);
		this.hud.menuNotice = 'Loaded';
		this.refreshSlots();
	}

	removeSave():void {
		const id = this.hud.saveSelectedID;
		if (!id) {
			this.hud.menuNotice = 'Select a slot';
			return;
		}
		deleteSave(this.scene.id, id);
		if (this.hud.saveSelectedID === id) {
			this.hud.saveSelectedID = '';
		}
		this.hud.menuNotice = 'Deleted';
		this.refreshSlots();
	}

	applyModel():void {
		const name = this.hud.model.trim();
		if (name) {
			setPrefs({ model: name });
			this.director.arc?.setModel(name);
		}
		this.hud.menuNotice = this.hud.model ? this.hud.model : 'No model';
	}

	applyPlayerKind():void {
		const kind = resolvePlayerKind(this.hud.playerKind);
		this.hud.playerKind = kind;
		setPrefs({ playerKind: kind });
		const sprite = this.gameObject.world?.findByID('Player')?.getComponent(HumanSprite);
		if (sprite) {
			sprite.kind = kind;
			sprite.height = characterHeight(kind);
		}
		if (!hasHumanAnims(kind)) {
			void loadNPCAnims([kind]);
		}
		this.hud.menuNotice = characterLabel(kind);
	}

	applyMaxParallel():void {
		const n = clampParallelThinkers(this.hud.maxParallel);
		this.hud.maxParallel = n;
		this.director.arc?.setMaxParallel(n);
		setPrefs({ maxParallel: n });
		this.hud.menuNotice = `${n} thinker${n === 1 ? '' : 's'}`;
	}

	resetInferStats():void {
		this.director.arc?.resetInferStats();
		patchInfer(this.director, this.hud);
	}

	async dumpNPCMaps():Promise<void> {
		const n = await dumpLookMaps(this.director);
		this.hud.menuOpen = false;
		this.hud.aiLogOpen = true;
		this.dropPointerLock();
		this.hud.menuNotice = n > 0 ? `Logged ${n} NPC maps` : 'No NPC maps';
	}

	resetLocation():void {
		const world = this.gameObject.world;
		this.applyPose(this.homePose);
		this.lastViewPacked = '';
		this.persistAcc = 0;
		this.persistView();
		if (world) {
			this.stream.streamer.tick(world);
		}
		this.syncURLView();
		this.hud.menuNotice = 'Location reset';
	}

	async refreshHudModels():Promise<void> {
		if (!this.hud.arcDirectorOn) {
			return;
		}
		const catalog = await fetchModelCatalog('/inference');
		if (this.director.arc) {
			this.director.arc.catalog = catalog;
		}
		const chat = catalog.filter((m) => !isEmbeddingModel(m));
		chat.sort((a, b) => {
			const la = isLoadedModel(a) ? 0 : 1;
			const lb = isLoadedModel(b) ? 0 : 1;
			if (la !== lb) {
				return la - lb;
			}
			return a.id.localeCompare(b.id);
		});
		const models:HudModelOption[] = chat.map((m) => ({
			id: m.id,
			loaded: isLoadedModel(m),
		}));
		const current = this.director.arc?.model || prefs().model;
		if (current && !models.some((m) => m.id === current)) {
			models.unshift({ id: current, loaded: false });
		}
		if (this.hud.model && !models.some((m) => m.id === this.hud.model)) {
			models.unshift({ id: this.hud.model, loaded: false });
		}
		this.hud.models = models;
		if (!this.hud.model) {
			this.hud.model = current || models[0]?.id || '';
		}
	}

	onMenuOpened():void {
		this.hud.menuNotice = '';
		this.persistAutosave();
		this.persistView();
		this.refreshSlots();
		this.dropPointerLock();
		this.hud.model = this.director.arc?.model || prefs().model || this.hud.model;
		this.hud.playerKinds = characterOptions();
		const liveKind = this.gameObject.world?.findByID('Player')?.getComponent(HumanSprite)?.kind;
		this.hud.playerKind = resolvePlayerKind(liveKind || this.hud.playerKind || prefs().playerKind);
		this.hud.maxParallel = this.director.arc?.liveMaxParallel() ?? this.hud.maxParallel;
		this.hud.batchThinks = this.director.arc?.liveBatchThinks() ?? this.hud.batchThinks;
		if (this.director.arc) {
			this.hud.thinkingBudget = this.director.arc.liveThinking();
			this.hud.arcText = this.director.arc.liveArcText();
		}
		void this.refreshHudModels();
	}

	onMenuClosed():void {
		this.getCanvas()?.focus();
		this.gameObject.world?.input.requestLock();
	}

	persistFlags():void {
		const world = this.gameObject.world;
		if (world) {
			world.playerInperceivable = this.hud.observer;
			world.arcDirectorOn = this.hud.arcDirectorOn;
		}
		const flags = this.liveFlags();
		const packed = `${flags.observer ? '1' : '0'}:${flags.ai ? '1' : '0'}`;
		if (packed === this.lastFlagsPacked) {
			return;
		}
		this.lastFlagsPacked = packed;
		setPrefs(flags);
		this.syncURLView();
	}

	applyDevFlags(flags:Pick<Prefs, 'observer' | 'ai'>):void {
		this.hud.observer = flags.observer;
		this.hud.arcDirectorOn = flags.ai;
		const world = this.gameObject.world;
		if (world) {
			world.playerInperceivable = flags.observer;
			world.arcDirectorOn = flags.ai;
		}
		this.lastFlagsPacked = `${flags.observer ? '1' : '0'}:${flags.ai ? '1' : '0'}`;
		setPrefs(flags);
	}

	persistThinkers():void {
		const patch:{
			maxParallel?:number;
			batchThinks:boolean;
			thinkingBudget:boolean;
			arcText:boolean;
		} = {
			batchThinks: this.hud.batchThinks,
			thinkingBudget: this.hud.thinkingBudget,
			arcText: this.hud.arcText,
		};
		if (Number.isFinite(this.hud.maxParallel)) {
			const n = clampParallelThinkers(this.hud.maxParallel);
			this.director.arc?.setMaxParallel(n);
			patch.maxParallel = n;
		}
		this.director.arc?.setBatchThinks(this.hud.batchThinks);
		this.director.arc?.setThinking(this.hud.thinkingBudget);
		this.director.arc?.setArcText(this.hud.arcText);
		const packed = `${patch.maxParallel ?? ''}:${patch.batchThinks ? 1 : 0}:${patch.thinkingBudget ? 1 : 0}:${patch.arcText ? 1 : 0}`;
		if (packed === this.lastThinkersPacked) {
			return;
		}
		this.lastThinkersPacked = packed;
		setPrefs(patch);
	}

	applyShotFromURL():void {
		const shot = readURLView();
		if (!shot) {
			return;
		}
		const pose = this.readPose();
		if (!pose) {
			return;
		}
		this.applyPose(applyURLView(pose, shot));
	}

	readPose():ViewPose | null {
		const world = this.gameObject.world;
		const player = world?.findByID('Player');
		const cam = world?.findByID('MainCamera')?.getComponent(FollowCamera);
		if (!world || !player || !cam) {
			return null;
		}
		const look = player.getComponent(PlayerInput);
		return {
			x: player.transform.position.x,
			y: player.transform.position.y,
			z: player.transform.position.z,
			yaw: look?.lookYaw ?? player.transform.yaw,
			camYaw: cam.yaw,
			pitch: cam.pitch,
			distance: cam.distance,
		};
	}

	applyPose(pose:ViewPose):void {
		const world = this.gameObject.world;
		const player = world?.findByID('Player');
		const cam = world?.findByID('MainCamera')?.getComponent(FollowCamera);
		if (!world || !player || !cam) {
			return;
		}
		player.transform.position.x = pose.x;
		player.transform.position.y = pose.y;
		player.transform.position.z = pose.z;
		player.transform.yaw = pose.yaw;
		const look = player.getComponent(PlayerInput);
		if (look) {
			look.lookYaw = pose.yaw;
			look.moveX = 0;
			look.moveZ = 0;
		}
		const rb = player.getComponent(RigidBody);
		if (rb) {
			rb.velocity.x = 0;
			rb.velocity.z = 0;
			rb.prevX = pose.x;
			rb.prevZ = pose.z;
		}
		cam.yaw = pose.camYaw;
		cam.orbitYaw = pose.yaw;
		cam.pitch = pose.pitch;
		cam.distance = Math.max(cam.minDistance, Math.min(cam.maxDistance, pose.distance));
		cam.lateUpdate(8);
	}

	persistAutosave():void {
		if (!AUTOSAVE_ENABLED) {
			return;
		}
		const save = this.buildSave('auto', 'Autosave');
		if (!save) {
			return;
		}
		const packed = JSON.stringify({ ...save, savedAt: '' });
		if (packed === this.lastPacked) {
			return;
		}
		this.lastPacked = packed;
		this.live = save;
		writeSave(save);
	}

	persistView():void {
		const pose = this.readPose();
		if (!pose) {
			return;
		}
		const packed = packViewPose(pose);
		if (packed === this.lastViewPacked) {
			return;
		}
		this.lastViewPacked = packed;
		saveViewPose(this.scene.id, packed);
	}

	overlayLoadedChunks(ids:Iterable<string>):void {
		const world = this.gameObject.world;
		if (!this.live || !world) {
			return;
		}
		for (const key of ids) {
			const chunk = world.chunks.get(key);
			if (chunk) {
				overlayStreamed(world, this.live.world, chunk.id);
			}
		}
	}

	refreshSlots():void {
		this.hud.saveSlots = listSaves(this.scene.id);
	}

	syncURLView():void {
		const pose = this.readPose();
		if (pose) {
			writeURLView(pose, this.liveFlags());
		}
	}

	private liveFlags():Pick<Prefs, 'observer' | 'ai'> {
		return { observer: this.hud.observer, ai: this.hud.arcDirectorOn };
	}

	private patchSayCatalog():void {
		const world = this.gameObject.world;
		if (!world) {
			return;
		}
		const cat = playerSayCatalog(world);
		this.hud.sayTo = cat.peers.join(', ');
		this.hud.sayPeers = cat.peers;
		this.hud.sayItems = cat.items;
		this.hud.sayGoods = cat.goods;
	}

	private hudKeys():void {
		const world = this.gameObject.world;
		if (!world) {
			return;
		}
		if (!this.hud.sayOpen && world.input.pressed('Tab')) {
			this.hud.chatOpen = !this.hud.chatOpen;
			if (this.hud.chatOpen) {
				this.dropPointerLock();
			}
		}
		if (!this.hud.sayOpen && world.input.pressed('Backquote')) {
			this.hud.aiLogOpen = !this.hud.aiLogOpen;
			if (this.hud.aiLogOpen) {
				this.dropPointerLock();
			}
		}
		if (this.hud.menuOpen && world.input.pressed('Escape')) {
			this.hud.menuOpen = false;
			return;
		}
		if (
			this.hud.aiLogOpen
			&& !this.hud.sayOpen
			&& world.input.pressed('Escape')
		) {
			this.hud.aiLogOpen = false;
		}
	}

	private applyGameSave(save:GameSave):void {
		const world = this.gameObject.world;
		if (!world) {
			return;
		}
		applyWorld(world, save.world);
		this.applyPose(save.pose);
		world.time = save.time;
		this.director.bargainDone = save.bargainDone;
		this.director.restoreAgents(save.agents);
		this.live = save;
		this.stream.streamer.tick(world);
		this.stream.mark(world);
		this.overlayLoadedChunks(new Set(world.chunks.keys()));
		this.persistView();
		this.syncURLView();
	}

	private buildSave(id:string, label:string):GameSave | null {
		const world = this.gameObject.world;
		const pose = this.readPose();
		if (!world || !pose) {
			return null;
		}
		const agents = this.director.exportAgents();
		const keep = Object.keys(agents).length > 0 ? agents : (this.live?.agents ?? {});
		return {
			version: 1,
			sceneID: this.scene.id,
			id,
			label,
			savedAt: new Date().toISOString(),
			pose,
			time: world.time,
			bargainDone: this.director.bargainDone,
			agents: keep,
			world: mergeWorldSave(this.live?.world, captureWorld(world), world),
		};
	}

	private dropPointerLock():void {
		const canvas = this.getCanvas();
		if (document.pointerLockElement === canvas) {
			document.exitPointerLock();
		}
	}

	private readonly onClick = ():void => {
		if (this.hud.sayOpen || this.hud.menuOpen) {
			return;
		}
		this.getCanvas()?.focus();
		this.gameObject.world?.input.requestLock();
		void this.gameObject.world?.audio.resume();
	};

	private persistAudio():void {
		const packed = `${this.hud.musicVolume}:${this.hud.sfxVolume}:${this.hud.audioMuted ? 1 : 0}`;
		if (packed === this.lastAudioPacked) {
			return;
		}
		this.lastAudioPacked = packed;
		setPrefs({
			music: this.hud.musicVolume,
			sfx: this.hud.sfxVolume,
			muted: this.hud.audioMuted,
			menuMusicMuted: this.hud.musicVolume > 0 ? false : prefs().menuMusicMuted,
		});
	}
}
