import * as lua from "LuaAST";
import { render, RenderState } from "LuaRenderer";

export function renderReturnStatement(state: RenderState, node: lua.ReturnStatement) {
	return state.indent + `return ${render(state, node.expression)}\n`;
}
