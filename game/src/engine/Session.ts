import { AudioSource, Camera, Component } from '@arc-director/kindling';
import { Camera as FollowCamera, Appearance, BoxCollider, RigidBody } from './components';
import { MeshRenderer } from './MeshRenderer';
import { Order } from './order';
import { PlayerInput } from '../characters/PlayerInput';
import { PlayerPilot } from '../characters/PlayerPilot';
import type { SceneDef } from '../data/scenes';
import { GameHost, addModels } from '../director/adapter';
import { playerSay, playerSayCatalog } from '../director/playerTalk';
import { dumpLookMaps } from '../director/aiLogSink';
import { patchInfer } from './patchHud';
import type { HudModel, HudModelOption } from '../ui/hudModel';
import {
	contextLabel,
	prefs,
	prefsDetached,
	setPrefs,
	systemOneName,
	watchPrefs,
	type PlayerMode,
	type Prefs,
} from '../prefs';
import {
	fetchModelCatalog,
	isDecisionModel,
	isEmbeddingModel,
	isLoadedModel,
} from 'arc-director';
import { captureWorld, diffWorld, resetTime, restoreWorld, Time, type WorldState } from '@arc-director/kindling';
import { readSave, respawn, writeSave, type GameSave } from './save';
import {
	packViewPose,
	saveViewPose,
	type ViewPose,
} from './viewPersist';
import {
	applyURLView,
	writeURLView,
	type URLView,
} from './urlView';
import type { Hud, WorldStream, WorldView } from './systems';
import { characterLabel, characterModel, characterOptions, resolvePlayerKind } from '../render/characterModels';
import { bindArcControl } from '../control/bind';

/** Host session: Vue calls say / save / load; Kindling runs keys, flags, persist. */
export class Session extends Component {
	public static override order = Order.persist;
	public hud!:HudModel;
	public director!:GameHost;
	public scene!:SceneDef;
	public stream!:WorldStream;
	public view!:WorldView;
	public hudView!:Hud;
	public getCanvas:()=>HTMLCanvasElement | null = () => null;
	public getRunning:()=>boolean = () => false;
	public homePose:ViewPose = {
		x: 0,
		y: 0,
		z: 0,
		yaw: 0,
		camYaw: 0,
		pitch: 40 * Math.PI / 180,
		distance: Math.hypot(11, 7.4),
	};
	/** The scene as built, before play. Saves are a diff against it. */
	public fresh:WorldState = {};
	private _persistAcc = 0;
	private _lastViewPacked = '';
	private _unbindControl = ():void => undefined;
	private _unwatchPrefs = ():void => undefined;

	public override awake():void {
		this.getCanvas()?.addEventListener('click', this._onClick);
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
		this._unwatchPrefs = watchPrefs((next, prev) => {
			this.applyPrefs(next, prev);
		});
		this._unbindControl = bindArcControl(this);
	}

	public beginPlay():void {
		if (!this.hud.arcDirectorOn) {
			return;
		}
		void this.director.start().catch((err:unknown) => {
			console.error(err);
		});
	}

	public override lateUpdate(dt:number):void {
		this._persistAcc += dt;
		if (this._persistAcc < 0.3) {
			return;
		}
		this._persistAcc = 0;
		this.persistView();
		this.syncURLView();
	}

	public override onDestroy():void {
		this.getCanvas()?.removeEventListener('click', this._onClick);
		this.director.dispose();
		this._unwatchPrefs();
		this._unbindControl();
		const lookHost = window as unknown as { setLook?:(yaw:number, pitch:number)=>void };
		lookHost.setLook = undefined;
	}

	/** Runs every frame, including while the menu pauses simulation. */
	public poll():void {
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
		else if (!this.modalOpen() && (world.input.pressed('Enter') || world.input.pressed('NumpadEnter'))) {
			this.hud.sayOpen = true;
			world.sayOpen = true;
			this.patchSayCatalog();
			world.input.keys.clear();
			this.dropPointerLock();
			this.hud.chatOpen = true;
		}
		else {
			world.sayOpen = false;
		}
		if (this.modalOpen()) {
			world.sayOpen = true;
			if (world.input.pointerLocked) {
				this.dropPointerLock();
			}
		}
		this.hudKeys();
	}

	public pausePresent():void {
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

	public say(spoken:string):void {
		this.hud.sayOpen = false;
		if (spoken.trim()) {
			setPrefs({ player: 'participant' });
		}
		playerSay(this.director, spoken);
	}

	public save():GameSave | null {
		const world = this.gameObject.world;
		const pose = this.readPose();
		if (!world || !pose) {
			this.hud.menuNotice = 'Save failed';
			return null;
		}
		this.stream.loadAll();
		const save:GameSave = {
			savedUTC: new Date().toISOString(),
			time: Time.time,
			bargainDone: this.director.bargainDone,
			pose,
			world: diffWorld(this.fresh, captureWorld(world)),
			cast: this.director.arc?.exportCast() ?? { characters: {}, collectives: {} },
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
	public load():boolean {
		if (!readSave(this.scene.id)) {
			this.hud.menuNotice = 'No save';
			return false;
		}
		this.hud.bootFrom = 'save';
		this.hud.boots += 1;
		return true;
	}

	/** Boot a fresh Game with the player at the scene's spawn. */
	public restart():void {
		this.hud.bootFrom = 'spawn';
		this.hud.boots += 1;
	}

	/** Apply `save` to the scene just built. Minds restore when ArcDirector starts. */
	public restore(save:GameSave):void {
		const world = this.gameObject.world;
		if (!world) {
			return;
		}
		restoreWorld(world, save.world, (recipe) => respawn(world, recipe));
		resetTime(save.time);
		this.director.bargainDone = save.bargainDone;
		this.director.arc?.restoreCast(save.cast);
		this.applyPose(save.pose);
	}

	/** Mirror every pref into the HUD, world, and ArcDirector. Called once at boot; changes arrive through `watchPrefs`. */
	public syncPrefs():void {
		this.applyPrefs(prefs());
	}

	public applyModel():void {
		const name = this.hud.model.trim();
		if (name) {
			setPrefs({ model: name });
		}
		this.hud.menuNotice = name || 'No model';
	}

	public applyPlayerKind():void {
		const kind = resolvePlayerKind(this.hud.playerKind);
		setPrefs({ playerKind: kind });
		this.hud.menuNotice = characterLabel(kind);
	}

	public setMaxParallel(n:number):void {
		const next = setPrefs({ maxParallel: n }).maxParallel;
		this.hud.menuNotice = `${next} thinker${next === 1 ? '' : 's'}`;
	}

	public setContextLength(n:number):void {
		this.hud.menuNotice = `${contextLabel(setPrefs({ contextLength: n }).contextLength)} context`;
	}

	public resetInferStats():void {
		this.director.arc?.resetInferStats();
		patchInfer(this.director, this.hud);
	}

	public async dumpNPCMaps():Promise<void> {
		const n = await dumpLookMaps(this.director);
		this.hud.menuOpen = false;
		this.hud.aiLogOpen = true;
		this.dropPointerLock();
		this.hud.menuNotice = n > 0 ? `Logged ${n} NPC maps` : 'No NPC maps';
	}

	public resetLocation():void {
		this.applyPose(this.homePose);
		this._lastViewPacked = '';
		this._persistAcc = 0;
		this.persistView();
		this.stream.stream();
		this.syncURLView();
		this.hud.menuNotice = 'Location reset';
	}

	public async refreshHudModels():Promise<void> {
		if (!this.hud.arcDirectorOn || prefs().inference !== 'lmstudio') {
			return;
		}
		const catalog = await fetchModelCatalog('/inference');
		// A model on this machine and on a linked one is listed once per machine, alike: one row, with its count.
		const chat = catalog.filter((m, i) => !isEmbeddingModel(m) && catalog.findIndex((other) => other.id === m.id) === i);
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
			decision: isDecisionModel(m),
			devices: catalog.filter((other) => other.id === m.id).length,
		}));
		const current = this.director.arc?.modelID() || prefs().model;
		if (current && !models.some((m) => m.id === current)) {
			models.unshift({ id: current, loaded: false, decision: false, devices: 1 });
		}
		if (this.hud.model && !models.some((m) => m.id === this.hud.model)) {
			models.unshift({ id: this.hud.model, loaded: false, decision: false, devices: 1 });
		}
		this.hud.models = models;
		if (!this.hud.model) {
			this.hud.model = current || models[0]?.id || '';
		}
	}

	public onMenuOpened():void {
		this.hud.menuNotice = '';
		this.persistView();
		this.dropPointerLock();
		this.hud.model = this.director.arc?.modelID() || prefs().model || this.hud.model;
		this.hud.playerKinds = characterOptions();
		const liveKind = this.gameObject.world?.findByID('Player')?.getComponent(MeshRenderer)?.meshID;
		this.hud.playerKind = resolvePlayerKind(liveKind || this.hud.playerKind || prefs().playerKind);
		void this.refreshHudModels();
	}

	public onMenuClosed():void {
		this.getCanvas()?.focus();
		this.gameObject.world?.input.requestLock();
	}

	public applyShot(shot:URLView | null):void {
		if (!shot) {
			return;
		}
		const pose = this.readPose();
		if (!pose) {
			return;
		}
		this.applyPose(applyURLView(pose, shot));
	}

	public readPose():ViewPose | null {
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

	public applyPose(pose:ViewPose):void {
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

	public persistView():void {
		const pose = this.readPose();
		if (!pose) {
			return;
		}
		const packed = packViewPose(pose);
		if (packed === this._lastViewPacked) {
			return;
		}
		this._lastViewPacked = packed;
		saveViewPose(this.scene.id, packed);
	}

	public syncURLView():void {
		const pose = this.readPose();
		if (pose) {
			writeURLView(pose, prefs());
		}
	}

	/** No `prev` applies everything; otherwise only what changed reaches ArcDirector and the character. */
	private applyPrefs(next:Prefs, prev?:Prefs):void {
		const changed = (key:keyof Prefs):boolean => !prev || prev[key] !== next[key];
		const hud = this.hud;
		hud.player = next.player;
		hud.arcDirectorOn = next.ai;
		hud.detailMaps = next.detailMaps;
		hud.shadows = next.shadows;
		hud.fpsCounter = next.fpsCounter;
		hud.musicVolume = next.music;
		hud.sfxVolume = next.sfx;
		hud.voices = next.voices;
		hud.audioMuted = next.muted;
		hud.musicMuted = next.musicMuted;
		hud.maxParallel = next.maxParallel;
		hud.contextLength = next.contextLength;
		hud.batchThinks = next.batchThinks;
		hud.thinkingBudget = next.thinkingBudget;
		hud.temperature = next.temperature;
		hud.arcFormat = next.arcFormat;
		hud.systemOne = next.systemOne;
		hud.decisionModel = next.decisionModel;
		hud.prefsDetached = prefsDetached();
		const arc = this.director.arc;
		if (next.model && changed('model')) {
			hud.model = next.model;
		}
		if ((['inference', 'model', 'browserModel', 'maxParallel', 'contextLength', 'thinkingBudget', 'temperature', 'decisionModel'] as const).some((key) => changed(key))) {
			if (arc) {
				addModels(arc, next);
			}
		}
		if (changed('batchThinks')) {
			arc?.setBatchThinks(next.batchThinks);
		}
		if (changed('arcFormat')) {
			arc?.setArcFormat(next.arcFormat);
		}
		if (arc && changed('systemOne')) {
			arc.setDefaultSystemOne(systemOneName(next.systemOne));
		}
		if (next.playerKind && changed('playerKind')) {
			this.applyPlayerKindToBody(next.playerKind);
		}
		const world = this.gameObject.world;
		if (world) {
			world.playerInperceivable = next.player !== 'participant';
			world.arcDirectorOn = next.ai;
		}
		if (changed('player')) {
			this.applyPlayerModeToBody(next.player);
		}
		if (changed('player') || changed('ai')) {
			this.syncURLView();
		}
	}

	private patchSayCatalog():void {
		const world = this.gameObject.world;
		if (!world) {
			return;
		}
		const cat = playerSayCatalog(this.director);
		this.hud.sayTo = cat.peers.join(', ');
		this.hud.sayPeers = cat.peers;
		this.hud.sayItems = cat.items;
		this.hud.sayOffers = cat.offers;
	}

	private modalOpen():boolean {
		return this.hud.briefOpen || this.hud.keysOpen;
	}

	private hudKeys():void {
		const world = this.gameObject.world;
		if (!world) {
			return;
		}
		if (this.modalOpen()) {
			if (world.input.pressed('Escape')) {
				this.hud.briefOpen = false;
				this.hud.keysOpen = false;
			}
			return;
		}
		if (!this.hud.sayOpen && world.input.pressed('Tab')) {
			this.toggleChat();
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

	private toggleChat():void {
		this.hud.chatOpen = !this.hud.chatOpen;
		if (this.hud.chatOpen) {
			this.dropPointerLock();
		}
	}

	private dropPointerLock():void {
		const canvas = this.getCanvas();
		if (document.pointerLockElement === canvas) {
			document.exitPointerLock();
		}
	}

	private readonly _onClick = ():void => {
		if (this.hud.sayOpen || this.hud.menuOpen || this.modalOpen()) {
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
		const player = this.gameObject.world?.findByID('Player');
		const mesh = player?.getComponent(MeshRenderer);
		if (mesh) {
			mesh.meshID = resolved;
		}
		const look = player?.getComponent(Appearance);
		if (look) {
			look.height = characterModel(resolved)?.height ?? look.height;
		}
	}

	/** A camera player has no body: nothing to render, nothing to bump into, nothing to hear, no hands. */
	private applyPlayerModeToBody(mode:PlayerMode):void {
		const player = this.gameObject.world?.findByID('Player');
		if (!player) {
			return;
		}
		const embodied = mode !== 'camera';
		player.transform.object3D.visible = embodied;
		const input = player.getComponent(PlayerInput);
		if (input) {
			input.embodied = embodied;
		}
		for (const part of [player.getComponent(BoxCollider), player.getComponent(AudioSource)]) {
			if (part) {
				part.enabled = embodied;
			}
		}
	}
}
