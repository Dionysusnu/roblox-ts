import ts from "byots";
import { TransformState } from "TSTransformer/TransformState";
import { transformClassLikeDeclaration } from "TSTransformer/nodes/transformClassLikeDeclaration";

export function transformClassDeclaration(state: TransformState, node: ts.ClassDeclaration) {
	return transformClassLikeDeclaration(state, node).statements;
}
