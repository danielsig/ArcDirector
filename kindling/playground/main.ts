import {
	Camera,
	Component,
	Game,
	GameObject,
	Light,
	MeshRenderer,
	registerGltf,
	type ShaderInsert,
} from '@arc-director/kindling';

class Spin extends Component {
	speed = 0.35;

	override update(dt:number):void {
		this.gameObject.transform.yaw += dt * this.speed;
	}
}

const pulseInserts:ShaderInsert[] = [
	{ id: 'timePulse.uTime', chunk: 'common', glsl: 'uniform float uTime;' },
	{
		id: 'timePulse.color',
		chunk: 'color_fragment',
		glsl: 'diffuseColor.rgb *= 0.65 + 0.35 * sin(uTime * 4.0);',
	},
];

const game = new Game();
game.mount(document.body);

await registerGltf('tri', '/triangle.gltf');

const ground = new GameObject('ground');
ground.addComponent(MeshRenderer, { meshID: 'plane' });
game.world.add(ground);

const parent = new GameObject('parent');
parent.transform.position.y = 0.5;
parent.addComponent(MeshRenderer, { meshID: 'cube', color: 0xc45c26 });
parent.addComponent(Spin);

const child = new GameObject('child');
child.setParent(parent);
child.transform.position.x = 2;
child.transform.position.y = 0.5;
child.transform.position.z = 0;
child.addComponent(MeshRenderer, { meshID: 'cube', color: 0x3d8f5a });

game.world.add(parent);

const pulse = new GameObject('pulse');
pulse.transform.position.x = 0;
pulse.transform.position.y = 0.5;
pulse.transform.position.z = 2.4;
pulse.addComponent(MeshRenderer, {
	meshID: 'cube',
	color: 0x6a8cff,
	shaderInserts: pulseInserts,
	shaderUniforms: { uTime: { value: 0 } },
});
game.world.add(pulse);

const gltfGo = new GameObject('gltf');
gltfGo.transform.position.x = -2.2;
gltfGo.transform.position.y = 0.2;
gltfGo.transform.position.z = 0;
gltfGo.addComponent(MeshRenderer, { meshID: 'tri' });
game.world.add(gltfGo);

const lamp = new GameObject('lamp');
lamp.transform.position.x = 1.4;
lamp.transform.position.y = 4;
lamp.transform.position.z = 2;
lamp.addComponent(Light, { intensity: 36, range: 20 });
game.world.add(lamp);

const camGo = new GameObject('camera');
camGo.transform.position.x = 6;
camGo.transform.position.y = 5;
camGo.transform.position.z = 8;
camGo.transform.yaw = Math.atan2(6, 8);
camGo.transform.pitch = -Math.atan2(5, Math.hypot(6, 8));
camGo.addComponent(Camera);
game.world.add(camGo);

if (game.canvas) {
	game.world.audio.connectUnlock(game.canvas);
	game.world.audio.playMusic({
		bpm: 90,
		loop: 8,
		id: 'hi',
		voices: [{ instrument: 'pad', notes: [{ pitch: 60, beat: 0, dur: 8, vel: 0.35 }] }],
	});
}

game.start();
