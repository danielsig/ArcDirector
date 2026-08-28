import { Component } from './Component.js';

export class Rigidbody extends Component {
	mass = 1;
	velocity = { x: 0, z: 0 };
	kinematic = false;
	prevX = 0;
	prevZ = 0;
	/** Snap Y to `World.sampleTerrain` worldY. */
	grounded = false;
	stepHeight = 1;
}
