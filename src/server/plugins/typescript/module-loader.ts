import ts from "typescript";
import { getLastPartOfPath } from "../../utils";
import { DocumentSnapshot } from "./DocumentSnapshot";
import { createEstrelaSys } from "./estrela-sys";
import {
  ensureRealEstrelaFilePath,
  getExtensionFromScriptKind,
  isVirtualEstrelaFilePath,
} from "./utils";

/**
 * Caches resolved modules.
 */
class ModuleResolutionCache {
  private cache = new Map<string, ts.ResolvedModule | undefined>();

  /**
   * Tries to get a cached module.
   * Careful: `undefined` can mean either there's no match found, or that the result resolved to `undefined`.
   */
  get(
    moduleName: string,
    containingFile: string
  ): ts.ResolvedModule | undefined {
    return this.cache.get(this.getKey(moduleName, containingFile));
  }

  /**
   * Checks if has cached module.
   */
  has(moduleName: string, containingFile: string): boolean {
    return this.cache.has(this.getKey(moduleName, containingFile));
  }

  /**
   * Caches resolved module (or undefined).
   */
  set(
    moduleName: string,
    containingFile: string,
    resolvedModule: ts.ResolvedModule | undefined
  ) {
    this.cache.set(this.getKey(moduleName, containingFile), resolvedModule);
  }

  /**
   * Deletes module from cache. Call this if a file was deleted.
   * @param resolvedModuleName full path of the module
   */
  delete(resolvedModuleName: string): void {
    this.cache.forEach((val, key) => {
      if (val?.resolvedFileName === resolvedModuleName) {
        this.cache.delete(key);
      }
    });
  }

  /**
   * Deletes everything from cache that resolved to `undefined`
   * and which might match the path.
   */
  deleteUnresolvedResolutionsFromCache(path: string): void {
    const fileNameWithoutEnding =
      getLastPartOfPath(path).split(".").shift() || "";
    this.cache.forEach((val, key) => {
      const moduleName = key.split(":::").pop() || "";
      if (!val && moduleName.includes(fileNameWithoutEnding)) {
        this.cache.delete(key);
      }
    });
  }

  private getKey(moduleName: string, containingFile: string) {
    return containingFile + ":::" + ensureRealEstrelaFilePath(moduleName);
  }
}

/**
 * Creates a module loader specifically for `.estrela` files.
 *
 * The typescript language service tries to look up other files that are referenced in the currently open estrela file.
 * For `.ts`/`.js` files this works, for `.estrela` files it does not by default.
 * Reason: The typescript language service does not know about the `.estrela` file ending,
 * so it assumes it's a normal typescript file and searches for files like `../Component.estrela.ts`, which is wrong.
 * In order to fix this, we need to wrap typescript's module resolution and reroute all `.estrela.ts` file lookups to .estrela.
 *
 * @param getSnapshot A function which returns a (in case of estrela file fully preprocessed) typescript/javascript snapshot
 * @param compilerOptions The typescript compiler options
 */
export function createEstrelaModuleLoader(
  getSnapshot: (fileName: string) => DocumentSnapshot,
  compilerOptions: ts.CompilerOptions
) {
  const estrelaSys = createEstrelaSys(getSnapshot);
  const moduleCache = new ModuleResolutionCache();

  return {
    fileExists: estrelaSys.fileExists,
    readFile: estrelaSys.readFile,
    readDirectory: estrelaSys.readDirectory,
    deleteFromModuleCache: (path: string) => {
      estrelaSys.deleteFromCache(path);
      moduleCache.delete(path);
    },
    deleteUnresolvedResolutionsFromCache: (path: string) => {
      estrelaSys.deleteFromCache(path);
      moduleCache.deleteUnresolvedResolutionsFromCache(path);
    },
    resolveModuleNames,
  };

  function resolveModuleNames(
    moduleNames: string[],
    containingFile: string
  ): Array<ts.ResolvedModule | undefined> {
    return moduleNames.map((moduleName) => {
      if (moduleCache.has(moduleName, containingFile)) {
        return moduleCache.get(moduleName, containingFile);
      }

      const resolvedModule = resolveModuleName(moduleName, containingFile);
      moduleCache.set(moduleName, containingFile, resolvedModule);
      return resolvedModule;
    });
  }

  function resolveModuleName(
    name: string,
    containingFile: string
  ): ts.ResolvedModule | undefined {
    // Delegate to the TS resolver first.
    // If that does not bring up anything, try the Estrela Module loader
    // which is able to deal with .estrela files.
    const tsResolvedModule = ts.resolveModuleName(
      name,
      containingFile,
      compilerOptions,
      ts.sys
    ).resolvedModule;
    if (
      tsResolvedModule &&
      !isVirtualEstrelaFilePath(tsResolvedModule.resolvedFileName)
    ) {
      return tsResolvedModule;
    }

    const estrelaResolvedModule = ts.resolveModuleName(
      name,
      containingFile,
      compilerOptions,
      estrelaSys
    ).resolvedModule;
    if (
      !estrelaResolvedModule ||
      !isVirtualEstrelaFilePath(estrelaResolvedModule.resolvedFileName)
    ) {
      return estrelaResolvedModule;
    }

    const resolvedFileName = ensureRealEstrelaFilePath(
      estrelaResolvedModule.resolvedFileName
    );
    const snapshot = getSnapshot(resolvedFileName);

    const resolvedEstrelaModule: ts.ResolvedModuleFull = {
      extension: getExtensionFromScriptKind(snapshot && snapshot.scriptKind),
      resolvedFileName,
      isExternalLibraryImport: estrelaResolvedModule.isExternalLibraryImport,
    };
    return resolvedEstrelaModule;
  }
}
