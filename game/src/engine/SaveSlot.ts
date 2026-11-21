import { Component, captureWorld, resetTime, restoreWorld, saveWorld, Time, type WorldState } from '@arc-director/kindling';
import type { GameHost } from '../director/adapter';
import type { HudUI } from '../ui/hud-model';
import { readSave, respawn, writeSave, type GameSave } from './game-save';
import type { PlayerPose } from './PlayerPose';

/** The scene's one save: the world as a diff of the scene as built, the cast, the clock and the player's pose. */
export class SaveSlot extends Component {
	public hud!:HudUI;
	public director!:GameHost;
	public sceneID!:string;
	public pose!:PlayerPose;
	/** The scene as built, before play. Saves are a diff against it. */
	private _fresh:WorldState = {};

	/** Takes the scene as built, then applies the save when booting from it (minds restore when ArcDirector starts). Whether it did. */
	public boot():boolean {
		const world = this.gameObject.world!;
		this._fresh = captureWorld(world);
		const save = readSave(this.sceneID);
		this.hud.savedUTC = save?.savedUTC ?? '';
		if (!save || this.hud.bootFrom !== 'save') {
			return false;
		}
		restoreWorld(world, save.world, (recipe) => respawn(world, recipe));
		resetTime(save.time);
		Object.assign(this.director.sceneState(), save.scene);
		this.director.arc?.restoreCast(save.cast);
		this.pose.apply(save.pose);
		return true;
	}

	public save():GameSave | null {
		const world = this.gameObject.world;
		const pose = this.pose.read();
		const save:GameSave | null = world && pose && {
			savedUTC: new Date().toISOString(),
			time: Time.time,
			scene: structuredClone(this.director.sceneState()),
			pose,
			world: saveWorld(world, this._fresh),
			cast: this.director.arc?.exportCast() ?? { characters: {}, collectives: {} },
		};
		if (!save || !writeSave(this.sceneID, save)) {
			this.hud.menuNotice = 'Save failed';
			return null;
		}
		this.hud.savedUTC = save.savedUTC;
		this.hud.menuNotice = 'Saved';
		return save;
	}
}
