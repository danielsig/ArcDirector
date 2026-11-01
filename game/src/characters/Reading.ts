import { Component, MeshRenderer, Time, closeHand, humanBone, reach, yawToForward } from '@arc-director/kindling';
import * as THREE from 'three';
import { Order } from '../engine/order';
import { getDef } from '../items/defs';
import { toon } from '../render/toon';
import { Seated } from './Seated';

/** How long a sitting with a book lasts, game seconds. */
const READ_SECONDS = 300;
/** How fast the arms come up and go down, per second. */
const EASE = 3;
/** Where the book is held from the eyes (m): ahead and below, and how far each hand stands from its spine. */
const HOLD_AHEAD = 0.3;
const HOLD_BELOW = 0.3;
const HAND_APART = 0.1;
/** How much the fists close round the covers, 0 to 1. */
const GRIP = 0.45;
/** An open book's page (m), how far its two halves fold toward the reader (radians), and how thick each is. */
const PAGE_WIDTH = 0.13;
const PAGE_HEIGHT = 0.18;
const FOLD = 0.3;
const THICK = 0.014;
/** Seconds between page turns, and how long one takes. */
const TURN_EVERY = 7;
const TURN_SECONDS = 0.7;
/** How far its head nods along the lines (radians of a slow sway, as meters at the book). */
const SWAY = 0.012;

const UP = new THREE.Vector3(0, 1, 0);

type OpenBook = { group:THREE.Group; turning:THREE.Object3D; parts:THREE.Mesh[] };

/** A half of the book: a cover and its pages, hinged on the spine. */
function half(cover:THREE.Material, paper:THREE.Material, side:number):THREE.Mesh[] {
	const board = new THREE.Mesh(new THREE.BoxGeometry(PAGE_WIDTH, PAGE_HEIGHT, THICK * 0.4), cover);
	const leaves = new THREE.Mesh(new THREE.BoxGeometry(PAGE_WIDTH * 0.96, PAGE_HEIGHT * 0.94, THICK), paper);
	board.position.set(side * PAGE_WIDTH / 2, 0, -THICK * 0.7);
	leaves.position.set(side * PAGE_WIDTH / 2, 0, 0);
	return [board, leaves];
}

function openBook(scene:THREE.Object3D, color:number):OpenBook {
	const cover = toon(color);
	const paper = toon(0xece2c8);
	const group = new THREE.Group();
	const parts:THREE.Mesh[] = [];
	for (const side of [-1, 1]) {
		const hinge = new THREE.Group();
		hinge.rotation.y = -side * FOLD;
		const meshes = half(cover, paper, side);
		hinge.add(...meshes);
		parts.push(...meshes);
		group.add(hinge);
	}
	const turning = new THREE.Group();
	const leaf = new THREE.Mesh(new THREE.BoxGeometry(PAGE_WIDTH * 0.94, PAGE_HEIGHT * 0.92, 0.002), paper);
	leaf.position.set(PAGE_WIDTH / 2, 0, THICK * 0.7);
	turning.add(leaf);
	turning.visible = false;
	parts.push(leaf);
	group.add(turning);
	scene.add(group);
	return { group, turning, parts };
}

/**
 * Reading a book: held open in both hands below its eyes, its head bowed over it, a page turning now and then, sitting
 * or standing. It reads until {@link READ_SECONDS} are up or it walks off. Asleep, it does not read.
 */
export class Reading extends Component {
	// After `Seated` sits it down, before `CharacterPose` turns the head.
	public static override order = Order.present - 1.2;
	public static override saved = ['defID', 'until'];

	/** The item def of the book it reads; '' with none. */
	public defID = '';
	public until = 0;
	private _weight = 0;
	private _book:OpenBook | null = null;
	/** Where the book is, for the eyes to rest on. */
	private readonly _at = new THREE.Vector3();

	public get active():boolean {
		return !!this.defID;
	}

	/** Where its eyes rest, while they do. */
	public get lookingAt():THREE.Vector3 | null {
		return this.active && this._weight > 0.2 ? this._at : null;
	}

	public open(defID:string):void {
		this.defID = defID;
		this.until = Time.time + READ_SECONDS;
	}

	public stop():void {
		this.defID = '';
	}

	public override update():void {
		if (this.active && (Time.time >= this.until || this.gameObject.getComponent(Seated)?.asleep)) {
			this.stop();
		}
	}

	public override onDestroy():void {
		this.dropBook();
	}

	public override lateUpdate(dt:number):void {
		this._weight += ((this.active ? 1 : 0) - this._weight) * Math.min(1, dt * EASE);
		if (!this.active && this._weight < 0.02) {
			this.dropBook();
			return;
		}
		const root = this.gameObject.getComponent(MeshRenderer)?.mesh;
		const head = root && humanBone(root, 'head');
		const scene = this.gameObject.world?.native;
		if (!root || !head || !scene) {
			return;
		}
		root.updateMatrixWorld(true);
		const f = yawToForward(this.gameObject.transform.yaw);
		const ahead = new THREE.Vector3(f.x, 0, f.z);
		const right = new THREE.Vector3(-f.z, 0, f.x);
		const eyes = head.getWorldPosition(new THREE.Vector3());
		this._at.copy(eyes).addScaledVector(ahead, HOLD_AHEAD).addScaledVector(UP, -HOLD_BELOW + Math.sin(Time.time * 0.9) * SWAY);
		const w = this._weight;
		const under = UP.clone().negate();
		reach(root, 'left', this._at.clone().addScaledVector(right, -HAND_APART), w, under);
		reach(root, 'right', this._at.clone().addScaledVector(right, HAND_APART), w, under);
		closeHand(root, 'left', GRIP * w);
		closeHand(root, 'right', GRIP * w);
		const book = this._book ??= openBook(scene, getDef(this.defID || 'almanac').color ?? 0x6b4423);
		book.group.position.copy(this._at);
		book.group.lookAt(eyes);
		book.group.scale.setScalar(Math.max(0.001, w));
		const turn = (Time.time % TURN_EVERY) / TURN_SECONDS;
		book.turning.visible = turn < 1;
		book.turning.rotation.y = -turn * Math.PI;
	}

	private dropBook():void {
		const book = this._book;
		if (!book) {
			return;
		}
		book.group.removeFromParent();
		for (const part of book.parts) {
			part.geometry.dispose();
			(part.material as THREE.Material).dispose();
		}
		this._book = null;
	}
}
