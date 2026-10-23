// Shoots the main menu's pictures of each scene, as its Showcase stands on its first frame:
//  - the backdrop still, where the camera starts circling, to game/public/menu/backdrop/<id>.jpg;
//  - the card, from `CARDS` below, to game/public/menu/<id>.jpg.
// Needs the dev server (`pnpm --filter @arc-director/game dev`) and Kindling built.
//
//   pnpm --filter @arc-director/game backdrops [scene ids…]   (all four menu scenes when none are given)
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ORIGIN = 'http://localhost:5173';
const here = dirname(fileURLToPath(import.meta.url));
const menuDir = join(here, '../public/menu');
const shoot = join(here, '../../kindling/scripts/shoot.mjs');
const sharp = createRequire(join(here, '../../kindling/package.json'))('sharp');

/** Where each card looks from (`ShowcaseView` in `Showcase.ts`). */
const CARDS = {
	ruins: { x: 32, z: 12, yaw: 0, zoom: 10 },
	marketplace: { x: 16, z: 20, yaw: 0 },
	glen: { x: 7.5, z: 12, yaw: Math.PI / 2 },
	dungeon_vault: { x: 8, z: 40, yaw: 0 },
};

/** `STILL_ASPECT` in `Showcase.ts` for backdrops; the `.card img` aspect in `App.vue` for cards, shot at twice the size and halved. */
const SHOTS = [
	{ dir: join(menuDir, 'backdrop'), width: 2560, height: 1440, size: null, pose: () => null },
	{ dir: menuDir, width: 960, height: 600, size: [480, 300], pose: (id) => CARDS[id] },
];

/** Runs in the page: a Showcase over the menu (from `pose` if given, a `ShowcaseView`), held still once ready (the cast idling). */
const capture = (id, pose) => `(async () => {
	const { Showcase } = await import('/src/engine/Showcase.ts');
	const { preloadArt } = await import('/src/render/preloadArt.ts');
	await preloadArt();
	const host = document.createElement('div');
	host.style.cssText = 'position:fixed;inset:0;z-index:99999';
	document.body.appendChild(host);
	const game = new Showcase(${JSON.stringify(id)}, ${JSON.stringify(pose ?? undefined)});
	game.mount(host);
	game.canvas.style.cssText = 'width:100%;height:100%;display:block';
	game.start();
	await game.ready;
	game.paused = true;
	await new Promise((r) => setTimeout(r, 1000));
	return 'shot';
})().catch((e) => String(e.stack ?? e))`;

const ids = process.argv.slice(2);
for (const id of ids.length ? ids : Object.keys(CARDS)) {
	for (const { dir, width, height, size, pose } of SHOTS) {
		mkdirSync(dir, { recursive: true });
		const png = join(dir, `${id}.png`);
		// shoot.mjs prints what the page returned; anything but "shot" is an error there.
		execFileSync('node', [shoot, ORIGIN + '/', png, String(width), String(height)], {
			stdio: 'inherit',
			env: { ...process.env, WAIT: '2', EVAL: capture(id, pose(id)) },
		});
		const image = sharp(png);
		await (size ? image.resize(...size) : image).jpeg({ quality: 82, mozjpeg: true }).toFile(join(dir, `${id}.jpg`));
		rmSync(png);
	}
}
