import ts from "byots";
import * as lua from "LuaAST";
import { TransformState } from "TSTransformer";
import { diagnostics } from "TSTransformer/diagnostics";
import { transformArrayBindingLiteral } from "TSTransformer/nodes/binding/transformArrayBindingLiteral";
import { transformObjectBindingLiteral } from "TSTransformer/nodes/binding/transformObjectBindingLiteral";
import { transformExpression } from "TSTransformer/nodes/expressions/transformExpression";
import { transformLogical } from "TSTransformer/nodes/transformLogical";
import {
	transformWritableAssignmentWithType,
	transformWritableExpression,
} from "TSTransformer/nodes/transformWritable";
import { createAssignmentExpression, createCompoundAssignmentExpression } from "TSTransformer/util/assignment";
import { createBinaryFromOperator } from "TSTransformer/util/createBinaryFromOperator";
import { ensureTransformOrder } from "TSTransformer/util/ensureTransformOrder";
import { isLuaTupleType } from "TSTransformer/util/types";
import { name } from "chalk";
import { transformIdentifierDefined } from "TSTransformer/nodes/expressions/transformIdentifier";
import { transformInitializer } from "TSTransformer/nodes/transformInitializer";
import { transformArrayBindingPattern } from "TSTransformer/nodes/binding/transformArrayBindingPattern";
import { transformObjectBindingPattern } from "TSTransformer/nodes/binding/transformObjectBindingPattern";
import { skipDownwards, skipUpwards } from "TSTransformer/util/nodeTraversal";
import { assert } from "Shared/util/assert";
import { getSubType } from "TSTransformer/util/binding/getSubType";

function transformLuaTupleDestructure(
	state: TransformState,
	bindingLiteral: ts.ArrayLiteralExpression,
	value: lua.Expression,
	accessType: ts.Type,
) {
	let index = 0;
	const writes = lua.list.make<lua.WritableExpression>();
	const statements = state.statement(() => {
		for (let element of bindingLiteral.elements) {
			if (ts.isOmittedExpression(element)) {
				lua.list.push(writes, lua.emptyId());
			} else if (ts.isSpreadElement(element)) {
				state.addDiagnostic(diagnostics.noDotDotDotDestructuring(element));
			} else {
				let initializer: ts.Expression | undefined;
				if (ts.isBinaryExpression(element)) {
					initializer = skipDownwards(element.right);
					element = skipDownwards(element.left);
				}

				if (
					ts.isIdentifier(element) ||
					ts.isElementAccessExpression(element) ||
					ts.isPropertyAccessExpression(element)
				) {
					const id = transformWritableExpression(state, element);
					lua.list.push(writes, id);
					if (initializer) {
						state.prereq(transformInitializer(state, id, initializer));
					}
				} else if (ts.isArrayLiteralExpression(element)) {
					const id = lua.tempId();
					lua.list.push(writes, id);
					if (initializer) {
						state.prereq(transformInitializer(state, id, initializer));
					}
					transformArrayBindingLiteral(state, element, id, getSubType(state, accessType, index));
				} else if (ts.isObjectLiteralExpression(element)) {
					const id = lua.tempId();
					lua.list.push(writes, id);
					if (initializer) {
						state.prereq(transformInitializer(state, id, initializer));
					}
					transformObjectBindingLiteral(state, element, id, getSubType(state, accessType, index));
				} else {
					assert(false);
				}
			}
			index++;
		}
	});
	state.prereq(
		lua.create(lua.SyntaxKind.Assignment, {
			left: writes,
			right: value,
		}),
	);
	state.prereqList(statements);
}

export function transformBinaryExpression(state: TransformState, node: ts.BinaryExpression) {
	const operatorKind = node.operatorToken.kind;

	// banned
	if (operatorKind === ts.SyntaxKind.EqualsEqualsToken) {
		state.addDiagnostic(diagnostics.noEqualsEquals(node));
		return lua.emptyId();
	} else if (operatorKind === ts.SyntaxKind.ExclamationEqualsToken) {
		state.addDiagnostic(diagnostics.noExclamationEquals(node));
		return lua.emptyId();
	}

	// logical
	if (
		operatorKind === ts.SyntaxKind.AmpersandAmpersandToken ||
		operatorKind === ts.SyntaxKind.BarBarToken ||
		operatorKind === ts.SyntaxKind.QuestionQuestionToken
	) {
		return transformLogical(state, node);
	}

	if (ts.isAssignmentOperator(operatorKind)) {
		// in destructuring, rhs must be executed first
		if (ts.isArrayLiteralExpression(node.left)) {
			const rightExp = transformExpression(state, node.right);
			const accessType = state.getType(node.right);

			if (lua.isCall(rightExp) && isLuaTupleType(state, accessType)) {
				transformLuaTupleDestructure(state, node.left, rightExp, accessType);
				if (!ts.isExpressionStatement(skipUpwards(node).parent)) {
					state.addDiagnostic(diagnostics.noDestructureAssignmentExpression(node));
				}
				return lua.emptyId();
			}

			const parentId = state.pushToVar(rightExp);
			transformArrayBindingLiteral(state, node.left, parentId, accessType);
			return parentId;
		} else if (ts.isObjectLiteralExpression(node.left)) {
			const parentId = state.pushToVar(transformExpression(state, node.right));
			const accessType = state.getType(node.right);
			transformObjectBindingLiteral(state, node.left, parentId, accessType);
			return parentId;
		}

		const { writable, readable, value } = transformWritableAssignmentWithType(state, node.left, node.right);
		if (ts.isCompoundAssignment(operatorKind)) {
			return createCompoundAssignmentExpression(state, writable, readable, operatorKind, value);
		} else {
			return createAssignmentExpression(state, writable.node, value.node);
		}
	}

	const [left, right] = ensureTransformOrder(state, [node.left, node.right]);

	return createBinaryFromOperator(
		{
			node: left,
			type: state.getSimpleTypeFromNode(node.left),
		},
		operatorKind,
		{
			node: right,
			type: state.getSimpleTypeFromNode(node.right),
		},
	);
}
