// Character lineup for the game's models (`game/public/models`, built by `scripts/buildModels.mjs`).
//   ?clip=idle        clip every character plays (any name in clips.glb)
//   ?models=Hero,Robe  which models (default: all characters)
//   ?spin=1           turn them slowly
//   ?yaw=0.6          fixed facing in radians (0 faces the camera)
//   ?base=/@fs/…/  load models from another folder (e.g. the raw sources, which keep their own clips)
//   ?camY=0.4&camZ=6  camera height and distance; ?frames=60 waits that many frames before "ready"
//   ?right=Sword&left=ShamanBow  props in hand (grips in PROPS); ?draw=1 draws a left-hand bow to the right hand
//   ?look=1           heads turn to the camera; ?reach=right reaches that hand ahead at chest height
// The title turns to "ready" once every model has drawn, for headless screenshots.
import * as THREE from 'three';
import {
	Animator,
	Camera,
	Component,
	Game,
	GameObject,
	MeshRenderer,
	create as makeMesh,
	registerToonClips,
	registerToonModel,
	toonClip,
	holdInHand,
	lookAt,
	reach,
	drawBow,
	humanBone,
	type Grip,
	type Hand,
} from '@arc-director/kindling';

const CHARACTERS = [
	'Hero', 'KnightMale', 'KnightFemale', 'Rogue', 'Scout', 'Sorceress', 'Witch', 'Shaman',
	'Robe', 'Merchant', 'Blacksmith', 'VillagerMale', 'VillagerFemale',
	'Ghoul', 'SkeletonWarrior', 'SkeletonArcher', 'SkeletonKing',
];

/** Hand-held props: height (m) and how the hand holds each. */
const PROPS:Record<string, { height:number; grip:Grip }> = {
	Sword: { height: 1, grip: { at: 0.87, tilt: Math.PI + 0.4 } },
	Staff: { height: 1.7, grip: { at: 0.62 } },
	ShamanStaff: { height: 1.6, grip: { at: 0.6 } },
	ShamanBow: { height: 1.2, grip: { tilt: 1 } },
	SkeletalBow: { height: 1.2, grip: { tilt: 1 } },
};

const params = new URLSearchParams(location.search);
const names = params.get('models')?.split(',') ?? CHARACTERS;
const clip = params.get('clip') ?? 'idle';
const spin = params.get('spin') === '1';
const yaw = Number(params.get('yaw') ?? 0);
const waitFrames = Number(params.get('frames') ?? 10);
declare const __GAME_MODELS__:string;
const base = params.get('base') ?? __GAME_MODELS__;

const game = new Game();
game.mount(document.body);
game.renderer?.applyLook({
	background: 0xf3eee4,
	fogNear: 60,
	fogFar: 120,
	exposure: 1.45,
	hemiSky: 0xd7ebff,
	hemiGround: 0x3d6b38,
	hemiIntensity: 1.35,
	fillColor: 0x8fb892,
	fillIntensity: 0.48,
	sun: { color: 0xfff6d8, intensity: 2.65 },
	ink: 0x2b1d12,
});

const held = (['left', 'right'] as const).flatMap((hand) => {
	const prop = params.get(hand);
	return prop ? [{ hand, prop }] : [];
});
await Promise.all([
	registerToonClips(`${__GAME_MODELS__}clips.glb`),
	...names.map((n) => registerToonModel(n, `${base}${n}.glb`, { height: 1.7 })),
	...held.map(({ prop }) => registerToonModel(prop, `${__GAME_MODELS__}${prop}.glb`, { height: PROPS[prop]?.height ?? 1 })),
]);

/** Props, head turn, reach and bow draw from the query, every frame after the clip. */
class Pose extends Component {
	private _props:{ hand:Hand; prop:THREE.Object3D }[] | null = null;

	public override lateUpdate():void {
		const root = this.gameObject.getComponent(MeshRenderer)?.mesh;
		if (!root) {
			return;
		}
		this._props ??= held.flatMap(({ hand, prop }) => {
			const obj = makeMesh(prop);
			const g = { ...PROPS[prop]?.grip };
			if (params.has('tilt')) {
				g.tilt = Number(params.get('tilt'));
				g.roll = Number(params.get('roll') ?? 0);
			}
			return obj && holdInHand(root, hand, obj, g) ? [{ hand, prop: obj }] : [];
		});
		if (params.get('look') === '1') {
			lookAt(root, cam.transform.position.clone(), 1);
		}
		const side = params.get('reach') as Hand | null;
		if (side) {
			const p = this.gameObject.transform.position;
			const ahead = new THREE.Vector3(0, 0, -0.45).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.gameObject.transform.yaw);
			reach(root, side, new THREE.Vector3(p.x, p.y + 1.1, p.z).add(ahead), 1);
		}
		const bow = this._props.find((h) => h.hand === 'left')?.prop;
		const pull = humanBone(root, 'rightHand');
		if (bow) {
			drawBow(bow, params.get('draw') === '1' && pull ? pull.getWorldPosition(new THREE.Vector3()) : null);
		}
	}
}

class Turn extends Component {
	public override update(dt:number):void {
		this.gameObject.transform.yaw += dt * 0.5;
	}
}

const gap = 0.85;
// Yaw π turns a model toward the camera, which looks down −Z.
const figures = names.map((name, i) => {
	const go = new GameObject(name);
	go.transform.position.x = (i - (names.length - 1) / 2) * gap;
	go.transform.yaw = Math.PI + yaw;
	go.addComponent(MeshRenderer, { meshID: name });
	go.addComponent(Animator, { clip, speed: Number(params.get('rate') ?? 1) });
	go.addComponent(Pose);
	if (spin) {
		go.addComponent(Turn);
	}
	game.world.add(go);
	return go;
});

const width = names.length * gap;
const cam = new GameObject('camera');
cam.transform.position.y = Number(params.get('camY') ?? 0.9);
cam.transform.position.z = Number(params.get('camZ') ?? Math.max(6, width * 0.95));
cam.addComponent(Camera, { fov: 21 });
game.world.add(cam);

game.start();
// For poking at from devtools or `shoot.mjs` EVAL.
Object.assign(window, { game, figures, toonClip });

let frames = 0;
function wait():void {
	if (figures.every((go) => go.getComponent(MeshRenderer)?.mesh) && ++frames > waitFrames) {
		document.title = 'ready';
		return;
	}
	requestAnimationFrame(wait);
}
wait();
