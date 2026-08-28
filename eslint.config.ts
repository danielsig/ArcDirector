import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import js from '@eslint/js';
import ts from 'typescript-eslint';
import stylistic from '@stylistic/eslint-plugin';

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
	"no-restricted-syntax": ["error",
		{
			selector: "Identifier[name='ID']",
			message: "Leading acronym: use id (suffix stays caps: npcID).",
		},
		{
			selector: "Identifier[name='HP']",
			message: "Leading acronym: use hp (suffix stays caps: maxHP).",
		},
		{
			selector: "Identifier[name='NPC']",
			message: "Leading acronym: use npc (suffix stays caps: npcID).",
		},
		{
			selector: "Identifier[name='Npc']",
			message: "Leading acronym: use npc, not Npc.",
		},
	],
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
