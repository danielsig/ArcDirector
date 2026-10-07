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

export class InputState {
	public readonly keys = new Set<string>();
	public mouseNdcX = 0;
	public mouseNdcY = 0;
	public groundHit:{ x:number; z:number } | null = null;
	public pointerLocked = false;
	/** Accumulated this frame; consumed in endFrame(). */
	public lookDeltaX = 0;
	public lookDeltaY = 0;
	public wheelDelta = 0;
	public justClick = false;
	private readonly _justDown = new Set<string>();

	private _canvas:HTMLCanvasElement | null = null;

	public readonly onKeyDown = (e:KeyboardEvent):void => {
		if (isTypingTarget(e.target)) {
			return;
		}
		if (!e.repeat) {
			this._justDown.add(e.code);
		}
		this.keys.add(e.code);
		if (
			e.code === 'KeyW'
			|| e.code === 'KeyA'
			|| e.code === 'KeyS'
			|| e.code === 'KeyD'
			|| e.code === 'KeyE'
			|| e.code === 'KeyF'
			|| e.code === 'KeyG'
			|| e.code === 'KeyX'
			|| e.code === 'ArrowUp'
			|| e.code === 'ArrowDown'
			|| e.code === 'ArrowLeft'
			|| e.code === 'ArrowRight'
			|| e.code === 'Space'
			|| e.code === 'Tab'
			|| e.code === 'Backquote'
			|| e.code === 'Enter'
			|| e.code === 'NumpadEnter'
			|| e.code === 'Escape'
			|| e.code.startsWith('Digit')
		) {
			e.preventDefault();
		}
	};

	public readonly onKeyUp = (e:KeyboardEvent):void => {
		this.keys.delete(e.code);
	};

	public readonly onMouseMove = (e:MouseEvent):void => {
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

	public readonly onWheel = (e:WheelEvent):void => {
		e.preventDefault();
		this.wheelDelta += e.deltaY;
	};

	public readonly onMouseDown = (e:MouseEvent):void => {
		if (e.button !== 0 || !this.pointerLocked || document.activeElement !== this._canvas) {
			return;
		}
		this.justClick = true;
		e.preventDefault();
	};

	public readonly onPointerLockChange = ():void => {
		this.pointerLocked = document.pointerLockElement === this._canvas;
		if (!this.pointerLocked) {
			this.lookDeltaX = 0;
			this.lookDeltaY = 0;
		}
	};

	public readonly onBlur = ():void => {
		this.keys.clear();
	};

	public key(code:string):boolean {
		return this.keys.has(code);
	}

	public pressed(code:string):boolean {
		return this._justDown.has(code);
	}

	public requestLock():void {
		void this._canvas?.requestPointerLock();
	}

	public endFrame():void {
		this.lookDeltaX = 0;
		this.lookDeltaY = 0;
		this.wheelDelta = 0;
		this.justClick = false;
		this._justDown.clear();
	}

	public attach(canvas:HTMLCanvasElement):void {
		this.detach();
		this._canvas = canvas;
		window.addEventListener('keydown', this.onKeyDown);
		window.addEventListener('keyup', this.onKeyUp);
		window.addEventListener('mousemove', this.onMouseMove);
		window.addEventListener('mousedown', this.onMouseDown);
		window.addEventListener('blur', this.onBlur);
		document.addEventListener('pointerlockchange', this.onPointerLockChange);
		canvas.addEventListener('wheel', this.onWheel, { passive: false });
	}

	public detach():void {
		const canvas = this._canvas;
		window.removeEventListener('keydown', this.onKeyDown);
		window.removeEventListener('keyup', this.onKeyUp);
		window.removeEventListener('mousemove', this.onMouseMove);
		window.removeEventListener('mousedown', this.onMouseDown);
		window.removeEventListener('blur', this.onBlur);
		document.removeEventListener('pointerlockchange', this.onPointerLockChange);
		canvas?.removeEventListener('wheel', this.onWheel);
		if (document.pointerLockElement === canvas) {
			document.exitPointerLock();
		}
		this._canvas = null;
		this.pointerLocked = false;
		this.keys.clear();
		this.endFrame();
	}
}
