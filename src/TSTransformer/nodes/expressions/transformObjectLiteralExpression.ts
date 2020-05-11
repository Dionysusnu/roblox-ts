import ts from "byots";
import * as lua from "LuaAST";
import { Pointer } from "Shared/types";
import { assert } from "Shared/util/assert";
import { diagnostics } from "TSTransformer/diagnostics";
import { transformExpression } from "TSTransformer/nodes/expressions/transformExpression";
import { TransformState } from "TSTransformer/TransformState";
import { transformMethodDeclaration } from "TSTransformer/nodes/statements/transformMethodDeclaration";
import { assignToPointer } from "TSTransformer/util/assignToPointer";

function disableInline(
	state: TransformState,
	ptr: Pointer<lua.Map | lua.TemporaryIdentifier>,
): asserts ptr is Pointer<lua.TemporaryIdentifier> {
	if (lua.isMap(ptr.value)) {
		ptr.value = state.pushToVar(ptr.value);
	}
}

function transformPropertyAssignment(
	state: TransformState,
	ptr: Pointer<lua.Map | lua.TemporaryIdentifier>,
	name: ts.Identifier | ts.StringLiteral | ts.NumericLiteral | ts.ComputedPropertyName,
	initializer: ts.Expression,
) {
	let left: lua.Expression;
	let leftPrereqs: lua.List<lua.Statement>;
	if (ts.isIdentifier(name)) {
		left = lua.string(name.text);
		leftPrereqs = lua.list.make();
	} else {
		// order here is fragile, ComputedPropertyName -> Identifier should NOT be string key
		// we must do this check here instead of before
		({ expression: left, statements: leftPrereqs } = state.capturePrereqs(() =>
			transformExpression(state, ts.isComputedPropertyName(name) ? name.expression : name),
		));
	}

	const { expression: right, statements: rightPrereqs } = state.capturePrereqs(() =>
		transformExpression(state, initializer),
	);

	if (!lua.list.isEmpty(leftPrereqs) || !lua.list.isEmpty(rightPrereqs)) {
		disableInline(state, ptr);
	}

	state.prereqList(leftPrereqs);
	state.prereqList(rightPrereqs);
	assignToPointer(state, ptr, left, right);
}

function transformSpreadAssignment(
	state: TransformState,
	ptr: Pointer<lua.Map | lua.TemporaryIdentifier>,
	property: ts.SpreadAssignment,
) {
	disableInline(state, ptr);
	const spreadExp = transformExpression(state, property.expression);
	const keyId = lua.tempId();
	const valueId = lua.tempId();
	state.prereq(
		lua.create(lua.SyntaxKind.ForStatement, {
			ids: lua.list.make(keyId, valueId),
			expression: lua.create(lua.SyntaxKind.CallExpression, {
				expression: lua.globals.pairs,
				args: lua.list.make(spreadExp),
			}),
			statements: lua.list.make(
				lua.create(lua.SyntaxKind.Assignment, {
					left: lua.create(lua.SyntaxKind.ComputedIndexExpression, {
						expression: ptr.value,
						index: keyId,
					}),
					right: valueId,
				}),
			),
		}),
	);
}

export function transformObjectLiteralExpression(state: TransformState, node: ts.ObjectLiteralExpression) {
	// starts as lua.Map, becomes lua.TemporaryIdentifier when `disableInline` is called
	const ptr: Pointer<lua.Map | lua.TemporaryIdentifier> = { value: lua.map() };
	for (const property of node.properties) {
		if (ts.isPropertyAssignment(property)) {
			if (ts.isPrivateIdentifier(property.name)) {
				state.addDiagnostic(diagnostics.noPrivateIdentifier(property.name));
				continue;
			}
			transformPropertyAssignment(state, ptr, property.name, property.initializer);
		} else if (ts.isShorthandPropertyAssignment(property)) {
			transformPropertyAssignment(state, ptr, property.name, property.name);
		} else if (ts.isSpreadAssignment(property)) {
			transformSpreadAssignment(state, ptr, property);
		} else if (ts.isMethodDeclaration(property)) {
			transformMethodDeclaration(state, property, ptr);
		} else {
			// must be ts.AccessorDeclaration, which is banned
			state.addDiagnostic(diagnostics.noGetterSetter(property));
		}
	}
	return ptr.value;
}
