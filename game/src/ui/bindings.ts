import type { SceneKey } from '../data/scenes';

type LayoutKeyboard = {
	getLayoutMap?:()=>Promise<{ get(code:string):string | undefined }>;
};

/**
 * Mark printed on the physical Backquote key (AI log).
 * The layout map reports the unshifted character (` on a US keyboard, ^ on a German one).
 * The other glyph on that key is the one players name: ~ and °.
 */
const BACKQUOTE_MARK:Record<string, string> = {
	'`': '~',
	'^': '°',
};

export function backquoteGlyph(unshifted:string | null | undefined):string {
	if (!unshifted || unshifted === 'Dead') {
		return '~';
	}
	return BACKQUOTE_MARK[unshifted] ?? unshifted;
}

export async function readBackquoteGlyph():Promise<string> {
	const keyboard = (navigator as Navigator & { keyboard?:LayoutKeyboard }).keyboard;
	if (!keyboard?.getLayoutMap) {
		return '~';
	}
	try {
		const layout = await keyboard.getLayoutMap();
		return backquoteGlyph(layout.get('Backquote'));
	}
	catch {
		return '~';
	}
}

/** Keys that work in every scene. The console key's glyph depends on the layout. */
export function universalKeys(consoleKey:string):SceneKey[] {
	return [
		{ key: 'WASD / Arrow Keys', action: 'Move' },
		{ key: 'Enter', action: 'Toggle Prompt' },
		{ key: 'Tab', action: 'Toggle Chat' },
		{ key: consoleKey, action: 'Toggle AI Log' },
		{ key: '1-8', action: 'Select Item' },
		{ key: 'G', action: 'Drop Item' },
		{ key: 'Esc', action: 'Close' },
	];
}
