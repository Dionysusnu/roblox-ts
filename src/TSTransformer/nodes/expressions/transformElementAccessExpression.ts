import ts from "byots";
import * as lua from "LuaAST";
import { diagnostics } from "TSTransformer/diagnostics";
import { transformExpression } from "TSTransformer/nodes/expressions/transformExpression";
import { transformOptionalChain } from "TSTransformer/nodes/transformOptionalChain";
import { TransformState } from "TSTransformer/TransformState";
import { convertToIndexableExpression } from "TSTransformer/util/convertToIndexableExpression";
import { isMethod } from "TSTransformer/util/isMethod";
import { isArrayType } from "TSTransformer/util/types";

// hack for now until we can detect arrays
export function addOneIfArrayType(state: TransformState, type: ts.Type, expression: lua.Expression) {
	if (isArrayType(state, type)) {
		if (lua.isNumberLiteral(expression)) {
			return lua.create(lua.SyntaxKind.NumberLiteral, {
				value: expression.value + 1,
			});
		} else {
			return lua.create(lua.SyntaxKind.BinaryExpression, {
				left: expression,
				operator: "+",
				right: lua.number(1),
			});
		}
	} else {
		return expression;
	}
}

export function transformElementAccessExpressionInner(
	state: TransformState,
	node: ts.ElementAccessExpression,
	expression: lua.Expression,
	argumentExpression: ts.Expression,
) {
	if (isMethod(state, node)) {
		state.addDiagnostic(diagnostics.noIndexWithoutCall(node));
		return lua.emptyId();
	}

	const { expression: index, statements } = state.capturePrereqs(() =>
		transformExpression(state, argumentExpression),
	);

	if (!lua.list.isEmpty(statements)) {
		expression = state.pushToVar(expression);
		state.prereqList(statements);
	}

	return lua.create(lua.SyntaxKind.ComputedIndexExpression, {
		expression: convertToIndexableExpression(expression),
		index: addOneIfArrayType(state, state.getType(node.expression), index),
	});
}

export function transformElementAccessExpression(state: TransformState, node: ts.ElementAccessExpression) {
	return transformOptionalChain(state, node);
}
