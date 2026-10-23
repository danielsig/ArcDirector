import type { ModelDownload } from './download.js';

/** Where `ArcDirector.withLoadingBar` shows its bars. */
export type LoadingBarOptions = {
	/** An element of the page to put each bar in. Default: a small panel in the page's bottom-left corner. */
	parent?:unknown;
};

/** The few parts of the page's DOM a bar uses: the library runs outside browsers too, without the DOM's types. */
type PageNode = {
	textContent:string | null;
	type?:string;
	onclick?:(()=>void) | null;
	style:{ cssText:string };
	append(...nodes:PageNode[]):void;
	remove():void;
	childElementCount?:number;
	value?:number;
	max?:number;
};
type Page = { body:PageNode; createElement(tag:string):PageNode };

/** Downloads with a bar already: models that share a download (a chat model and its quick twin) show one. */
const shown = new WeakSet<ModelDownload>();
/** The default panel the bars stack in, while any bar is in it. */
let panel:PageNode | undefined;

/** A browser model's URL as a name to show: its file, without the split part's number and the extension. */
function modelName(model:string):string {
	return (model.split('/').pop() ?? model).replace(/-\d{5}-of-\d{5}\.gguf$|\.gguf$/i, '');
}

/**
 * A plain loading bar for `download` in the page: the model's name, a `<progress>`, and what it is doing
 * ("Downloading 1.2 of 4.6 GB", then "Loading on the GPU"), and a Cancel button. Gone once the model is loaded or
 * cancelled; on a failure it stays, with the reason. Nothing outside a browser.
 */
export function showLoadingBar(download:ModelDownload, model:string, opts:LoadingBarOptions = {}):void {
	const page = (globalThis as { document?:Page }).document;
	if (!page || shown.has(download)) {
		return;
	}
	shown.add(download);
	const parent = (opts.parent as PageNode | undefined) ?? defaultPanel(page);
	const box = page.createElement('div');
	box.style.cssText = 'margin:6px 0;';
	const name = page.createElement('div');
	name.textContent = modelName(model);
	name.style.cssText = 'font-weight:bold;';
	const bar = page.createElement('progress');
	bar.max = 1;
	bar.value = 0;
	bar.style.cssText = 'width:100%;';
	const label = page.createElement('div');
	const cancel = page.createElement('button');
	cancel.type = 'button';
	cancel.textContent = 'Cancel';
	cancel.style.cssText = 'float:right;margin-top:2px;padding:2px 10px;font:inherit;color:inherit;background:transparent;border:1px solid currentColor;border-radius:4px;cursor:pointer;';
	cancel.onclick = () => download.cancel();
	label.style.cssText = 'min-height:1.4em;';
	box.append(name, bar, cancel, label);
	parent.append(box);
	const done = ():void => {
		box.remove();
		if (panel && panel === parent && !panel.childElementCount) {
			panel.remove();
			panel = undefined;
		}
	};
	download.subscribe({
		next: ({ progress, text }) => {
			bar.value = progress;
			label.textContent = text;
		},
		complete: done,
		error: (err) => {
			if (download.cancelled) {
				done();
				return;
			}
			bar.remove();
			cancel.remove();
			label.textContent = `Could not load it: ${err instanceof Error ? err.message : String(err)}`;
		},
	});
}

function defaultPanel(page:Page):PageNode {
	if (!panel) {
		panel = page.createElement('div');
		panel.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:2147483647;width:min(320px,calc(100vw - 32px));padding:10px 14px;'
			+ 'font:13px/1.4 system-ui,sans-serif;color:#fff;background:rgba(0,0,0,0.75);border-radius:8px;';
		page.body.append(panel);
	}
	return panel;
}
