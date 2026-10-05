import { Component } from './Component.js';

export class BoxCollider extends Component {
	static override saved = ['isTrigger', 'solid'];
	size = { x: 1, y: 1, z: 1 };
	isTrigger = false;
	solid = true;
	/** Extra XZ pad vs other padded colliders. Those pairs use a shove instead of hard-blocking. */
	pad = 0;
}
