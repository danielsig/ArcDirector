import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

/**
 * Where each type a host can reach from the package's entry is named, by its built declarations: what each export
 * names, and what those name in turn. Private members carry no type there, and a class it does not export cannot be
 * built by a host, so both are passed by.
 */
function reachableNames(entry:string):Map<string, string[]> {
	const program = ts.createProgram([entry], { noEmit: true });
	const checker = program.getTypeChecker();
	const names = new Map<string, string[]>();
	const seen = new Set<ts.Node>();
	const module = checker.getSymbolAtLocation(program.getSourceFile(entry)!)!;
	const exports = checker.getExportsOfModule(module).map((symbol) => (symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol));
	const exported = new Set(exports.flatMap((symbol) => symbol.declarations ?? []));
	const visit = (node:ts.Node):void => {
		if (seen.has(node) || (ts.isConstructorDeclaration(node) && !exported.has(node.parent))) {
			return;
		}
		seen.add(node);
		const name = ts.isTypeReferenceNode(node) ? node.typeName : ts.isExpressionWithTypeArguments(node) ? node.expression : ts.isTypeQueryNode(node) ? node.exprName : undefined;
		if (name) {
			let symbol = checker.getSymbolAtLocation(name);
			if (symbol && symbol.flags & ts.SymbolFlags.Alias) {
				symbol = checker.getAliasedSymbol(symbol);
			}
			if (symbol) {
				const file = node.getSourceFile();
				names.set(symbol.name, [...names.get(symbol.name) ?? [], `${file.fileName.replace(/.*\/dist\//, '')}:${file.getLineAndCharacterOfPosition(node.getStart()).line + 1}`]);
				symbol.declarations?.forEach(visit);
			}
		}
		ts.forEachChild(node, visit);
	};
	exported.forEach(visit);
	return names;
}

describe('public types', () => {
	it('never show a host text by id as its arrays (hosts write NamingText and read display strings and segments()), nor the catalog\x27s inputs (hosts give withKernels, withFunctions and withStringifiers), nor how talk reaches a mind (hosts read withTalk\x27s onHeard)', () => {
		const names = reachableNames(fileURLToPath(new URL('./index.d.ts', import.meta.url)));
		assert.ok(names.has('MemoryRecord') && names.has('ArcResult') && names.has('NamingText'), 'the walk reaches the public types');
		for (const internal of ['TextWithIDs', 'CatalogInputs', 'TalkListener', 'TalkFields']) {
			assert.deepEqual(names.get(internal) ?? [], [], internal);
		}
	});
});
