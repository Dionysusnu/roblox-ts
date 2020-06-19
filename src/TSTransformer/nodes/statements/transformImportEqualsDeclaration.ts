import * as lua from "LuaAST";
import ts from "byots";
import { assert } from "Shared/util/assert";
import { TransformState } from "TSTransformer";
import { transformVariable } from "TSTransformer/nodes/statements/transformVariableStatement";
import { createImportExpression } from "TSTransformer/util/createImportExpression";
import { isSymbolOfValue } from "TSTransformer/util/isSymbolOfValue";

export function transformImportEqualsDeclaration(state: TransformState, node: ts.ImportEqualsDeclaration) {
	if (ts.isExternalModuleReference(node.moduleReference)) {
		assert(
			ts.isStringLiteral(node.moduleReference.expression),
			"node.moduleReference.expression wasn't a string literal",
		);
		const importExp = createImportExpression(state, node.getSourceFile(), node.moduleReference.expression);

		const statements = lua.list.make<lua.Statement>();

		const aliasSymbol = state.typeChecker.getSymbolAtLocation(node.name);
		assert(aliasSymbol, "Could not find symbol for node.name");
		if (isSymbolOfValue(ts.skipAlias(aliasSymbol, state.typeChecker))) {
			lua.list.pushList(statements, transformVariable(state, node.name, importExp).statements);
		}

		// ensure we emit something
		if (
			state.compilerOptions.importsNotUsedAsValues === ts.ImportsNotUsedAsValues.Preserve &&
			lua.list.isEmpty(statements)
		) {
			assert(lua.isCallExpression(importExp), "Import expression wasn't a function call");
			lua.list.push(statements, lua.create(lua.SyntaxKind.CallStatement, { expression: importExp }));
		}

		return statements;
	} else {
		// Identifier | QualifiedName
		assert(false, "Not implemented!");
	}
}
