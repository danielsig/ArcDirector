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

/**
 * Keyboard, mouse and pointer lock for the game's canvas, on `world.input`. `Game` attaches it to its canvas,
 * clears the per-frame fields after every frame, and detaches it on `dispose`. Keys typed into a text field
 * never reach it. Keys are `KeyboardEvent.code` (`KeyW`, `Space`, `Digit1`), plus {@link MOUSE_LEFT} for the
 * left button on the locked canvas.
 */
export class Input {
	/** Keys held now. */
	public readonly keys = new Set<string>();
	/** Mouse over the canvas in normalized device coordinates (-1..1, +Y up). Frozen while the pointer is locked. */
	public mouseNdcX = 0;
	public mouseNdcY = 0;
	public pointerLocked = false;
	/** Mouse movement while the pointer is locked, this frame. */
	public lookDeltaX = 0;
	public lookDeltaY = 0;
	/** Wheel over the canvas, this frame. */
	public wheelDelta = 0;
	/** Keys whose browser default (page scroll, focus moves, Quick Find) is suppressed. */
	public captures:(code:string)=>boolean = () => false;
	private readonly _justDown = new Set<string>();
	private _canvas:HTMLCanvasElement | null = null;

	/** Held now. */
	public key(code:string):boolean {
		return this.keys.has(code);
	}

	/** Went down this frame. */
	public pressed(code:string):boolean {
		return this._justDown.has(code);
	}

	public requestLock():void {
		void this._canvas?.requestPointerLock();
	}

	/** Clears this frame's deltas and presses. */
	public endFrame():void {
		this.lookDeltaX = 0;
		this.lookDeltaY = 0;
		this.wheelDelta = 0;
		this._justDown.clear();
	}

	public attach(canvas:HTMLCanvasElement):void {
		this.detach();
		this._canvas = canvas;
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
		const canvas = this._canvas;
		if (!canvas) {
			return;
		}
		const rect = canvas.getBoundingClientRect();
		const w = rect.width || 1;
		const h = rect.height || 1;
		this.mouseNdcX = ((e.clientX - rect.left) / w) * 2 - 1;
		this.mouseNdcY = -((e.clientY - rect.top) / h) * 2 + 1;
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
	};
}
