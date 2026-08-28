import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { register } from './meshes.js';

/** Load a `.gltf` / `.glb` and register `meshID` as a clone of the scene. Does not attach to a GameObject. */
export async function registerGltf(meshID:string, url:string):Promise<void> {
	const loader = new GLTFLoader();
	const gltf = await loader.loadAsync(url);
	const template = gltf.scene;
	register(meshID, () => template.clone(true));
}
