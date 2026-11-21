import { Component } from './Component.js';

export class Rigidbody extends Component {
	public mass = 1;
	public velocity = { x: 0, z: 0 };
	public kinematic = false;
	public prevX = 0;
	public prevZ = 0;
	/** Snap Y to `world.terrain.sample` worldY. */
	public grounded = false;

	/** Ground speed in m/s. */
	public get speed():number {
		return Math.hypot(this.velocity.x, this.velocity.z);
	}
}
