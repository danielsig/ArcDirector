function isTypingTarget(target:EventTarget | null):boolean {
	if (!(target instanceof HTMLElement)) {
		return false;
	}
	if (
		target instanceof HTMLInputElement
		|| target instanceof HTMLTextAreaElement
		|| target instanceof HTMLSelectElement
	) {
		return true;
	}
	if (target.isContentEditable) {
		return true;
	}
	return target.closest('input, textarea, select, [contenteditable="true"]') !== null;
}

/** The key name of the left mouse button, for {@link Input.key} and {@link Input.pressed}. */
export const MOUSE_LEFT = 'MouseLeft';
/** The key name of a quick tap of a finger on the canvas, for {@link Input.pressed}. It moves the mouse to where it landed. */
export const TOUCH_TAP = 'TouchTap';

/** A finger that travels further than this (px) or stays down longer (ms) is no tap. */
const TAP_SLOP = 10;
const TAP_MS = 350;

type Finger = { x:number; y:number; travel:number; downAt:number };

/**
 * Keyboard, mouse, fingers and pointer lock for the game's canvas, on `world.input`. `Game` attaches it to its
 * canvas, clears the per-frame fields after every frame, and detaches it on `dispose`. Keys typed into a text
 * field never reach it. Keys are `KeyboardEvent.code` (`KeyW`, `Space`, `Digit1`), plus {@link MOUSE_LEFT} for
 * the left button on the locked canvas and {@link TOUCH_TAP} for a finger's tap.
 */
export class Input {
	/** Keys held now. */
	public readonly keys = new Set<string>();
	/** Mouse over the canvas in normalized device coordinates (-1..1, +Y up). Frozen while the pointer is locked. */
	public mouseNdcX = 0;
	public mouseNdcY = 0;
	public pointerLocked = false;
	/** Fingers are the way to play: no mouse or trackpad is attached. With one attached, fingers do nothing of their own, touch screen or not. */
	public touch = false;
	/** Mouse movement while the pointer is locked, or fingers dragging on the canvas (two: their middle), this frame. */
	public lookDeltaX = 0;
	public lookDeltaY = 0;
	/** Wheel over the canvas, this frame. */
	public wheelDelta = 0;
	/** How much further apart two fingers on the canvas went this frame, as a ratio. */
	public pinch = 1;
	/** How far two fingers on the canvas turned this frame, in radians, clockwise on screen. */
	public twist = 0;
	/** An on-screen stick the host draws: -1..1, +Y up. It stays where it is put. */
	public stickX = 0;
	public stickY = 0;
	/** Keys whose browser default (page scroll, focus moves, Quick Find) is suppressed. */
	public captures:(code:string)=>boolean = () => false;
	private readonly _justDown = new Set<string>();
	private readonly _fingers = new Map<number, Finger>();
	/** Whether a mouse or trackpad is attached; it follows them coming and going. */
	private _mouse:MediaQueryList | null = null;
	private _canvas:HTMLCanvasElement | null = null;

	/** Held now. */
	public key(code:string):boolean {
		return this.keys.has(code);
	}

	/** Went down this frame. */
	public pressed(code:string):boolean {
		return this._justDown.has(code);
	}

	/** Presses `code` for this frame, as an on-screen button does. */
	public press(code:string):void {
		this._justDown.add(code);
	}

	/** Locks the pointer. Fingers have nothing to lock. */
	public requestLock():void {
		if (!this.touch) {
			void this._canvas?.requestPointerLock();
		}
	}

	/** Clears this frame's deltas and presses. */
	public endFrame():void {
		this.lookDeltaX = 0;
		this.lookDeltaY = 0;
		this.wheelDelta = 0;
		this.pinch = 1;
		this.twist = 0;
		this._justDown.clear();
	}

	public attach(canvas:HTMLCanvasElement):void {
		this.detach();
		this._canvas = canvas;
		this._mouse = window.matchMedia?.('(any-pointer: fine)') ?? null;
		this._mouse?.addEventListener('change', this._syncTouch);
		this._syncTouch();
		canvas.style.touchAction = 'none';
		canvas.addEventListener('pointerdown', this._onPointerDown);
		canvas.addEventListener('pointermove', this._onPointerMove);
		canvas.addEventListener('pointerup', this._onPointerUp);
		canvas.addEventListener('pointercancel', this._onPointerCancel);
		window.addEventListener('keydown', this._onKeyDown);
		window.addEventListener('keyup', this._onKeyUp);
		window.addEventListener('mousemove', this._onMouseMove);
		window.addEventListener('mousedown', this._onMouseDown);
		window.addEventListener('mouseup', this._onMouseUp);
		window.addEventListener('blur', this._onBlur);
		document.addEventListener('pointerlockchange', this._onPointerLockChange);
		canvas.addEventListener('wheel', this._onWheel, { passive: false });
	}

	public detach():void {
		const canvas = this._canvas;
		if (!canvas) {
			return;
		}
		this._mouse?.removeEventListener('change', this._syncTouch);
		this._mouse = null;
		canvas.removeEventListener('pointerdown', this._onPointerDown);
		canvas.removeEventListener('pointermove', this._onPointerMove);
		canvas.removeEventListener('pointerup', this._onPointerUp);
		canvas.removeEventListener('pointercancel', this._onPointerCancel);
		window.removeEventListener('keydown', this._onKeyDown);
		window.removeEventListener('keyup', this._onKeyUp);
		window.removeEventListener('mousemove', this._onMouseMove);
		window.removeEventListener('mousedown', this._onMouseDown);
		window.removeEventListener('mouseup', this._onMouseUp);
		window.removeEventListener('blur', this._onBlur);
		document.removeEventListener('pointerlockchange', this._onPointerLockChange);
		canvas.removeEventListener('wheel', this._onWheel);
		if (document.pointerLockElement === canvas) {
			document.exitPointerLock();
		}
		this._canvas = null;
		this.pointerLocked = false;
		this.keys.clear();
		this._fingers.clear();
		this.stickX = 0;
		this.stickY = 0;
		this.endFrame();
	}

	private readonly _onKeyDown = (e:KeyboardEvent):void => {
		if (isTypingTarget(e.target)) {
			return;
		}
		if (!e.repeat) {
			this._justDown.add(e.code);
		}
		this.keys.add(e.code);
		if (this.captures(e.code)) {
			e.preventDefault();
		}
	};

	private readonly _onKeyUp = (e:KeyboardEvent):void => {
		this.keys.delete(e.code);
	};

	private readonly _onMouseMove = (e:MouseEvent):void => {
		if (this.pointerLocked) {
			this.lookDeltaX += e.movementX;
			this.lookDeltaY += e.movementY;
			return;
		}
		this.moveMouse(e.clientX, e.clientY);
	};

	private moveMouse(clientX:number, clientY:number):void {
		const canvas = this._canvas;
		if (!canvas) {
			return;
		}
		const rect = canvas.getBoundingClientRect();
		const w = rect.width || 1;
		const h = rect.height || 1;
		this.mouseNdcX = ((clientX - rect.left) / w) * 2 - 1;
		this.mouseNdcY = -((clientY - rect.top) / h) * 2 + 1;
	}

	private readonly _syncTouch = ():void => {
		this.touch = this._mouse ? !this._mouse.matches : false;
		this._fingers.clear();
	};

	private readonly _onPointerDown = (e:PointerEvent):void => {
		if (!this.touch || e.pointerType !== 'touch') {
			return;
		}
		// A second finger makes it a gesture: neither is a tap any more.
		const alone = this._fingers.size === 0;
		for (const finger of this._fingers.values()) {
			finger.travel = Infinity;
		}
		this._fingers.set(e.pointerId, { x: e.clientX, y: e.clientY, travel: alone ? 0 : Infinity, downAt: e.timeStamp });
	};

	private readonly _onPointerMove = (e:PointerEvent):void => {
		const finger = this._fingers.get(e.pointerId);
		if (!finger) {
			return;
		}
		const dx = e.clientX - finger.x;
		const dy = e.clientY - finger.y;
		const other = [...this._fingers.values()].find((f) => f !== finger);
		if (other) {
			const fromX = finger.x - other.x;
			const fromY = finger.y - other.y;
			const toX = e.clientX - other.x;
			const toY = e.clientY - other.y;
			this.pinch *= Math.hypot(toX, toY) / Math.max(1, Math.hypot(fromX, fromY));
			this.twist += Math.atan2(fromX * toY - fromY * toX, fromX * toX + fromY * toY);
		}
		// With two fingers down, the drag is their middle's: half of what one of them moved.
		const share = other ? 0.5 : 1;
		this.lookDeltaX += dx * share;
		this.lookDeltaY += dy * share;
		finger.x = e.clientX;
		finger.y = e.clientY;
		finger.travel += Math.hypot(dx, dy);
	};

	private readonly _onPointerUp = (e:PointerEvent):void => {
		const finger = this._fingers.get(e.pointerId);
		this._fingers.delete(e.pointerId);
		if (finger && finger.travel < TAP_SLOP && e.timeStamp - finger.downAt < TAP_MS) {
			this.moveMouse(e.clientX, e.clientY);
			this.press(TOUCH_TAP);
		}
	};

	private readonly _onPointerCancel = (e:PointerEvent):void => {
		this._fingers.delete(e.pointerId);
	};

	private readonly _onWheel = (e:WheelEvent):void => {
		e.preventDefault();
		this.wheelDelta += e.deltaY;
	};

	private readonly _onMouseDown = (e:MouseEvent):void => {
		if (e.button !== 0 || !this.pointerLocked || document.activeElement !== this._canvas) {
			return;
		}
		this._justDown.add(MOUSE_LEFT);
		this.keys.add(MOUSE_LEFT);
		e.preventDefault();
	};

	private readonly _onMouseUp = (e:MouseEvent):void => {
		if (e.button === 0) {
			this.keys.delete(MOUSE_LEFT);
		}
	};

	private readonly _onPointerLockChange = ():void => {
		this.pointerLocked = document.pointerLockElement === this._canvas;
		if (!this.pointerLocked) {
			this.lookDeltaX = 0;
			this.lookDeltaY = 0;
		}
	};

	private readonly _onBlur = ():void => {
		this.keys.clear();
		this._fingers.clear();
	};
}
