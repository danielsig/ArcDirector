// Fails when a source file or folder breaks the naming rule (AGENTS.md, "File names"), or when two source files share a name.
// A file stem (the name before `.test` and the extension) is PascalCase or kebab-case; source folders are kebab-case.
// Two names are the same when they match ignoring case and `-` (`npc-input.ts`, `NPCInput.ts`). `index.ts`, `index.html` and config files are exempt.
// Whether a PascalCase file really holds one class is a review rule, not checked here.
import { execSync } from 'node:child_process';

const PASCAL = /^[A-Z][A-Za-z0-9]*$/;
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SKIP = /^(brainstorming|training)\/|(^|\/)(node_modules|dist)\//;
const CONFIG = /\.config\.[cm]?[jt]s$|\.d\.ts$/;

const listed = execSync('git ls-files --cached --others --exclude-standard -- "*.ts" "*.tsx" "*.vue" "*.mjs" "*.js" "*.html"', { encoding: 'utf8' });
const files = listed.split('\n').filter((file) => file && !SKIP.test(file));
const problems = [];
const folders = new Set();
const byName = new Map();
for (const file of files) {
	const parts = file.split('/');
	const name = parts.pop();
	parts.forEach((_, i) => folders.add(parts.slice(0, i + 1).join('/')));
	if (name === 'index.ts' || name === 'index.html' || CONFIG.test(name)) {
		continue;
	}
	const stem = name.replace(/(\.test)?\.[a-z]+$/, '');
	if (!PASCAL.test(stem) && !KEBAB.test(stem)) {
		problems.push(`Not PascalCase or kebab-case: ${file}`);
	}
	const key = name.toLowerCase().replaceAll('-', '');
	byName.set(key, [...(byName.get(key) ?? []), file]);
}
for (const folder of folders) {
	const name = folder.split('/').pop();
	if (!KEBAB.test(name) && !name.startsWith('.')) {
		problems.push(`Folder not kebab-case: ${folder}`);
	}
}
for (const shared of byName.values()) {
	if (shared.length > 1) {
		problems.push(`Same file name: ${shared.join(', ')}`);
	}
}
for (const problem of problems) {
	console.error(problem);
}
process.exitCode = problems.length > 0 ? 1 : 0;
