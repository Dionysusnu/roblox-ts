import * as lua from "LuaAST";
import { RenderState } from "LuaRenderer";
import { renderStatements } from "LuaRenderer/util/renderStatements";

export function renderDoStatement(state: RenderState, node: lua.DoStatement) {
	let result = "";
	result += state.indent + "do\n";
	result += state.scope(() => renderStatements(state, node.statements));
	result += state.indent + "end\n";
	return result;
}
