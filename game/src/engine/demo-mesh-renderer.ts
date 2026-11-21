import { MeshRenderer, meshReady, register } from '@arc-director/kindling';
import { isModel } from '../render/character-models';
import { createMesh, meshReady as artReady } from '../items/item-meshes';
import { Order } from './order';

export function bindMesh(meshID:string):void {
	// Built models register themselves with Kindling (`loadCharacterModels`), and things' meshes at boot (`THINGS`).
	if (!meshReady(meshID) && !isModel(meshID)) {
		register(meshID, () => (artReady(meshID) ? createMesh(meshID) : undefined));
	}
}

export class DemoMeshRenderer extends MeshRenderer {
	public static override order = Order.mesh;
	protected override syncMesh():void {
		bindMesh(this.meshID);
		super.syncMesh();
	}
}
