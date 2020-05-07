import ts from "byots";
import * as lua from "LuaAST";
import { assert } from "Shared/util/assert";
import { TransformState } from "TSTransformer";
import { transformArrayBindingPattern } from "TSTransformer/nodes/binding/transformArrayBindingPattern";
import { transformObjectBindingPattern } from "TSTransformer/nodes/binding/transformObjectBindingPattern";
import { transformExpression } from "TSTransformer/nodes/expressions/transformExpression";
import { transformIdentifierDefined } from "TSTransformer/nodes/expressions/transformIdentifier";

export function transformVariable(state: TransformState, identifier: ts.Identifier, right?: lua.Expression) {
	return state.capturePrereqs(() => {
		const symbol = state.typeChecker.getSymbolAtLocation(identifier);
		assert(symbol);
		const left = transformIdentifierDefined(state, identifier);
		if (state.isHoisted.get(symbol) === true) {
			// no need to do `x = nil` if the variable is already created
			if (right) {
				state.prereq(lua.create(lua.SyntaxKind.Assignment, { left, right }));
			}
		} else {
			state.prereq(lua.create(lua.SyntaxKind.VariableDeclaration, { left, right }));
		}
		return left;
	});
}

function transformVariableDeclaration(state: TransformState, node: ts.VariableDeclaration): lua.List<lua.Statement> {
	// must transform right _before_ checking isHoisted, that way references inside of value can be hoisted
	const value = node.initializer ? transformExpression(state, node.initializer) : undefined;

	if (ts.isIdentifier(node.name)) {
		return transformVariable(state, node.name, value).statements;
	} else {
		// in destructuring, rhs must be executed first
		if (ts.isArrayBindingPattern(node.name)) {
			const name = node.name;
			assert(value);
			const id = state.pushToVar(value);
			return state.statement(() => transformArrayBindingPattern(state, name, id));
		} else {
			const name = node.name;
			assert(value);
			const id = state.pushToVar(value);
			return state.statement(() => transformObjectBindingPattern(state, name, id));
		}
	}
}

export function transformVariableStatement(state: TransformState, node: ts.VariableStatement): lua.List<lua.Statement> {
	const statements = lua.list.make<lua.Statement>();
	for (const declaration of node.declarationList.declarations) {
		lua.list.pushList(statements, transformVariableDeclaration(state, declaration));
	}
	return statements;
}
