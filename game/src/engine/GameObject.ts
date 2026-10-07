import { GameObject as KindlingGO, allocID, resetAllocID } from '@arc-director/kindling';
import type { World } from './World';

export { allocID, resetAllocID };

export class GameObject extends KindlingGO {
	public declare world:World | null;
}
