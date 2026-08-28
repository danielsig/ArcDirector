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

function storageKey(sceneID:string):string {
	return PREFIX + sceneID;
}

function finite(n:unknown):n is number {
	return typeof n === 'number' && Number.isFinite(n);
}

export function packViewPose(pose:ViewPose):string {
	return JSON.stringify({
		x: Math.round(pose.x * 1000) / 1000,
		y: Math.round(pose.y * 1000) / 1000,
		z: Math.round(pose.z * 1000) / 1000,
		yaw: Math.round(pose.yaw * 10000) / 10000,
		camYaw: Math.round(pose.camYaw * 10000) / 10000,
		pitch: Math.round(pose.pitch * 10000) / 10000,
		distance: Math.round(pose.distance * 1000) / 1000,
	});
}

export function parseViewPose(raw:string):ViewPose | null {
	try {
		const data = JSON.parse(raw) as Partial<ViewPose>;
		if (
			!finite(data.x)
			|| !finite(data.y)
			|| !finite(data.z)
			|| !finite(data.yaw)
			|| !finite(data.camYaw)
			|| !finite(data.pitch)
			|| !finite(data.distance)
		) {
			return null;
		}
		return {
			x: data.x,
			y: data.y,
			z: data.z,
			yaw: data.yaw,
			camYaw: data.camYaw,
			pitch: data.pitch,
			distance: data.distance,
		};
	}
	catch {
		return null;
	}
}

export function loadViewPose(sceneID:string):ViewPose | null {
	try {
		const raw = localStorage.getItem(storageKey(sceneID));
		if (!raw) {
			return null;
		}
		return parseViewPose(raw);
	}
	catch {
		return null;
	}
}

export function saveViewPose(sceneID:string, packed:string):void {
	try {
		localStorage.setItem(storageKey(sceneID), packed);
	}
	catch {
		// quota / private mode
	}
}

export function clearViewPose(sceneID:string):void {
	try {
		localStorage.removeItem(storageKey(sceneID));
	}
	catch {
		// private mode
	}
}
