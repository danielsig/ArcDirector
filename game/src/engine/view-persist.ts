import { lsGet, lsSet } from '../prefs';

export type ViewPose = {
	x:number;
	y:number;
	z:number;
	yaw:number;
	camYaw:number;
	pitch:number;
	distance:number;
};

const PREFIX = 'arc-director.view.v1.';
/** Each field, in the order it is kept, and the decimals it keeps. */
const DECIMALS:Record<keyof ViewPose, number> = { x: 3, y: 3, z: 3, yaw: 4, camYaw: 4, pitch: 4, distance: 3 };
const FIELDS = Object.keys(DECIMALS) as (keyof ViewPose)[];

export function packViewPose(pose:ViewPose):string {
	return JSON.stringify(Object.fromEntries(FIELDS.map((k) => [k, Math.round(pose[k] * 10 ** DECIMALS[k]) / 10 ** DECIMALS[k]])));
}

/** The pose last kept for `sceneID`; null when none, or not every field is a finite number. */
export function loadViewPose(sceneID:string):ViewPose | null {
	try {
		const data = JSON.parse(lsGet(PREFIX + sceneID) ?? 'null') as Partial<ViewPose> | null;
		return data && FIELDS.every((k) => Number.isFinite(data[k])) ? Object.fromEntries(FIELDS.map((k) => [k, data[k]])) as ViewPose : null;
	}
	catch {
		return null;
	}
}

export function saveViewPose(sceneID:string, packed:string):void {
	lsSet(PREFIX + sceneID, packed);
}
