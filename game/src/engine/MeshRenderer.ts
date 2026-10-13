import { MeshRenderer as KindlingMesh, register } from '@arc-director/kindling';
import { isModel } from '../render/characterModels';
import { createMesh, meshReady as artReady } from '../render/meshRegistry';
import { Order } from './order';

const boundMeshes = new Set<string>();

export function bindMesh(meshID:string):void {
	// Built models register themselves with Kindling (`loadCharacterModels`).
	if (boundMeshes.has(meshID) || isModel(meshID)) {
		return;
	}
	boundMeshes.add(meshID);
	register(meshID, () => (artReady(meshID) ? createMesh(meshID) : undefined));
}

export class MeshRenderer extends KindlingMesh {
	public static override order = Order.mesh;
	public override update(dt:number):void {
		bindMesh(this.meshID);
		super.update(dt);
	}
}
