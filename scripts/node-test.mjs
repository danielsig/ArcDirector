// `node ../scripts/node-test.mjs` from a package, after its tsc build.
// Runs dist/**/*.test.js for each src/**/*.test.ts, so a compiled test whose source is gone never runs,
// and a source whose output is missing fails instead of being skipped (`node --test` skips a missing file).
// Spawns `node --test` rather than calling `run()` from `node:test`: run() took arc-director's suite 0.4 s longer.
import { spawnSync } from 'node:child_process';
import { existsSync, globSync } from 'node:fs';
import { join } from 'node:path';

const files = globSync('**/*.test.ts', { cwd: 'src' }).map((file) => join('dist', file.replace(/\.ts$/, '.js')));
const missing = files.filter((file) => !existsSync(file));
if (missing.length > 0) {
	console.error(`No build output for ${missing.join(', ')}`);
	process.exit(1);
}
process.exitCode = spawnSync(process.execPath, ['--test', '--test-reporter', 'spec', ...files], { stdio: 'inherit' }).status ?? 1;
