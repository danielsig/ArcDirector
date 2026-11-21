import * as THREE from 'three';
import { bevelBox, Component, mergeParts, solidMesh } from '@arc-director/kindling';
import { PALETTE, toon } from '../../render/toon';
import { sharedMesh, spawnProp, type Sense, type Thing } from '../thing';
import { wallOffset } from '../walls/thin-wall';

/** Words carved on it. Sight and `examine` read them out. */
export class Inscription extends Component {
	public static override saved = ['answered'];
	public text = '';
	/** Once its riddle is answered, what sight and `examine` say instead of the carving ("answered: SealedDoor stands open"). */
	public answered = '';

	/** A landmark with words on it, read out to whoever sees it. */
	public sense():Sense {
		return {
			tags: ['inscription', 'landmark'],
			interactable: true,
			movable: false,
			note: this.text ? this.answered || `carved: "${this.text}"` : undefined,
			examine: (name) => (this.answered ? `${name}: ${this.answered}.` : `Carved on ${name}: "${this.text}"`),
		};
	}
}

/** An upright carved stone, its words cut in rows on the face toward +Z. */
function createTabletMesh():THREE.Group {
	const g = new THREE.Group();
	const stone = toon(PALETTE.wall, { pattern: 'stone', patternScale: 0.2, patternInk: 0.4 });
	const carving = toon(0x2a2622, { outline: false });
	g.add(solidMesh(bevelBox(0.7, 1.15, 0.16, 0.04), stone));
	const base = new THREE.Mesh(bevelBox(0.86, 0.14, 0.3, 0.03), stone);
	base.castShadow = true;
	g.add(base);
	const rows = [0.95, 0.83, 0.71, 0.59, 0.47, 0.35];
	g.add(new THREE.Mesh(mergeParts(rows.map((y, i) => ({ geo: new THREE.BoxGeometry(0.5 - (i % 3) * 0.08, 0.035, 0.01), y, z: 0.082 }))), carving));
	return g;
}

export const inscription:Thing = {
	defs: ['inscription'],
	spawn: (world, chunk, ents) => ents.forEach((ent) => {
		const tablet = spawnProp(chunk, ent, 'stone_tablet', 0.5, ent.yaw ?? wallOffset(world.terrain, chunk.tileCoord(ent.localX, ent.localZ)).yaw + Math.PI);
		tablet.addComponent(Inscription, { text: ent.text ?? '' });
		world.add(tablet);
	}),
	meshes: { stone_tablet: sharedMesh(createTabletMesh) },
};
