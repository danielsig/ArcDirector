import * as THREE from 'three';

export type MeshFactory = ()=>THREE.Object3D | undefined;

const factories = new Map<string, MeshFactory>();

export function register(meshID:string, factory:MeshFactory):void {
	factories.set(meshID, factory);
}

export function meshReady(meshID:string):boolean {
	return factories.has(meshID);
}

export function create(meshID:string):THREE.Object3D | undefined {
	return factories.get(meshID)?.();
}

function std(color:number):THREE.MeshStandardMaterial {
	return new THREE.MeshStandardMaterial({
		color,
		roughness: 0.88,
		metalness: 0.04,
	});
}

export function proceduralBox(color = 0xc9b48a):THREE.Mesh {
	const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), std(color));
	mesh.castShadow = true;
	mesh.receiveShadow = true;
	return mesh;
}

export function proceduralPlane(color = 0x3a414d, size = 24):THREE.Mesh {
	const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), std(color));
	mesh.rotation.x = -Math.PI / 2;
	mesh.receiveShadow = true;
	return mesh;
}

register('cube', () => proceduralBox());
register('plane', () => proceduralPlane());
