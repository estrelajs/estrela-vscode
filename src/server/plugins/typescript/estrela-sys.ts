import { DocumentSnapshot } from "./DocumentSnapshot";
import ts from "typescript";
import {
  ensureRealEstrelaFilePath,
  isVirtualEstrelaFilePath,
  toRealEstrelaFilePath,
} from "./utils";

/**
 * This should only be accessed by TS estrela module resolution.
 */
export function createEstrelaSys(
  getSnapshot: (fileName: string) => DocumentSnapshot
) {
  const fileExistsCache = new Map<string, boolean>();

  const sys: ts.System & { deleteFromCache: (path: string) => void } = {
    ...ts.sys,
    fileExists(path: string) {
      path = ensureRealEstrelaFilePath(path);
      const exists = fileExistsCache.get(path) ?? ts.sys.fileExists(path);
      fileExistsCache.set(path, exists);
      return exists;
    },
    readFile(path: string) {
      const snapshot = getSnapshot(path);
      return snapshot.getText(0, snapshot.getLength());
    },
    readDirectory(path, extensions, exclude, include, depth) {
      const extensionsWithEstrela = (extensions ?? []).concat(".estrela");

      return ts.sys.readDirectory(
        path,
        extensionsWithEstrela,
        exclude,
        include,
        depth
      );
    },
    deleteFile(path) {
      fileExistsCache.delete(ensureRealEstrelaFilePath(path));
      return ts.sys.deleteFile?.(path);
    },
    deleteFromCache(path) {
      fileExistsCache.delete(ensureRealEstrelaFilePath(path));
    },
  };

  if (ts.sys.realpath) {
    const realpath = ts.sys.realpath;
    sys.realpath = function (path) {
      if (isVirtualEstrelaFilePath(path)) {
        return realpath(toRealEstrelaFilePath(path)) + ".ts";
      }
      return realpath(path);
    };
  }

  return sys;
}
