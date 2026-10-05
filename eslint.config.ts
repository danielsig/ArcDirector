import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import js from '@eslint/js';
import ts from 'typescript-eslint';
import stylistic from '@stylistic/eslint-plugin';

// Defaults skip class fields and method names. Turn those on so `private _foo` is rejected.
const noUnderscoreDangle = ["error", {
	"enforceInClassFields": true,
	"enforceInMethodNames": true,
}] as const;

const commonRules = {
	// JavaScript
	// Core indent fights @stylistic/indent — keep stylistic as source of truth.
	// "indent": ["error", 'tab', {
	// 	"SwitchCase": 1,
	// 	"ignoredNodes": [
	// 		"IfStatement > LogicalExpression",
	// 		"WhileStatement > LogicalExpression",
	// 		"ConditionalExpression",
	// 		"ArrowFunctionExpression",
	// 	]
	// }],
	// Underscores only (ESLint camelcase does not care about `npcID`).
	// Object keys (`brass_key`, API snake_case) are host/JSON, not JS bindings.
	// Allow snake_case *bindings* for chunk files and similar data ids.
	"camelcase": ["warn", {
		"properties": "never",
		"allow": ["^[a-z][a-z0-9]*(_[a-z0-9]+)+$"],
	}],
	// Units (Mb/MB, Ms/MS, …) are not acronyms — do not add them here.
	"no-restricted-syntax": ["error",
		{
			selector: "Identifier[name=/[a-z]Id[A-Z]/], Identifier[name=/[a-z]Id$/]",
			message: "Never Id. Use ID (npcID, readID, findByID).",
		},
		{
			selector: "Identifier[name=/[a-z]Hp[A-Z]/], Identifier[name=/[a-z]Hp$/]",
			message: "Never Hp. Use HP (maxHP, rememberHP).",
		},
		{
			selector: "Identifier[name=/[a-z]Npc[A-Z]/], Identifier[name=/[a-z]Npc$/]",
			message: "Never Npc. Use NPC (spawnNPC, NPCDirector).",
		},
		{
			selector: "Identifier[name=/[a-z]Url[A-Z]/], Identifier[name=/[a-z]Url$/]",
			message: "Never Url. Use URL (fromURL, URLView).",
		},
		{
			selector: "Identifier[name=/[a-z]Utc[A-Z]/], Identifier[name=/[a-z]Utc$/]",
			message: "Never Utc. Use UTC (toUTC, savedUTC).",
		},
		{
			selector: "Identifier[name=/^(created|updated|started|ended|deleted|noted|saved|loaded|modified|accessed|ready|fade|last)At$|[A-Za-z](Tactical|Strategic|Intrusion|Ready|Held|Message|Try|MarketNPC)At$/]",
			message: "Game time fields/variables are named timestamp or *Timestamp. UTC fields/variables end with UTC (savedUTC). Not At.",
		},
		{
			selector: "Identifier[name='Id'], Identifier[name=/^Id[A-Z]/]",
			message: "Never Id. PascalCase: IDMap. camelCase: id, idMap.",
		},
		{
			selector: "Identifier[name='Hp'], Identifier[name=/^Hp[A-Z]/]",
			message: "Never Hp. PascalCase: HPBar. camelCase: hp.",
		},
		{
			selector: "Identifier[name='Npc'], Identifier[name=/^Npc[A-Z]/]",
			message: "Never Npc. PascalCase: NPCDirector. camelCase: npc.",
		},
		{
			selector: "Identifier[name='Url'], Identifier[name=/^Url[A-Z]/]",
			message: "Never Url. PascalCase: URLView. camelCase: url.",
		},
		{
			selector: "Identifier[name='Utc'], Identifier[name=/^Utc[A-Z]/]",
			message: "Never Utc. PascalCase: UTCTime. camelCase: utc.",
		},
		{
			selector: "Identifier[name='ID']",
			message: "Whole name: use id. Suffix stays caps: npcID.",
		},
		{
			selector: "Identifier[name='HP']",
			message: "Whole name: use hp. Suffix stays caps: maxHP.",
		},
		{
			selector: "Identifier[name='NPC']",
			message: "Whole name: use npc. PascalCase stays NPCDirector; suffix stays spawnNPC.",
		},
		{
			selector: "Identifier[name='UTC']",
			message: "Whole name: use utc. Suffix stays UTC (toUTC, savedUTC).",
		},
	],
	"no-underscore-dangle": noUnderscoreDangle,
	"space-before-blocks": ["error", "always"],
	"no-whitespace-before-property": "error",
	"no-unexpected-multiline": "off",
	"func-call-spacing": "off",
	"function-call-argument-newline": ["error", "consistent"],
	"function-paren-newline": "off",
	"no-mixed-spaces-and-tabs": "error",
	"no-trailing-spaces": ["error", { "skipBlankLines": true }],
	"semi": ["error", "always"],
	"no-var": "error",
	"no-unused-vars": "off",
	"linebreak-style": ["error", "unix"],
	"operator-linebreak": "off",
	"keyword-spacing": "off",
	"space-unary-ops": ["error", {
		"words": true,
		"nonwords": false,
		"overrides": { "typeof": false },
	}],
	"arrow-spacing": ["error", { "before": true, "after": true }],
	"key-spacing": ["error", {
		"multiLine": { "beforeColon": false, "afterColon": true, "mode": "minimum" },
		"singleLine": { "beforeColon": false, "afterColon": true, "mode": "strict" },
	}],
	"dot-location": ["error", "property"],
	"no-irregular-whitespace": ["error", {
		"skipStrings": true,
		"skipComments": true,
		"skipRegExps": true,
		"skipTemplates": true,
	}],

	// TypeScript
	"@typescript-eslint/no-unused-vars": "off",
	"@typescript-eslint/no-explicit-any": ["error", { "fixToUnknown": true }],

	// Stylistic
	"@stylistic/brace-style": ["warn", "stroustrup", { "allowSingleLine": true }],
	"@stylistic/indent": ["error", 'tab', {
		"offsetTernaryExpressions": true,
		"SwitchCase": 1,
		"ignoredNodes": [
			"IfStatement > LogicalExpression",
			"WhileStatement > LogicalExpression",
			"ConditionalExpression",
		]
	}],
	"@stylistic/comma-dangle": ["warn", {
		"functions": "only-multiline",
		"arrays": "only-multiline",
		"objects": "only-multiline",
		"imports": "always-multiline",
		"exports": "always-multiline",
		"enums": "always-multiline",
		"generics": "always-multiline",
		"tuples": "always-multiline",
	}],
	"@stylistic/keyword-spacing": ["error", {
		"before": true,
		"after": true,
		"overrides": {
			"function": { "before": true, "after": false },
			"super": { "before": true, "after": false },
			"typeof": { "before": true, "after": false },
			"default": { "before": true, "after": false },
			"this": { "before": true, "after": false },
		}
	}],
	"@stylistic/space-before-function-paren": ["error", {
		"anonymous": "never",
		"named": "never",
		"asyncArrow": "always",
	}],
	"@stylistic/type-annotation-spacing": ["error", {
		"before": false,
		"after": false,
		// Deprecated in @stylistic 5; arrow spacing is covered by "arrow-spacing" above.
		// "overrides": { "arrow": { "before": true, "after": true } }
	}],
} as object;

export default defineConfig(
	globalIgnores(['**/dist/**', '**/dist-ssr/**', '**/coverage/**', '**/node_modules/**']),

	js.configs.recommended,
	...ts.configs.recommended,

	{
		files: ['**/*.ts'],
		languageOptions: {
			parser: ts.parser,
			parserOptions: {
				ecmaFeatures: { jsx: true },
			},
			// Per-tree globals below override this.
			globals: { ...globals.node },
		},
		plugins: {
			'@stylistic': stylistic,
		},
		rules: {
			...commonRules,
		},
	},

	{
		files: ['game/**/*.ts', 'kindling/**/*.ts'],
		languageOptions: {
			globals: { ...globals.browser },
		},
	},

	// Build / art scripts run under Node.
	{
		files: ['**/*.mjs'],
		languageOptions: {
			globals: { ...globals.node },
		},
		rules: {
			"no-underscore-dangle": noUnderscoreDangle,
		},
	},

	{
		files: ['arc-director/**/*.ts', 'eslint.config.ts'],
		languageOptions: {
			globals: { ...globals.node },
		},
	},

	// Vue SFCs are unlinted until eslint-plugin-vue is added in Phase 0 HUD work.
	// {
	// 	files: ['**/*.vue'],
	// 	languageOptions: {
	// 		globals: { ...globals.browser },
	// 	},
	// },
);
