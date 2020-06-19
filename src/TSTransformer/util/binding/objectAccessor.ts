import ts, { getNodeKind } from "byots";
import * as lua from "LuaAST";
import { assert } from "Shared/util/assert";
import { TransformState } from "TSTransformer";
import { transformExpression } from "TSTransformer/nodes/expressions/transformExpression";
import { addOneIfArrayType } from "TSTransformer/util/addOneIfArrayType";

export const objectAccessor = (
	state: TransformState,
	parentId: lua.AnyIdentifier,
	node: ts.Node,
	name: ts.Node = node,
	alias: ts.Node = node,
): lua.Expression => {
	if (ts.isIdentifier(name)) {
		return lua.create(lua.SyntaxKind.PropertyAccessExpression, {
			expression: parentId,
			name: name.text,
		});
	} else if (ts.isComputedPropertyName(name)) {
		return lua.create(lua.SyntaxKind.ComputedIndexExpression, {
			expression: parentId,
			index: addOneIfArrayType(state, state.getType(name), transformExpression(state, name.expression)),
		});
	} else if (ts.isNumericLiteral(name) || ts.isStringLiteral(name)) {
		return lua.create(lua.SyntaxKind.ComputedIndexExpression, {
			expression: parentId,
			index: transformExpression(state, name),
		});
	}
	assert(false, `Unexpected node kind ${getNodeKind(name)}`);
};
