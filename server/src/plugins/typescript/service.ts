import { dirname, resolve } from "path";
import ts from "typescript";
import { TextDocumentContentChangeEvent } from "vscode-languageserver-protocol";
import { getPackageInfo } from "../../importPackage";
import { Document } from "../../lib/documents";
// import { configLoader } from '../../lib/documents/configLoader';
import { Logger } from "../../logger";
import { normalizePath } from "../../utils";
import { DocumentSnapshot, EstrelaSnapshotOptions } from "./DocumentSnapshot";
import { createEstrelaModuleLoader } from "./module-loader";
import {
  GlobalSnapshotsManager,
  ignoredBuildDirectories,
  SnapshotManager,
} from "./SnapshotManager";
import {
  ensureRealEstrelaFilePath,
  findTsConfigPath,
  hasTsExtensions,
} from "./utils";

export interface LanguageServiceContainer {
  readonly tsconfigPath: string;
  readonly compilerOptions: ts.CompilerOptions;
  /**
   * @internal Public for tests only
   */
  readonly snapshotManager: SnapshotManager;
  getService(): ts.LanguageService;
  updateSnapshot(documentOrFilePath: Document | string): DocumentSnapshot;
  deleteSnapshot(filePath: string): void;
  updateProjectFiles(): void;
  updateTsOrJsFile(
    fileName: string,
    changes?: TextDocumentContentChangeEvent[]
  ): void;
  /**
   * Checks if a file is present in the project.
   * Unlike `fileBelongsToProject`, this doesn't run a file search on disk.
   */
  hasFile(filePath: string): boolean;
  /**
   * Careful, don't call often, or it will hurt performance.
   * Only works for TS versions that have ScriptKind.Deferred
   */
  fileBelongsToProject(filePath: string): boolean;
}

const maxProgramSizeForNonTsFiles = 20 * 1024 * 1024; // 20 MB
const services = new Map<string, Promise<LanguageServiceContainer>>();
const serviceSizeMap: Map<string, number> = new Map();

/**
 * For testing only: Reset the cache for services.
 * Try to refactor this some day so that this file provides
 * a setup function which creates all this nicely instead.
 */
export function __resetCache() {
  services.clear();
  serviceSizeMap.clear();
}

export interface LanguageServiceDocumentContext {
  ambientTypesSource: string;
  transformOnTemplateError: boolean;
  useNewTransformation: boolean;
  createDocument: (fileName: string, content: string) => Document;
  globalSnapshotsManager: GlobalSnapshotsManager;
  notifyExceedSizeLimit: (() => void) | undefined;
}

export async function getService(
  path: string,
  workspaceUris: string[],
  docContext: LanguageServiceDocumentContext
): Promise<LanguageServiceContainer> {
  const tsconfigPath = findTsConfigPath(path, workspaceUris);
  return getServiceForTsconfig(tsconfigPath, docContext);
}

export async function forAllServices(
  cb: (service: LanguageServiceContainer) => any
): Promise<void> {
  for (const service of services.values()) {
    cb(await service);
  }
}

/**
 * @param tsconfigPath has to be absolute
 * @param docContext
 */
export async function getServiceForTsconfig(
  tsconfigPath: string,
  docContext: LanguageServiceDocumentContext
): Promise<LanguageServiceContainer> {
  let service: LanguageServiceContainer;
  if (services.has(tsconfigPath)) {
    service = await services.get(tsconfigPath)!;
  } else {
    Logger.log("Initialize new ts service at ", tsconfigPath);
    const newService = createLanguageService(tsconfigPath, docContext);
    services.set(tsconfigPath, newService);
    service = await newService;
  }

  return service;
}

async function createLanguageService(
  tsconfigPath: string,
  docContext: LanguageServiceDocumentContext
): Promise<LanguageServiceContainer> {
  const workspacePath = tsconfigPath ? dirname(tsconfigPath) : "";

  const { options: compilerOptions, fileNames: files, raw } = getParsedConfig();
  // raw is the tsconfig merged with extending config
  // see: https://github.com/microsoft/TypeScript/blob/08e4f369fbb2a5f0c30dee973618d65e6f7f09f8/src/compiler/commandLineParser.ts#L2537
  const snapshotManager = new SnapshotManager(
    docContext.globalSnapshotsManager,
    files,
    raw,
    workspacePath || process.cwd()
  );

  // Load all configs within the tsconfig scope and the one above so that they are all loaded
  // by the time they need to be accessed synchronously by DocumentSnapshots to determine
  // the default language.
  // await configLoader.loadConfigs(workspacePath);

  const estrelaModuleLoader = createEstrelaModuleLoader(
    getSnapshot,
    compilerOptions
  );

  let estrelaTsPath: string;
  try {
    // For when estrela2tsx/estrela-check is part of node_modules, for example VS Code extension
    estrelaTsPath = dirname(require.resolve(docContext.ambientTypesSource));
  } catch (e) {
    // Fall back to dirname
    estrelaTsPath = __dirname;
  }
  const estrelaTsxFiles = [
    "./estrela-shims.d.ts",
    "./estrela-jsx.d.ts",
    "./estrela-native-jsx.d.ts",
  ].map((f) => ts.sys.resolvePath(resolve(estrelaTsPath, f)));

  let languageServiceReducedMode = false;
  let projectVersion = 0;

  const host: ts.LanguageServiceHost = {
    getCompilationSettings: () => {
      return compilerOptions;
    },
    getScriptFileNames: () => {
      return Array.from(
        new Set([
          ...(languageServiceReducedMode
            ? []
            : snapshotManager.getProjectFileNames()),
          ...snapshotManager.getFileNames(),
          ...estrelaTsxFiles,
        ])
      );
    },
    getScriptVersion: (fileName: string) => {
      return getSnapshot(fileName).version.toString();
    },
    getScriptSnapshot(filename) {
      return getSnapshot(filename);
    },
    getCurrentDirectory() {
      return workspacePath;
    },
    getDefaultLibFileName(options) {
      return ts.getDefaultLibFilePath(options);
    },
    fileExists(path) {
      return estrelaModuleLoader.fileExists(path);
    },
    readFile(path, encoding) {
      return estrelaModuleLoader.readFile(path, encoding);
    },
    resolveModuleNames(moduleNames, containingFile) {
      return estrelaModuleLoader.resolveModuleNames(
        moduleNames,
        containingFile
      );
    },
    readDirectory(path, ext, exc, inc, depth) {
      return estrelaModuleLoader.readDirectory(path, ext, exc, inc, depth);
    },
    getDirectories(path) {
      return ts.sys.getDirectories(path);
    },
    useCaseSensitiveFileNames: () => {
      return ts.sys.useCaseSensitiveFileNames;
    },
    getScriptKind: (fileName: string) => {
      return getSnapshot(fileName).scriptKind;
    },
    getProjectVersion: () => {
      return projectVersion.toString();
    },
    getNewLine: () => {
      return ts.sys.newLine;
    },
  };

  let languageService = ts.createLanguageService(host);
  const transformationConfig: EstrelaSnapshotOptions = {
    transformOnTemplateError: docContext.transformOnTemplateError,
    useNewTransformation: docContext.useNewTransformation,
    typingsNamespace: raw?.estrelaOptions?.namespace || "estrelaHTML",
  };

  docContext.globalSnapshotsManager.onChange(() => {
    projectVersion++;
  });

  reduceLanguageServiceCapabilityIfFileSizeTooBig();

  return {
    tsconfigPath,
    compilerOptions,
    getService: () => languageService,
    updateSnapshot,
    deleteSnapshot,
    updateProjectFiles,
    updateTsOrJsFile,
    hasFile,
    fileBelongsToProject,
    snapshotManager,
  };

  function deleteSnapshot(filePath: string): void {
    estrelaModuleLoader.deleteFromModuleCache(filePath);
    snapshotManager.delete(filePath);
  }

  function updateSnapshot(
    documentOrFilePath: Document | string
  ): DocumentSnapshot {
    return typeof documentOrFilePath === "string"
      ? updateSnapshotFromFilePath(documentOrFilePath)
      : updateSnapshotFromDocument(documentOrFilePath);
  }

  function updateSnapshotFromDocument(document: Document): DocumentSnapshot {
    const filePath = document.getFilePath() || "";
    const prevSnapshot = snapshotManager.get(filePath);
    if (prevSnapshot?.version === document.version) {
      return prevSnapshot;
    }

    if (!prevSnapshot) {
      estrelaModuleLoader.deleteUnresolvedResolutionsFromCache(filePath);
    }

    const newSnapshot = DocumentSnapshot.fromDocument(
      document,
      transformationConfig
    );

    snapshotManager.set(filePath, newSnapshot);
    if (prevSnapshot && prevSnapshot.scriptKind !== newSnapshot.scriptKind) {
      // Restart language service as it doesn't handle script kind changes.
      languageService.dispose();
      languageService = ts.createLanguageService(host);
    }

    return newSnapshot;
  }

  function updateSnapshotFromFilePath(filePath: string): DocumentSnapshot {
    const prevSnapshot = snapshotManager.get(filePath);
    if (prevSnapshot) {
      return prevSnapshot;
    }

    estrelaModuleLoader.deleteUnresolvedResolutionsFromCache(filePath);
    const newSnapshot = DocumentSnapshot.fromFilePath(
      filePath,
      docContext.createDocument,
      transformationConfig
    );
    snapshotManager.set(filePath, newSnapshot);
    return newSnapshot;
  }

  function getSnapshot(fileName: string): DocumentSnapshot {
    fileName = ensureRealEstrelaFilePath(fileName);

    let doc = snapshotManager.get(fileName);
    if (doc) {
      return doc;
    }

    estrelaModuleLoader.deleteUnresolvedResolutionsFromCache(fileName);
    doc = DocumentSnapshot.fromFilePath(
      fileName,
      docContext.createDocument,
      transformationConfig
    );
    snapshotManager.set(fileName, doc);
    return doc;
  }

  function updateProjectFiles(): void {
    projectVersion++;
    const projectFileCountBefore = snapshotManager.getProjectFileNames().length;
    snapshotManager.updateProjectFiles();
    const projectFileCountAfter = snapshotManager.getProjectFileNames().length;

    if (projectFileCountAfter <= projectFileCountBefore) {
      return;
    }

    reduceLanguageServiceCapabilityIfFileSizeTooBig();
  }

  function hasFile(filePath: string): boolean {
    return snapshotManager.has(filePath);
  }

  function fileBelongsToProject(filePath: string): boolean {
    filePath = normalizePath(filePath);
    return hasFile(filePath) || getParsedConfig().fileNames.includes(filePath);
  }

  function updateTsOrJsFile(
    fileName: string,
    changes?: TextDocumentContentChangeEvent[]
  ): void {
    if (!snapshotManager.has(fileName)) {
      estrelaModuleLoader.deleteUnresolvedResolutionsFromCache(fileName);
    }
    snapshotManager.updateTsOrJsFile(fileName, changes);
  }

  function getParsedConfig() {
    const forcedCompilerOptions: ts.CompilerOptions = {
      allowNonTsExtensions: true,
      target: ts.ScriptTarget.Latest,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      allowJs: true,
      noEmit: true,
      declaration: false,
      skipLibCheck: true,
    };
    if (!docContext.useNewTransformation) {
      // these are needed to handle the results of estrela2tsx preprocessing:
      forcedCompilerOptions.jsx = ts.JsxEmit.Preserve;
    }

    // always let ts parse config to get default compilerOption
    let configJson =
      (tsconfigPath &&
        ts.readConfigFile(tsconfigPath, ts.sys.readFile).config) ||
      getDefaultJsConfig();

    // Only default exclude when no extends for now
    if (!configJson.extends) {
      configJson = Object.assign(
        {
          exclude: getDefaultExclude(),
        },
        configJson
      );
    }

    const parsedConfig = ts.parseJsonConfigFileContent(
      configJson,
      ts.sys,
      workspacePath,
      forcedCompilerOptions,
      tsconfigPath,
      undefined,
      [
        {
          extension: "estrela",
          isMixedContent: true,
          // Deferred was added in a later TS version, fall back to tsx
          // If Deferred exists, this means that all Estrela files are included
          // in parsedConfig.fileNames
          scriptKind:
            ts.ScriptKind.Deferred ??
            (docContext.useNewTransformation
              ? ts.ScriptKind.TS
              : ts.ScriptKind.TSX),
        },
      ]
    );

    const compilerOptions: ts.CompilerOptions = {
      ...parsedConfig.options,
      ...forcedCompilerOptions,
    };

    // detect which JSX namespace to use (estrela | estrelaNative) if not specified or not compatible
    if (
      !compilerOptions.jsxFactory ||
      !compilerOptions.jsxFactory.startsWith("estrela")
    ) {
      if (!docContext.useNewTransformation) {
        //default to regular estrela, this causes the usage of the "estrela.JSX" namespace
        compilerOptions.jsxFactory = "h"; // "estrela.createElement";
      }

      //override if we detect estrela-native
      if (workspacePath) {
        try {
          const estrelaNativePkgInfo = getPackageInfo(
            "estrela-native",
            workspacePath
          );
          if (estrelaNativePkgInfo.path) {
            if (docContext.useNewTransformation) {
              // For backwards compatibility
              parsedConfig.raw.estrelaOptions =
                parsedConfig.raw.estrelaOptions || {};
              parsedConfig.raw.estrelaOptions.namespace = "estrelaNative.JSX";
            } else {
              compilerOptions.jsxFactory = "estrelaNative.createElement";
            }
          }
        } catch (e) {
          //we stay regular estrela
        }
      }
    }

    return {
      ...parsedConfig,
      fileNames: parsedConfig.fileNames.map(normalizePath),
      options: compilerOptions,
    };
  }

  /**
   * This should only be used when there's no jsconfig/tsconfig at all
   */
  function getDefaultJsConfig(): {
    compilerOptions: ts.CompilerOptions;
    include: string[];
  } {
    return {
      compilerOptions: {
        maxNodeModuleJsDepth: 2,
        allowSyntheticDefaultImports: true,
      },
      // Necessary to not flood the initial files
      // with potentially completely unrelated .ts/.js files:
      include: [],
    };
  }

  function getDefaultExclude() {
    return ["node_modules", ...ignoredBuildDirectories];
  }

  /**
   * Disable usage of project files.
   * running language service in a reduced mode for
   * large projects with improperly excluded tsconfig.
   */
  function reduceLanguageServiceCapabilityIfFileSizeTooBig() {
    if (
      exceedsTotalSizeLimitForNonTsFiles(
        compilerOptions,
        tsconfigPath,
        snapshotManager
      )
    ) {
      languageService.cleanupSemanticCache();
      languageServiceReducedMode = true;
      docContext.notifyExceedSizeLimit?.();
    }
  }
}

/**
 * adopted from https://github.com/microsoft/TypeScript/blob/3c8e45b304b8572094c5d7fbb9cd768dbf6417c0/src/server/editorServices.ts#L1955
 */
function exceedsTotalSizeLimitForNonTsFiles(
  compilerOptions: ts.CompilerOptions,
  tsconfigPath: string,
  snapshotManager: SnapshotManager
): boolean {
  if (compilerOptions.disableSizeLimit) {
    return false;
  }

  let availableSpace = maxProgramSizeForNonTsFiles;
  serviceSizeMap.set(tsconfigPath, 0);

  serviceSizeMap.forEach((size) => {
    availableSpace -= size;
  });

  let totalNonTsFileSize = 0;

  const fileNames = snapshotManager.getProjectFileNames();
  for (const fileName of fileNames) {
    if (hasTsExtensions(fileName)) {
      continue;
    }

    totalNonTsFileSize += ts.sys.getFileSize?.(fileName) ?? 0;

    if (totalNonTsFileSize > availableSpace) {
      const top5LargestFiles = fileNames
        .filter((name) => !hasTsExtensions(name))
        .map((name) => ({ name, size: ts.sys.getFileSize?.(name) ?? 0 }))
        .sort((a, b) => b.size - a.size)
        .slice(0, 5);

      Logger.log(
        `Non TS file size exceeded limit (${totalNonTsFileSize}). ` +
          `Largest files: ${top5LargestFiles
            .map((file) => `${file.name}:${file.size}`)
            .join(", ")}`
      );

      return true;
    }
  }

  serviceSizeMap.set(tsconfigPath, totalNonTsFileSize);
  return false;
}
