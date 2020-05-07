import chalk from "chalk";
import { LoggableError } from "Shared/errors/LoggableError";
import { formatDiagnostics } from "Shared/util/formatDiagnostics";
import ts from "byots";

// force colors
chalk.level = chalk.Level.Basic;

export class DiagnosticError extends LoggableError {
	constructor(private diagnostics: Array<ts.Diagnostic>) {
		super();
	}

	public log() {
		console.log(formatDiagnostics(this.diagnostics).replace(/TS roblox\-ts/g, "roblox-ts"));
	}
}
