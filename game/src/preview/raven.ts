// The raven on its own, in each of its poses and moves (`/raven.html`, dev server only).
//   ?mode=peck  start in that mode (a button's name, lowercase); ?yaw=1.57&pitch=0.2&dist=1.6 camera orbit
// The title turns to "ready" once the model has drawn, for headless screenshots (`kindling/scripts/shoot.mjs`).
import { Camera, Component, Game, GameObject, MeshRenderer, registerToonModel } from '@arc-director/kindling';
import { FOLDED, applyPose, flightPose, hopPose, lookPose, peckPose, type Pose } from '../characters/ravenPose';
import { PROP_MODELS } from '../render/characterModels';

/** Bind pose: wings spread as the model was made. */
const SPREAD:Pose = { body: 0, head: [0, 0], tail: 0, fan: 1, wing: [0, 0, 0], tip: [0, 0, 0] };

/** `t` seconds into a move that lasts `seconds` and then rests `rest` seconds: how far through it (0–1), looping. */
const loop = (t:number, seconds:number, rest:number):number => Math.min(1, (t % (seconds + rest)) / seconds);

/** Each button: the pose at `t` seconds in, and how high off the ground (m). */
const MODES:Record<string, (t:number)=>{ pose:Pose; lift?:number }> = {
	Folded: () => ({ pose: FOLDED }),
	Spread: () => ({ pose: SPREAD }),
	Peck: (t) => ({ pose: peckPose(loop(t, 0.5, 0.6)) }),
	Hop: (t) => {
		const u = loop(t, 0.22, 0.6);
		return { pose: hopPose(u), lift: 0.07 * Math.sin(Math.PI * u) };
	},
	Look: (t) => ({ pose: lookPose(loop(t, 0.9, 0.4), Math.floor(t / 1.3) % 2 ? -0.8 : 0.8) }),
	// Take off, fly and land in place, over and over.
	Fly: (t) => {
		const u = loop(t, 2.5, 0.8);
		return { pose: u < 1 ? flightPose(u, t) : FOLDED, lift: 0.6 * Math.sin(Math.PI * u) };
	},
	// Beating hard, as when rising.
	Flap: (t) => ({ pose: flightPose(0.13, t), lift: 0.4 }),
};

const params = new URLSearchParams(location.search);
let mode = Object.keys(MODES).find((m) => m.toLowerCase() === params.get('mode')) ?? 'Folded';
let speed = 1;
let clock = 0;

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
await registerToonModel('Raven', '/models/Raven.glb', { height: PROP_MODELS.Raven });

class Preview extends Component {
	public override update(dt:number):void {
		clock += dt * speed;
	}

	public override lateUpdate():void {
		const root = this.gameObject.getComponent(MeshRenderer)?.mesh;
		if (root) {
			const { pose, lift = 0 } = MODES[mode](clock);
			applyPose(root, pose);
			this.gameObject.transform.position.y = lift;
		}
	}
}

const raven = new GameObject('Raven');
// Facing the camera, which starts out looking down −Z.
raven.transform.yaw = Math.PI;
raven.addComponent(MeshRenderer, { meshID: 'Raven' });
raven.addComponent(Preview);
game.world.add(raven);

// Orbit around the bird: yaw 0 looks at its face.
const orbit = { yaw: Number(params.get('yaw') ?? 0.6), pitch: Number(params.get('pitch') ?? 0.15), dist: Number(params.get('dist') ?? 1.6) };
const cam = new GameObject('camera');
cam.addComponent(Camera, { fov: 30 });
game.world.add(cam);
function place():void {
	const target = { x: 0, y: 0.2, z: 0 };
	const flat = Math.cos(orbit.pitch) * orbit.dist;
	const t = cam.transform;
	t.position.x = target.x + Math.sin(orbit.yaw) * flat;
	t.position.y = target.y + Math.sin(orbit.pitch) * orbit.dist;
	t.position.z = target.z + Math.cos(orbit.yaw) * flat;
	t.yaw = orbit.yaw;
	t.pitch = -orbit.pitch;
}
place();
let drag:{ x:number; y:number } | null = null;
addEventListener('pointerdown', (e) => {
	if (!(e.target as HTMLElement).closest('#bar, #fold')) {
		drag = { x: e.clientX, y: e.clientY };
	}
});
addEventListener('pointerup', () => {
	drag = null;
});
addEventListener('pointermove', (e) => {
	if (drag) {
		orbit.yaw -= (e.clientX - drag.x) * 0.01;
		orbit.pitch = Math.max(-1.2, Math.min(1.4, orbit.pitch + (e.clientY - drag.y) * 0.01));
		drag = { x: e.clientX, y: e.clientY };
		place();
	}
});
addEventListener('wheel', (e) => {
	orbit.dist = Math.max(0.5, Math.min(6, orbit.dist * Math.exp(e.deltaY * 0.001)));
	place();
});

const bar = document.querySelector<HTMLElement>('#bar')!;
function button(label:string, on:()=>boolean, click:()=>void):void {
	const b = document.createElement('button');
	b.textContent = label;
	b.addEventListener('click', () => {
		click();
		bar.querySelectorAll('button').forEach((el) => el.dispatchEvent(new Event('sync')));
	});
	b.addEventListener('sync', () => b.classList.toggle('on', on()));
	b.classList.toggle('on', on());
	bar.append(b);
}
for (const m of Object.keys(MODES)) {
	button(m, () => mode === m, () => {
		mode = m;
		clock = 0;
	});
}
button('Slow motion', () => speed < 1, () => {
	speed = speed < 1 ? 1 : 0.2;
});

// Sliders that tune the folded pose live (every ground pose builds on it); the line below reads out the values.
const fold = document.querySelector<HTMLElement>('#fold')!;
const readout = document.createElement('code');
type Slider = { label:string; min:number; max:number; get:()=>number; set:(v:number)=>void };
const SLIDERS:Slider[] = [
	...(['wing', 'tip'] as const).flatMap((bone) => ['X', 'Y', 'Z'].map((axis, i):Slider => ({
		label: `${bone === 'wing' ? 'Wing' : 'Wing tip'} ${axis}`,
		min: -3.14,
		max: 3.14,
		get: () => FOLDED[bone][i],
		set: (v) => {
			FOLDED[bone][i] = v;
		},
	}))),
	{ label: 'Tail fan', min: 0, max: 1, get: () => FOLDED.fan, set: (v) => {
		FOLDED.fan = v;
	} },
];
const show = ():void => {
	readout.textContent = `wing: [${FOLDED.wing.join(', ')}], tip: [${FOLDED.tip.join(', ')}], fan: ${FOLDED.fan}`;
};
for (const s of SLIDERS) {
	const row = document.createElement('label');
	const input = Object.assign(document.createElement('input'), { type: 'range', min: String(s.min), max: String(s.max), step: '0.01', value: String(s.get()) });
	const value = document.createElement('span');
	value.textContent = String(s.get());
	input.addEventListener('input', () => {
		s.set(Number(input.value));
		value.textContent = input.value;
		show();
	});
	row.append(s.label, input, value);
	fold.append(row);
}
show();
fold.append(readout);

game.start();

let frames = 0;
function wait():void {
	if (raven.getComponent(MeshRenderer)?.mesh && ++frames > 10) {
		document.title = 'ready';
		return;
	}
	requestAnimationFrame(wait);
}
wait();
