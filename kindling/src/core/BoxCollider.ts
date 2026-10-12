import { Component } from './Component.js';

export class BoxCollider extends Component {
	public static override saved = ['isTrigger', 'solid'];
	public size = { x: 1, y: 1, z: 1 };
	/** `cylinder`: an upright round obstacle of diameter `size.x` that bodies slide around. Moving bodies stay boxes. */
	public shape:'box' | 'cylinder' = 'box';
	public isTrigger = false;
	public solid = true;
	/** Extra XZ pad vs other padded colliders. Those pairs use a shove instead of hard-blocking. */
	public pad = 0;
}
