import { Component } from './Component.js';

export class BoxCollider extends Component {
	public static override saved = ['isTrigger', 'solid'];
	public size = { x: 1, y: 1, z: 1 };
	public isTrigger = false;
	public solid = true;
	/** Extra XZ pad vs other padded colliders. Those pairs use a shove instead of hard-blocking. */
	public pad = 0;
}
