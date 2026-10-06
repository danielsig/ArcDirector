import { Camera } from '@arc-director/kindling';
import { Camera as FollowCamera, HumanSprite, RigidBody } from './components';
import { Component } from './Component';
import { MeshRenderer } from './MeshRenderer';
import { Order } from './order';
import { PlayerInput } from '../actors/PlayerInput';
import { PlayerPilot } from '../actors/PlayerPilot';
import type { SceneDef } from '../data/scenes';
import { GameHost } from '../npc/adapter';
import { playerSay, playerSayCatalog } from '../npc/playerTalk';
import { dumpLookMaps } from '../npc/aiLogSink';
import { patchInfer } from './patchHud';
import { parseSlash } from '../ui/sayCommands';
import type { HudModel, HudModelOption } from '../ui/hudModel';
import {
	contextLabel,
	prefs,
	prefsDetached,
	setPrefs,
	watchPrefs,
	type Prefs,
} from '../prefs';
import {
	fetchModelCatalog,
	isEmbeddingModel,
	isLoadedModel,
} from 'arc-director';
import { captureWorld, diffWorld, restoreWorld, type WorldState } from '@arc-director/kindling';
import { readSave, respawn, writeSave, type GameSave } from './save';
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
import { bindArcControl } from '../control/bind';
import { hasHumanAnims, loadNPCAnims } from '../render/humanAnims';

/** Host session: Vue calls say / save / load; Kindling runs keys, flags, persist. */
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
	/** The scene as built, before play. Saves are a diff against it. */
	fresh:WorldState = {};
	private persistAcc = 0;
	private lastViewPacked = '';
	private unbindControl = ():void => undefined;
	private unwatchPrefs = ():void => undefined;

	override awake():void {
		this.getCanvas()?.addEventListener('click', this.onClick);
		const lookHost = window as unknown as { setLook?:(yaw:number, pitch:number)=>void };
		lookHost.setLook = (yaw:number, pitch:number):void => {
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
			const stateHost = window as unknown as { lookState?:{ yaw:number; pitch:number } };
			stateHost.lookState = { yaw, pitch };
		};
		this.unwatchPrefs = watchPrefs((next, prev) => {
			this.applyPrefs(next, prev);
		});
		this.unbindControl = bindArcControl(this);
	}

	beginPlay():void {
		if (!this.hud.arcDirectorOn) {
			return;
		}
		void this.director.start().catch((err:unknown) => {
			console.error(err);
		});
	}

	override lateUpdate(dt:number):void {
		this.persistAcc += dt;
		if (this.persistAcc < 0.3) {
			return;
		}
		this.persistAcc = 0;
		this.persistView();
		this.syncURLView();
	}

	override onDestroy():void {
		this.getCanvas()?.removeEventListener('click', this.onClick);
		this.director.dispose();
		this.unwatchPrefs();
		this.unbindControl();
		const lookHost = window as unknown as { setLook?:(yaw:number, pitch:number)=>void };
		lookHost.setLook = undefined;
	}

	/** Runs every frame, including while the menu pauses simulation. */
	poll():void {
		const world = this.gameObject.world;
		if (!world) {
			return;
		}
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
		else if (!this.hud.briefOpen && (world.input.pressed('Enter') || world.input.pressed('NumpadEnter'))) {
			this.hud.sayOpen = true;
			world.sayOpen = true;
			this.patchSayCatalog();
			world.input.keys.clear();
			this.dropPointerLock();
		}
		else {
			world.sayOpen = false;
		}
		if (this.hud.briefOpen) {
			world.sayOpen = true;
			if (world.input.pointerLocked) {
				this.dropPointerLock();
			}
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
			setPrefs({ observer: false });
		}
		playerSay(this.director, spoken);
	}

	save():GameSave | null {
		const world = this.gameObject.world;
		const pose = this.readPose();
		if (!world || !pose) {
			this.hud.menuNotice = 'Save failed';
			return null;
		}
		this.stream.loadAll();
		const save:GameSave = {
			savedUTC: new Date().toISOString(),
			time: world.time,
			bargainDone: this.director.bargainDone,
			pose,
			world: diffWorld(this.fresh, captureWorld(world)),
			agents: this.director.arc?.exportAgents() ?? {},
		};
		if (!writeSave(this.scene.id, save)) {
			this.hud.menuNotice = 'Save failed';
			return null;
		}
		this.hud.savedUTC = save.savedUTC;
		this.hud.menuNotice = 'Saved';
		return save;
	}

	/** Boot a fresh Game that restores this scene's save. */
	load():boolean {
		if (!readSave(this.scene.id)) {
			this.hud.menuNotice = 'No save';
			return false;
		}
		this.hud.loading = true;
		this.hud.boots += 1;
		return true;
	}

	/** Apply `save` to the scene just built. Minds restore when ArcDirector starts. */
	restore(save:GameSave):void {
		const world = this.gameObject.world;
		if (!world) {
			return;
		}
		restoreWorld(world, save.world, (recipe) => respawn(world, recipe));
		world.time = save.time;
		this.director.bargainDone = save.bargainDone;
		this.director.arc?.restoreAgents(save.agents);
		this.applyPose(save.pose);
	}

	/** Mirror every pref into the HUD, world, and ArcDirector. Called once at boot; changes arrive through `watchPrefs`. */
	syncPrefs():void {
		this.applyPrefs(prefs());
	}

	applyModel():void {
		const name = this.hud.model.trim();
		if (name) {
			setPrefs({ model: name });
		}
		this.hud.menuNotice = name || 'No model';
	}

	applyPlayerKind():void {
		const kind = resolvePlayerKind(this.hud.playerKind);
		setPrefs({ playerKind: kind });
		this.hud.menuNotice = characterLabel(kind);
	}

	setMaxParallel(n:number):void {
		const next = setPrefs({ maxParallel: n }).maxParallel;
		this.hud.menuNotice = `${next} thinker${next === 1 ? '' : 's'}`;
	}

	setContextLength(n:number):void {
		this.hud.menuNotice = `${contextLabel(setPrefs({ contextLength: n }).contextLength)} context`;
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
		this.applyPose(this.homePose);
		this.lastViewPacked = '';
		this.persistAcc = 0;
		this.persistView();
		this.stream.stream();
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
		this.persistView();
		this.dropPointerLock();
		this.hud.model = this.director.arc?.model || prefs().model || this.hud.model;
		this.hud.playerKinds = characterOptions();
		const liveKind = this.gameObject.world?.findByID('Player')?.getComponent(HumanSprite)?.kind;
		this.hud.playerKind = resolvePlayerKind(liveKind || this.hud.playerKind || prefs().playerKind);
		void this.refreshHudModels();
	}

	onMenuClosed():void {
		this.getCanvas()?.focus();
		this.gameObject.world?.input.requestLock();
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

	syncURLView():void {
		const pose = this.readPose();
		if (pose) {
			writeURLView(pose, prefs());
		}
	}

	/** No `prev` applies everything; otherwise only what changed reaches ArcDirector and the body. */
	private applyPrefs(next:Prefs, prev?:Prefs):void {
		const changed = (key:keyof Prefs):boolean => !prev || prev[key] !== next[key];
		const hud = this.hud;
		hud.observer = next.observer;
		hud.arcDirectorOn = next.ai;
		hud.detailMaps = next.detailMaps;
		hud.shadows = next.shadows;
		hud.musicVolume = next.music;
		hud.sfxVolume = next.sfx;
		hud.audioMuted = next.muted;
		hud.maxParallel = next.maxParallel;
		hud.contextLength = next.contextLength;
		hud.batchThinks = next.batchThinks;
		hud.thinkingBudget = next.thinkingBudget;
		hud.arcText = next.arcText;
		hud.prefsDetached = prefsDetached();
		const arc = this.director.arc;
		if (next.model && changed('model')) {
			hud.model = next.model;
			arc?.setModel(next.model);
		}
		if (changed('maxParallel')) {
			arc?.setMaxParallel(next.maxParallel);
		}
		if (changed('contextLength')) {
			arc?.setContextLength(next.contextLength);
		}
		if (changed('batchThinks')) {
			arc?.setBatchThinks(next.batchThinks);
		}
		if (changed('thinkingBudget')) {
			arc?.setThinking(next.thinkingBudget);
		}
		if (changed('arcText')) {
			arc?.setArcText(next.arcText);
		}
		if (next.playerKind && changed('playerKind')) {
			this.applyPlayerKindToBody(next.playerKind);
		}
		const world = this.gameObject.world;
		if (world) {
			world.playerInperceivable = next.observer;
			world.arcDirectorOn = next.ai;
		}
		if (changed('observer') || changed('ai')) {
			this.syncURLView();
		}
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
		if (this.hud.briefOpen) {
			if (world.input.pressed('Escape')) {
				this.hud.briefOpen = false;
			}
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

	private dropPointerLock():void {
		const canvas = this.getCanvas();
		if (document.pointerLockElement === canvas) {
			document.exitPointerLock();
		}
	}

	private readonly onClick = ():void => {
		if (this.hud.sayOpen || this.hud.menuOpen || this.hud.briefOpen) {
			return;
		}
		this.gameObject.world?.findByID('Player')?.getComponent(PlayerPilot)?.interrupt();
		this.getCanvas()?.focus();
		this.gameObject.world?.input.requestLock();
		void this.gameObject.world?.audio.resume();
	};

	private applyPlayerKindToBody(kind:string):void {
		const resolved = resolvePlayerKind(kind);
		this.hud.playerKind = resolved;
		const sprite = this.gameObject.world?.findByID('Player')?.getComponent(HumanSprite);
		if (sprite) {
			sprite.kind = resolved;
			sprite.height = characterHeight(resolved);
		}
		if (!hasHumanAnims(resolved)) {
			void loadNPCAnims([resolved]);
		}
	}
}
