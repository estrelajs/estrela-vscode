import { RawSourceMap, SourceMapConsumer } from "source-map";
import ts from "typescript";
import {
  Position,
  Range,
  TextDocumentContentChangeEvent,
} from "vscode-languageserver";
import {
  Document,
  DocumentMapper,
  FragmentMapper,
  getLineOffsets,
  IdentityMapper,
  isInTag,
  offsetAt,
  positionAt,
  TagInformation,
} from "../../lib/documents";
import { pathToUrl } from "../../utils";
import { ConsumerDocumentMapper } from "./DocumentMapper";
import { EstrelaNode } from "./estrela-ast-utils";
import { estrela2tsx } from "./estrela2tsx";
import {
  getScriptKindFromFileName,
  getTsCheckComment,
  isEstrelaFilePath,
} from "./utils";

/**
 * An error which occured while trying to parse/preprocess the estrela file contents.
 */
export interface ParserError {
  message: string;
  range: Range;
  code: number;
}

/**
 * Initial version of snapshots.
 */
export const INITIAL_VERSION = 0;

/**
 * A document snapshot suitable for the ts language service and the plugin.
 * Can be a estrela or ts/js file.
 */
export interface DocumentSnapshot extends ts.IScriptSnapshot {
  version: number;
  filePath: string;
  scriptKind: ts.ScriptKind;
  positionAt(offset: number): Position;
  /**
   * Instantiates a source mapper.
   * `destroyFragment` needs to be called when
   * it's no longer needed / the class should be cleaned up
   * in order to prevent memory leaks.
   */
  getFragment(): Promise<SnapshotFragment>;
  /**
   * Needs to be called when source mapper
   * is no longer needed / the class should be cleaned up
   * in order to prevent memory leaks.
   */
  destroyFragment(): void;
  /**
   * Convenience function for getText(0, getLength())
   */
  getFullText(): string;
}

/**
 * The mapper to get from original snapshot positions to generated and vice versa.
 */
export interface SnapshotFragment extends DocumentMapper {
  scriptInfo: TagInformation | null;
  positionAt(offset: number): Position;
  offsetAt(position: Position): number;
}

/**
 * Options that apply to estrela files.
 */
export interface EstrelaSnapshotOptions {
  transformOnTemplateError: boolean;
  useNewTransformation: boolean;
  typingsNamespace: string;
}

export namespace DocumentSnapshot {
  /**
   * Returns a estrela snapshot from a estrela document.
   * @param document the estrela document
   * @param options options that apply to the estrela document
   */
  export function fromDocument(
    document: Document,
    options: EstrelaSnapshotOptions
  ) {
    const {
      tsxMap,
      // htmlAst,
      text,
      exportedNames,
      parserError,
      nrPrependedLines,
      scriptKind,
    } = preprocessEstrelaFile(document, options);

    return new EstrelaDocumentSnapshot(
      document,
      parserError,
      scriptKind,
      text,
      nrPrependedLines,
      exportedNames,
      tsxMap
      // htmlAst
    );
  }

  /**
   * Returns a Estrela or ts/js snapshot from a file path, depending on the file contents.
   * @param filePath path to the js/ts/estrela file
   * @param createDocument function that is used to create a document in case it's a Estrela file
   * @param options options that apply in case it's a Estrela file
   */
  export function fromFilePath(
    filePath: string,
    createDocument: (filePath: string, text: string) => Document,
    options: EstrelaSnapshotOptions
  ) {
    if (isEstrelaFilePath(filePath)) {
      return DocumentSnapshot.fromEstrelaFilePath(
        filePath,
        createDocument,
        options
      );
    } else {
      return DocumentSnapshot.fromNonEstrelaFilePath(filePath);
    }
  }

  /**
   * Returns a ts/js snapshot from a file path.
   * @param filePath path to the js/ts file
   * @param options options that apply in case it's a estrela file
   */
  export function fromNonEstrelaFilePath(filePath: string) {
    const originalText = ts.sys.readFile(filePath) ?? "";
    return new JSOrTSDocumentSnapshot(INITIAL_VERSION, filePath, originalText);
  }

  /**
   * Returns a estrela snapshot from a file path.
   * @param filePath path to the estrela file
   * @param createDocument function that is used to create a document
   * @param options options that apply in case it's a estrela file
   */
  export function fromEstrelaFilePath(
    filePath: string,
    createDocument: (filePath: string, text: string) => Document,
    options: EstrelaSnapshotOptions
  ) {
    const originalText = ts.sys.readFile(filePath) ?? "";
    return fromDocument(createDocument(filePath, originalText), options);
  }
}

/**
 * Tries to preprocess the estrela document and convert the contents into better analyzable js/ts(x) content.
 */
function preprocessEstrelaFile(
  document: Document,
  options: EstrelaSnapshotOptions
) {
  let tsxMap: RawSourceMap | undefined;
  let parserError: ParserError | null = null;
  let nrPrependedLines = 0;
  let text = document.getText();

  let exportedNames: {
    states: string[];
    props: string[];
    emitters: string[];
  } = {
    states: [],
    props: [],
    emitters: [],
  };

  const scriptKind = ts.ScriptKind.TSX;

  try {
    // get preprocessed tsx file
    const tsx = estrela2tsx(document);
    text = tsx.code;
    tsxMap = tsx.map;
    exportedNames = tsx.exportedNames;

    if (tsxMap) {
      tsxMap.sources = [document.uri];
      const scriptInfo = document.scriptInfo ?? document.moduleScriptInfo;
      const tsCheck = getTsCheckComment(scriptInfo?.content);
      if (tsCheck) {
        text = tsCheck + text;
        nrPrependedLines = 1;
      }
    }
  } catch (error) {
    // TODO: handle error.
  }

  return {
    tsxMap,
    text,
    exportedNames,
    // htmlAst,
    parserError,
    nrPrependedLines,
    scriptKind,
  };
}

/**
 * A estrela document snapshot suitable for the ts language service and the plugin.
 */
export class EstrelaDocumentSnapshot implements DocumentSnapshot {
  private fragment?: EstrelaSnapshotFragment;

  version = this.parent.version;

  constructor(
    private readonly parent: Document,
    public readonly parserError: ParserError | null,
    public readonly scriptKind: ts.ScriptKind,
    private readonly text: string,
    private readonly nrPrependedLines: number,
    private readonly exportedNames: {
      states: string[];
      props: string[];
      emitters: string[];
    },
    // private readonly htmlAst?: TemplateNode
    private readonly tsxMap?: RawSourceMap
  ) {}

  get filePath() {
    return this.parent.getFilePath() || "";
  }

  getText(start: number, end: number) {
    return this.text.substring(start, end);
  }

  getLength() {
    return this.text.length;
  }

  getFullText() {
    return this.text;
  }

  getChangeRange() {
    return undefined;
  }

  positionAt(offset: number) {
    return positionAt(offset, this.text);
  }

  getLineContainingOffset(offset: number) {
    const chunks = this.getText(0, offset).split("\n");
    return chunks[chunks.length - 1];
  }

  hasProp(name: string): boolean {
    return this.exportedNames.props.includes(name);
  }

  estrelaNodeAt(postionOrOffset: number | Position): EstrelaNode | null {
    return null;
    // if (!this.htmlAst) {
    //   return null;
    // }
    // const offset =
    //   typeof postionOrOffset === "number"
    //     ? postionOrOffset
    //     : this.parent.offsetAt(postionOrOffset);

    // let foundNode: EstrelaNode | null = null;
    // walk(this.htmlAst, {
    //   enter(node) {
    //     // In case the offset is at a point where a node ends and a new one begins,
    //     // the node where the code ends is used. If this introduces problems, introduce
    //     // an affinity parameter to prefer the node where it ends/starts.
    //     if (
    //       (node as EstrelaNode).start > offset ||
    //       (node as EstrelaNode).end < offset
    //     ) {
    //       this.skip();
    //       return;
    //     }
    //     const parent = foundNode;
    //     // Spread so the "parent" property isn't added to the original ast,
    //     // causing an infinite loop
    //     foundNode = { ...node } as EstrelaNode;
    //     if (parent) {
    //       foundNode.parent = parent;
    //     }
    //   },
    // });

    // return foundNode;
  }

  async getFragment() {
    if (!this.fragment) {
      const uri = pathToUrl(this.filePath);
      this.fragment = new EstrelaSnapshotFragment(
        await this.getMapper(uri),
        this.text,
        this.parent,
        uri
      );
    }
    return this.fragment;
  }

  destroyFragment() {
    if (this.fragment) {
      this.fragment.destroy();
      this.fragment = undefined;
    }
  }

  private async getMapper(uri: string) {
    const scriptInfo = this.parent.scriptInfo || this.parent.moduleScriptInfo;

    if (!this.tsxMap) {
      if (!scriptInfo) {
        return new IdentityMapper(uri);
      }

      return new FragmentMapper(this.parent.getText(), scriptInfo, uri);
    }

    return new ConsumerDocumentMapper(
      await new SourceMapConsumer(this.tsxMap),
      uri,
      this.nrPrependedLines
    );
  }
}

/**
 * A js/ts document snapshot suitable for the ts language service and the plugin.
 * Since no mapping has to be done here, it also implements the mapper interface.
 */
export class JSOrTSDocumentSnapshot
  extends IdentityMapper
  implements DocumentSnapshot, SnapshotFragment
{
  scriptKind = getScriptKindFromFileName(this.filePath);
  scriptInfo = null;
  private lineOffsets?: number[];

  constructor(
    public version: number,
    public readonly filePath: string,
    private text: string
  ) {
    super(pathToUrl(filePath));
  }

  getText(start: number, end: number) {
    return this.text.substring(start, end);
  }

  getLength() {
    return this.text.length;
  }

  getFullText() {
    return this.text;
  }

  getChangeRange() {
    return undefined;
  }

  positionAt(offset: number) {
    return positionAt(offset, this.text, this.getLineOffsets());
  }

  offsetAt(position: Position): number {
    return offsetAt(position, this.text, this.getLineOffsets());
  }

  async getFragment() {
    return this;
  }

  destroyFragment() {
    // nothing to clean up
  }

  update(changes: TextDocumentContentChangeEvent[]): void {
    for (const change of changes) {
      let start = 0;
      let end = 0;
      if ("range" in change) {
        start = this.offsetAt(change.range.start);
        end = this.offsetAt(change.range.end);
      } else {
        end = this.getLength();
      }

      this.text =
        this.text.slice(0, start) + change.text + this.text.slice(end);
    }

    this.version++;
    this.lineOffsets = undefined;
  }

  private getLineOffsets() {
    if (!this.lineOffsets) {
      this.lineOffsets = getLineOffsets(this.text);
    }
    return this.lineOffsets;
  }
}

/**
 * The mapper to get from original estrela document positions
 * to generated snapshot positions and vice versa.
 */
export class EstrelaSnapshotFragment implements SnapshotFragment {
  private lineOffsets = getLineOffsets(this.text);

  constructor(
    private readonly mapper: DocumentMapper,
    public readonly text: string,
    public readonly parent: Document,
    private readonly url: string
  ) {}

  get scriptInfo() {
    return this.parent.scriptInfo;
  }

  get moduleScriptInfo() {
    return this.parent.moduleScriptInfo;
  }

  get originalText() {
    return this.parent.getText();
  }

  getOriginalPosition(pos: Position): Position {
    return this.mapper.getOriginalPosition(pos);
  }

  getGeneratedPosition(pos: Position): Position {
    return this.mapper.getGeneratedPosition(pos);
  }

  isInGenerated(pos: Position): boolean {
    return !isInTag(pos, this.parent.styleInfo);
  }

  getURL(): string {
    return this.url;
  }

  positionAt(offset: number) {
    return positionAt(offset, this.text, this.lineOffsets);
  }

  offsetAt(position: Position) {
    return offsetAt(position, this.text, this.lineOffsets);
  }

  /**
   * Needs to be called when source mapper is no longer needed in order to prevent memory leaks.
   */
  destroy() {
    if (this.mapper.destroy) {
      this.mapper.destroy();
    }
  }
}
