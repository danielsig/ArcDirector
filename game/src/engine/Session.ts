import { AudioSource, ChunkStreamer, Component } from '@arc-director/kindling';
import { Appearance, BoxCollider, FollowCamera } from './components';
import { DemoMeshRenderer } from './demo-mesh-renderer';
import { PlayerInput } from '../characters/PlayerInput';
import { PlayerPilot } from '../characters/PlayerPilot';
import type { Scene } from '../scenes/scene';
import { GameHost, addModels } from '../director/adapter';
import { playerSay, playerSayCatalog } from '../director/player-talk';
import { dumpLookMaps } from '../director/ai-log-sink';
import type { HudUI } from '../ui/hud-model';
import { flagsFromURL, PLAYER_MODES, prefs, setPrefs, watchPrefs, type PlayerMode, type Prefs } from '../prefs';
import { defaultSystemOne } from '../director/hosted';
import { quickBenchRunning } from '../director/quick-bench';
import { readSave } from './game-save';
import { readURLCamera, readURLFlags, readURLView } from './url-view';
import type { PlayerPose } from './PlayerPose';
import type { SaveSlot } from './SaveSlot';
import { characterLabel, characterModel, characterOptions, resolvePlayerKind } from '../render/character-models';
import { bindArcControl } from '../control/bind';

/** Host session: Vue calls say and the menu's buttons; Kindling runs keys, flags and prefs. */
export class Session extends Component {
	public hud!:HudUI;
	public director!:GameHost;
	public scene!:Scene;
	public pose!:PlayerPose;
	public slot!:SaveSlot;
	/** Testing (the `scrub` command): seconds the game runs before it holds still; 0 holds it, null runs freely. */
	public scrub:number | null = null;
	private _unbindControl = ():void => undefined;
	private _unwatchPrefs = ():void => undefined;
	/** Whether a bench ran last frame: one sets the shared model up its own way, so play's settings come back after. */
	private _benching = false;

	public override awake():void {
		this.gameObject.world?.renderer?.canvas.addEventListener('click', this._onClick);
		this._unwatchPrefs = watchPrefs((next, prev) => {
			this.applyPrefs(next, prev);
		});
		this._unbindControl = bindArcControl(this);
	}

	public override onDestroy():void {
		this.gameObject.world?.renderer?.canvas.removeEventListener('click', this._onClick);
		this.director.dispose();
		this._unwatchPrefs();
		this._unbindControl();
	}

	/** Starts the scene built: prefs from the URL, then the save (Load), the last pose or the spawn, then the URL's `view` and `zoom`. */
	public boot():void {
		// Read the shot before any pref change rewrites the URL with the spawn pose.
		const shot = readURLView();
		setPrefs(flagsFromURL(readURLFlags()));
		this.applyPrefs(prefs());
		this.pose.home = this.pose.read();
		if (!this.slot.boot() && this.hud.bootFrom === 'pose') {
			this.pose.applyLast();
		}
		this.hud.bootFrom = 'pose';
		this.pose.snapTo(shot);
		const { zoom } = readURLCamera();
		const cam = this.gameObject.world?.findByID('MainCamera')?.getComponent(FollowCamera);
		if (cam && zoom !== undefined) {
			cam.distance = zoom;
		}
		this.gameObject.getComponent(ChunkStreamer)?.stream();
		this.hud.menuOpen = false;
		this.hud.minimapFollow = this.scene.minimapFollow !== false;
		this.pose.persist();
		this.pose.syncURL();
	}

	/** Boots a fresh Game from the scene's save (false, with a notice, when it has none) or at its spawn. */
	public reboot(from:'save' | 'spawn'):boolean {
		if (from === 'save' && !readSave(this.scene.id)) {
			this.hud.menuNotice = 'No save';
			return false;
		}
		this.hud.bootFrom = from;
		this.hud.boots += 1;
		return true;
	}

	/** Runs every frame, including while the menu pauses simulation. */
	public poll():void {
		const world = this.gameObject.world;
		if (!world) {
			return;
		}
		// A bench holds the model while it runs, so NPCs stop thinking until it is done; the `ai` setting is untouched.
		const benching = this.hud.benchRunning || quickBenchRunning();
		world.arcDirectorOn = prefs().ai && !benching;
		if (this._benching && !benching && this.director.arc) {
			addModels(this.director.arc, prefs());
		}
		this._benching = benching;
		if (this.hud.menuOpen) {
			world.input.releaseLock();
		}
		else if (this.hud.sayOpen) {
			this.patchSayCatalog();
		}
		else if (!this.hud.guideOpen && (world.input.pressed('Enter') || world.input.pressed('NumpadEnter'))) {
			this.openSay();
		}
		const guiding = this.hud.guideOpen && !this.hud.menuOpen;
		if (guiding) {
			world.input.releaseLock();
		}
		world.sayOpen = this.hud.sayOpen || guiding;
		this.hudKeys();
	}

	/** Opens the say box and the chat over it. */
	public openSay():void {
		const world = this.gameObject.world;
		if (!world) {
			return;
		}
		this.hud.sayOpen = true;
		world.sayOpen = true;
		this.patchSayCatalog();
		world.input.keys.clear();
		world.input.releaseLock();
		this.hud.chatOpen = true;
	}

	/** Takes the hotbar's `index`th item in hand, or puts it back. */
	public toggleItem(index:number):void {
		this.gameObject.world?.findByID('Player')?.getComponent(PlayerInput)?.toggleItem(index);
	}

	public say(spoken:string):void {
		this.hud.sayOpen = false;
		if (spoken.trim()) {
			setPrefs({ player: 'participant' });
		}
		playerSay(this.director, spoken);
	}

	public applyPlayerKind():void {
		const kind = resolvePlayerKind(this.hud.playerKind);
		setPrefs({ playerKind: kind });
		this.hud.menuNotice = characterLabel(kind);
	}

	public resetInferStats():void {
		this.director.arc?.models.resetInferStats();
	}

	public async dumpNPCMaps():Promise<void> {
		const n = await dumpLookMaps(this.director);
		this.hud.menuOpen = false;
		this.hud.aiLogOpen = true;
		setPrefs({ aiLogFull: true });
		this.gameObject.world?.input.releaseLock();
		this.hud.menuNotice = n > 0 ? `Logged ${n} NPC maps` : 'No NPC maps';
	}

	public onMenuOpened():void {
		this.hud.menuNotice = '';
		this.pose.persist();
		this.gameObject.world?.input.releaseLock();
		this.hud.playerKinds = characterOptions();
		const liveKind = this.gameObject.world?.findByID('Player')?.getComponent(DemoMeshRenderer)?.meshID;
		this.hud.playerKind = resolvePlayerKind(liveKind || this.hud.playerKind || prefs().playerKind);
	}

	public onMenuClosed():void {
		this.gameObject.world?.renderer?.canvas.focus();
		this.gameObject.world?.input.requestLock();
	}

	/** No `prev` applies everything; otherwise only what changed reaches ArcDirector and the character. */
	private applyPrefs(next:Prefs, prev?:Prefs):void {
		const changed = (key:keyof Prefs):boolean => !prev || prev[key] !== next[key];
		this.director.arc
			?.if((['inference', 'model', 'browserModel', 'maxParallel', 'batchThinks', 'contextLength', 'thinkingBudget', 'temperature', 'decisionModel'] as const).some((key) => changed(key)), (d) => addModels(d, next))
			.if(changed('arcFormat'), (d) => d.withMind({ arcFormat: next.arcFormat }))
			.if(changed('systemOne'), (d) => d.models.withDefaultSystemOne(defaultSystemOne(next.systemOne)));
		if (prev && next.ai && changed('ai')) {
			this.director.connect();
		}
		if (next.playerKind && changed('playerKind')) {
			this.applyPlayerKindToBody(next.playerKind);
		}
		const world = this.gameObject.world;
		if (world) {
			world.playerImperceptible = next.player !== 'participant';
		}
		if (changed('player')) {
			this.applyPlayerModeToBody(next.player);
		}
		if (changed('player') || changed('ai')) {
			this.pose.syncURL();
		}
	}

	private patchSayCatalog():void {
		const cat = playerSayCatalog(this.director);
		this.hud.sayPeers = cat.peers;
		this.hud.sayItems = cat.items;
		this.hud.sayOffers = cat.offers;
	}

	private hudKeys():void {
		const world = this.gameObject.world;
		if (!world) {
			return;
		}
		if (this.hud.guideOpen) {
			if (world.input.pressed('Escape')) {
				this.hud.guideOpen = false;
			}
			return;
		}
		if (!this.hud.sayOpen && world.input.pressed('Tab')) {
			this.toggleChat();
		}
		if (!this.hud.sayOpen && world.input.pressed('KeyV')) {
			setPrefs({ player: PLAYER_MODES[(PLAYER_MODES.indexOf(prefs().player) + 1) % PLAYER_MODES.length] });
		}
		if (!this.hud.sayOpen && world.input.pressed('Backquote')) {
			this.hud.aiLogOpen = !this.hud.aiLogOpen;
			if (this.hud.aiLogOpen) {
				world.input.releaseLock();
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
			this.gameObject.world?.input.releaseLock();
		}
	}

	private readonly _onClick = ():void => {
		if (this.hud.sayOpen || this.hud.menuOpen || this.hud.guideOpen) {
			return;
		}
		this.gameObject.world?.findByID('Player')?.getComponent(PlayerPilot)?.interrupt();
		this.gameObject.world?.renderer?.canvas.focus();
		this.gameObject.world?.input.requestLock();
		void this.gameObject.world?.audio.resume();
	};

	private applyPlayerKindToBody(kind:string):void {
		const resolved = resolvePlayerKind(kind);
		this.hud.playerKind = resolved;
		const player = this.gameObject.world?.findByID('Player');
		const mesh = player?.getComponent(DemoMeshRenderer);
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
