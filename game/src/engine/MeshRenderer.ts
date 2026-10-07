import { MeshRenderer as KindlingMesh, register } from '@arc-director/kindling';
import { createMesh, meshReady as artReady } from '../render/meshRegistry';
import { Order } from './order';

const boundMeshes = new Set<string>();

export function bindMesh(meshID:string):void {
	if (boundMeshes.has(meshID)) {
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
