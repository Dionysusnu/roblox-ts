import * as lua from "LuaAST";
import { TransformState } from "TSTransformer";
import { transformExpression } from "TSTransformer/nodes/expressions/transformExpression";
import { convertToIndexableExpression } from "TSTransformer/util/convertToIndexableExpression";
import { ensureTransformOrder } from "TSTransformer/util/ensureTransformOrder";
import ts from "byots";

function getFirstConstructSymbol(state: TransformState, node: ts.NewExpression) {
	const type = state.getType(node.expression);
	for (const declaration of type.symbol.declarations) {
		if (ts.isInterfaceDeclaration(declaration)) {
			for (const member of declaration.members) {
				if (ts.isConstructSignatureDeclaration(member)) {
					return member.symbol;
				}
			}
		}
	}
}

export function transformNewExpression(state: TransformState, node: ts.NewExpression) {
	const symbol = getFirstConstructSymbol(state, node);
	if (symbol) {
		const macro = state.macroManager.getConstructorMacro(symbol);
		if (macro) {
			return macro(state, node);
		}
	}

	const expression = convertToIndexableExpression(transformExpression(state, node.expression));
	const args = node.arguments
		? lua.list.make(...ensureTransformOrder(state, node.arguments))
		: lua.list.make<lua.Expression>();
	return lua.create(lua.SyntaxKind.CallExpression, {
		expression: lua.create(lua.SyntaxKind.PropertyAccessExpression, {
			expression,
			name: "new",
		}),
		args,
	});
}
