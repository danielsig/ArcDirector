import { Component } from './Component.js';

export class Rigidbody extends Component {
	public mass = 1;
	public velocity = { x: 0, z: 0 };
	public kinematic = false;
	public prevX = 0;
	public prevZ = 0;
	/** Snap Y to `World.sampleTerrain` worldY. */
	public grounded = false;
	public stepHeight = 1;
}
