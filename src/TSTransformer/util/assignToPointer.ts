import * as lua from "LuaAST";
import { TransformState } from "TSTransformer/TransformState";
import { Pointer } from "Shared/types";
import ts from "byots";

export function assignToPointer(
	state: TransformState,
	ptr: Pointer<lua.Map | lua.AnyIdentifier>,
	left: lua.Expression,
	right: lua.Expression,
) {
	if (lua.isMap(ptr.value)) {
		lua.list.push(
			ptr.value.fields,
			lua.create(lua.SyntaxKind.MapField, {
				index: left,
				value: right,
			}),
		);
	} else {
		state.prereq(
			lua.create(lua.SyntaxKind.Assignment, {
				left: lua.create(lua.SyntaxKind.ComputedIndexExpression, {
					expression: ptr.value,
					index: left,
				}),
				right: right,
			}),
		);
	}
}
