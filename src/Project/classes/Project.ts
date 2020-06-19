import ts from "byots";
import fs from "fs-extra";
import { renderAST } from "LuaRenderer";
import path from "path";
import { createParseConfigFileHost } from "Project/util/createParseConfigFileHost";
import { createReadBuildProgramHost } from "Project/util/createReadBuildProgramHost";
import { getCustomPreEmitDiagnostics } from "Project/util/getCustomPreEmitDiagnostics";
import { validateCompilerOptions } from "Project/util/validateCompilerOptions";
import { LogService } from "Shared/classes/LogService";
import { PathTranslator } from "Shared/classes/PathTranslator";
import { NetworkType, RbxPath, RojoConfig } from "Shared/classes/RojoConfig";
import { COMPILER_VERSION, PACKAGE_ROOT, ProjectType } from "Shared/constants";
import { DiagnosticError } from "Shared/errors/DiagnosticError";
import { ProjectError } from "Shared/errors/ProjectError";
import { cleanupDirRecursively } from "Shared/fsUtil";
import { assert } from "Shared/util/assert";
import { getOrSetDefault } from "Shared/util/getOrSetDefault";
import {
	GlobalSymbols,
	MacroManager,
	MultiTransformState,
	RoactSymbolManager,
	transformSourceFile,
	TransformState,
} from "TSTransformer";

const DEFAULT_PROJECT_OPTIONS: ProjectOptions = {
	includePath: "",
	rojo: "",
};

const LIB_PATH = path.join(PACKAGE_ROOT, "lib");

/**
 * The options of the project.
 */
export interface ProjectOptions {
	/**
	 * The path to the include directory.
	 */
	includePath: string;

	/**
	 * The path to the rojo configuration.
	 */
	rojo: string;
}

/**
 * Represents a roblox-ts project.
 */
export class Project {
	public readonly projectPath: string;
	public readonly nodeModulesPath: string;

	private readonly program: ts.EmitAndSemanticDiagnosticsBuilderProgram;
	private readonly compilerOptions: ts.CompilerOptions;
	private readonly typeChecker: ts.TypeChecker;
	private readonly projectOptions: ProjectOptions;
	private readonly globalSymbols: GlobalSymbols;
	private readonly macroManager: MacroManager;
	private readonly roactSymbolManager: RoactSymbolManager | undefined;
	private readonly rojoConfig: RojoConfig;
	private readonly pathTranslator: PathTranslator;
	private readonly pkgVersion: string | undefined;
	private readonly runtimeLibRbxPath: RbxPath | undefined;
	private readonly nodeModulesRbxPath: RbxPath | undefined;
	private readonly includePath: string;

	public readonly projectType: ProjectType;

	private readonly nodeModulesPathMapping = new Map<string, string>();

	/**
	 * @param tsConfigPath The path to the TypeScript configuration.
	 * @param opts The options of the project.
	 */
	constructor(tsConfigPath: string, opts: Partial<ProjectOptions>) {
		this.projectOptions = Object.assign({}, DEFAULT_PROJECT_OPTIONS, opts);

		// set up project paths
		this.projectPath = path.dirname(tsConfigPath);

		const pkgJsonPath = ts.findPackageJson(this.projectPath, (ts.sys as unknown) as ts.LanguageServiceHost);
		if (!pkgJsonPath) {
			throw new ProjectError("Unable to find package.json");
		}

		const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath).toString());
		this.pkgVersion = pkgJson.version;

		this.nodeModulesPath = path.join(path.dirname(pkgJsonPath), "node_modules", "@rbxts");

		const rojoConfigPath = RojoConfig.findRojoConfigFilePath(this.projectPath, this.projectOptions.rojo);
		if (rojoConfigPath) {
			this.rojoConfig = RojoConfig.fromPath(rojoConfigPath);
			if (this.rojoConfig.isGame()) {
				this.projectType = ProjectType.Game;
			} else {
				this.projectType = ProjectType.Model;
			}
		} else {
			this.rojoConfig = RojoConfig.synthetic(this.projectPath);
			this.projectType = ProjectType.Package;
		}

		// intentionally use || here for empty string case
		this.includePath = path.resolve(this.projectOptions.includePath || path.join(this.projectPath, "include"));

		// validates and establishes runtime library
		if (this.projectType !== ProjectType.Package) {
			const runtimeFsPath = path.join(this.includePath, "RuntimeLib.lua");
			const runtimeLibRbxPath = this.rojoConfig.getRbxPathFromFilePath(runtimeFsPath);
			if (!runtimeLibRbxPath) {
				throw new ProjectError(
					`A Rojo project file was found ( ${path.relative(
						this.projectPath,
						rojoConfigPath!,
					)} ), but contained no data for include folder!`,
				);
			} else if (this.rojoConfig.getNetworkType(runtimeLibRbxPath) !== NetworkType.Unknown) {
				throw new ProjectError(`Runtime library cannot be in a server-only or client-only container!`);
			} else if (this.rojoConfig.isIsolated(runtimeLibRbxPath)) {
				throw new ProjectError(`Runtime library cannot be in an isolated container!`);
			}
			this.runtimeLibRbxPath = runtimeLibRbxPath;
		}

		if (fs.pathExistsSync(this.nodeModulesPath)) {
			this.nodeModulesRbxPath = this.rojoConfig.getRbxPathFromFilePath(this.nodeModulesPath);

			// map module paths
			for (const pkgName of fs.readdirSync(this.nodeModulesPath)) {
				const pkgPath = path.join(this.nodeModulesPath, pkgName);
				const pkgJsonPath = path.join(pkgPath, "package.json");
				if (fs.existsSync(pkgJsonPath)) {
					const pkgJson = fs.readJSONSync(pkgJsonPath) as { main?: string; typings?: string; types?: string };
					// both "types" and "typings" are valid
					const typesPath = pkgJson.types ?? pkgJson.typings ?? "index.d.ts";
					if (pkgJson.main) {
						this.nodeModulesPathMapping.set(
							path.resolve(pkgPath, typesPath),
							path.resolve(pkgPath, pkgJson.main),
						);
					}
				}
			}
		}

		// obtain TypeScript command line options and validate
		const parsedCommandLine = ts.getParsedCommandLineOfConfigFile(tsConfigPath, {}, createParseConfigFileHost());

		if (parsedCommandLine === undefined) {
			throw new ProjectError("Unable to load TS program!");
		}

		if (parsedCommandLine.errors.length > 0) {
			throw new DiagnosticError(parsedCommandLine.errors);
		}

		this.compilerOptions = parsedCommandLine.options;
		validateCompilerOptions(this.compilerOptions, this.nodeModulesPath);

		const host = ts.createIncrementalCompilerHost(this.compilerOptions);

		let rojoHash = "";
		if (rojoConfigPath) {
			assert(host.createHash, "ts.CompilerHost did not have createHash method");
			rojoHash = "-" + host.createHash(fs.readFileSync(rojoConfigPath).toString());
		}

		// super hack!
		// we set `ts.version` so that new versions of roblox-ts trigger full re-compile for incremental mode
		// rojoHash makes it so that changes to the rojo config will trigger full re-compile

		// eslint-disable-next-line @typescript-eslint/ban-ts-ignore
		// @ts-ignore
		ts.version = COMPILER_VERSION + rojoHash;

		this.program = ts.createEmitAndSemanticDiagnosticsBuilderProgram(
			parsedCommandLine.fileNames,
			this.compilerOptions,
			host,
			ts.readBuilderProgram(this.compilerOptions, createReadBuildProgramHost()),
		);

		this.typeChecker = this.program.getProgram().getDiagnosticsProducingTypeChecker();

		this.globalSymbols = new GlobalSymbols(this.typeChecker);
		this.macroManager = new MacroManager(this.program.getProgram(), this.typeChecker, this.nodeModulesPath);

		const roactIndexSourceFile = this.program.getSourceFile(path.join(this.nodeModulesPath, "roact", "index.d.ts"));
		if (roactIndexSourceFile) {
			this.roactSymbolManager = new RoactSymbolManager(this.typeChecker, roactIndexSourceFile);
		}

		// create `PathTranslator` to ensure paths of input, output, and include paths are relative to project
		this.pathTranslator = new PathTranslator(
			this.program.getProgram().getCommonSourceDirectory(),
			this.compilerOptions.outDir!,
			ts.getTsBuildInfoEmitOutputFilePath(this.compilerOptions),
		);
	}

	/**
	 * cleans up 'orphaned' files - Files which don't belong to any source file
	 * in the out directory.
	 */
	public cleanup() {
		if (fs.pathExistsSync(this.compilerOptions.outDir!)) {
			cleanupDirRecursively(this.pathTranslator);
		}
	}

	/**
	 * generates a `Set<string>` of paths for changed files + dependencies
	 *
	 * if `incremental == false`, this will return all project files
	 *
	 * if `assumeChangesOnlyAffectDirectDependencies == false`, this will only check direct dependencies
	 */
	private getChangedFilesSet() {
		const buildState = this.program.getState();

		// buildState.referencedMap is sourceFile -> files that this file imports
		// but we need sourceFile -> files that import this file
		const reversedReferencedMap = new Map<string, Set<string>>();
		buildState.referencedMap?.forEach((referencedSet, filePath) => {
			referencedSet.forEach((_, refFilePath) => {
				getOrSetDefault(reversedReferencedMap, refFilePath, () => new Set()).add(filePath);
			});
		});

		const changedFilesSet = new Set<string>();

		const search = (filePath: string) => {
			changedFilesSet.add(filePath);
			reversedReferencedMap.get(filePath)?.forEach(refFilePath => {
				if (!changedFilesSet.has(refFilePath)) {
					changedFilesSet.add(refFilePath);
					if (this.compilerOptions.assumeChangesOnlyAffectDirectDependencies !== true) {
						search(refFilePath);
					}
				}
			});
		};

		buildState.changedFilesSet?.forEach((_, fileName) => search(fileName));

		return changedFilesSet;
	}

	public copyInclude() {
		fs.copySync(LIB_PATH, this.includePath);
	}

	public compileAll() {
		this.copyInclude();
		this.compileFiles(this.getChangedFilesSet());
		this.program.getProgram().emitBuildInfo();
	}

	/**
	 * 'transpiles' TypeScript project into a logically identical Lua project.
	 *
	 * writes rendered lua source to the out directory.
	 */
	public compileFiles(filesSet: Set<string>) {
		const multiTransformState = new MultiTransformState();
		const totalDiagnostics = new Array<ts.Diagnostic>();

		const sourceFiles = new Array<ts.SourceFile>();
		for (const fileName of filesSet) {
			const sourceFile = this.program.getSourceFile(fileName);
			assert(sourceFile, `Did not get sourceFile for ${fileName}`);
			if (!sourceFile.isDeclarationFile && !ts.isJsonSourceFile(sourceFile)) {
				sourceFiles.push(sourceFile);
			}
		}

		const progressLength = String(sourceFiles.length).length * 2 + 1;
		for (let i = 0; i < sourceFiles.length; i++) {
			const sourceFile = sourceFiles[i];

			const progress = `${i + 1}/${sourceFiles.length}`.padStart(progressLength);
			LogService.writeLine(`${progress} compile ${sourceFile.fileName}`);

			const customPreEmitDiagnostics = getCustomPreEmitDiagnostics(sourceFile);
			totalDiagnostics.push(...customPreEmitDiagnostics);
			if (totalDiagnostics.length > 0) break;

			const preEmitDiagnostics = ts.getPreEmitDiagnostics(this.program, sourceFile);
			totalDiagnostics.push(...preEmitDiagnostics);
			if (totalDiagnostics.length > 0) break;

			// create a new transform state for the file
			const transformState = new TransformState(
				this.compilerOptions,
				multiTransformState,
				this.rojoConfig,
				this.pathTranslator,
				this.runtimeLibRbxPath,
				this.nodeModulesPath,
				this.nodeModulesRbxPath,
				this.nodeModulesPathMapping,
				this.typeChecker,
				this.typeChecker.getEmitResolver(sourceFile),
				this.globalSymbols,
				this.macroManager,
				this.roactSymbolManager,
				this.projectType,
				this.pkgVersion,
				sourceFile,
			);

			// create a new Lua abstract syntax tree for the file
			const luaAST = transformSourceFile(transformState, sourceFile);
			totalDiagnostics.push(...transformState.diagnostics);
			if (totalDiagnostics.length > 0) break;

			// render lua abstract syntax tree and output only if there were no diagnostics
			const luaSource = renderAST(luaAST);
			fs.outputFileSync(this.pathTranslator.getOutputPath(sourceFile.fileName), luaSource);
		}

		if (totalDiagnostics.length > 0) {
			throw new DiagnosticError(totalDiagnostics);
		}
	}
}
