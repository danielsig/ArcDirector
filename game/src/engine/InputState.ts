function isTypingTarget(target:EventTarget | null):boolean {
	if (!(target instanceof HTMLElement)) {
		return false;
	}
	if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
		return true;
	}
	if (target.isContentEditable) {
		return true;
	}
	return target.closest('input, textarea, [contenteditable="true"]') !== null;
}

export class InputState {
	readonly keys = new Set<string>();
	mouseNdcX = 0;
	mouseNdcY = 0;
	groundHit:{ x:number; z:number } | null = null;
	pointerLocked = false;
	/** Accumulated this frame; consumed in endFrame(). */
	lookDeltaX = 0;
	lookDeltaY = 0;
	wheelDelta = 0;
	justClick = false;
	private readonly justDown = new Set<string>();

	private canvas:HTMLCanvasElement | null = null;

	readonly onKeyDown = (e:KeyboardEvent):void => {
		if (isTypingTarget(e.target)) {
			return;
		}
		if (!e.repeat) {
			this.justDown.add(e.code);
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

	readonly onKeyUp = (e:KeyboardEvent):void => {
		this.keys.delete(e.code);
	};

	readonly onMouseMove = (e:MouseEvent):void => {
		if (this.pointerLocked) {
			this.lookDeltaX += e.movementX;
			this.lookDeltaY += e.movementY;
			return;
		}
		const canvas = this.canvas;
		if (!canvas) {
			return;
		}
		const rect = canvas.getBoundingClientRect();
		const w = rect.width || 1;
		const h = rect.height || 1;
		this.mouseNdcX = ((e.clientX - rect.left) / w) * 2 - 1;
		this.mouseNdcY = -((e.clientY - rect.top) / h) * 2 + 1;
	};

	readonly onWheel = (e:WheelEvent):void => {
		e.preventDefault();
		this.wheelDelta += e.deltaY;
	};

	readonly onMouseDown = (e:MouseEvent):void => {
		if (e.button === 0 && this.pointerLocked) {
			this.justClick = true;
			e.preventDefault();
		}
	};

	readonly onPointerLockChange = ():void => {
		this.pointerLocked = document.pointerLockElement === this.canvas;
		if (!this.pointerLocked) {
			this.lookDeltaX = 0;
			this.lookDeltaY = 0;
		}
	};

	readonly onBlur = ():void => {
		this.keys.clear();
	};

	key(code:string):boolean {
		return this.keys.has(code);
	}

	pressed(code:string):boolean {
		return this.justDown.has(code);
	}

	requestLock():void {
		void this.canvas?.requestPointerLock();
	}

	endFrame():void {
		this.lookDeltaX = 0;
		this.lookDeltaY = 0;
		this.wheelDelta = 0;
		this.justClick = false;
		this.justDown.clear();
	}

	attach(canvas:HTMLCanvasElement):void {
		this.detach();
		this.canvas = canvas;
		window.addEventListener('keydown', this.onKeyDown);
		window.addEventListener('keyup', this.onKeyUp);
		window.addEventListener('mousemove', this.onMouseMove);
		window.addEventListener('mousedown', this.onMouseDown);
		window.addEventListener('blur', this.onBlur);
		document.addEventListener('pointerlockchange', this.onPointerLockChange);
		canvas.addEventListener('wheel', this.onWheel, { passive: false });
	}

	detach():void {
		const canvas = this.canvas;
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
		this.canvas = null;
		this.pointerLocked = false;
		this.keys.clear();
		this.endFrame();
	}
}
