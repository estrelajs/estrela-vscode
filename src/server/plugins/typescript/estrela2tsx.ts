import MagicString from "magic-string";
import ts from "typescript";

interface Range {
  start: number;
  end: number;
}

const ESTRELA_FILE_REGEX = /([\w-]+)\.estrela$/;

function createSource(content: string) {
  return ts.createSourceFile(
    "file.ts",
    content,
    ts.ScriptTarget.ESNext,
    false,
    ts.ScriptKind.TSX
  );
}

function getRange(node: ts.Node, source: ts.SourceFile): Range {
  const start = node.getStart(source); // minus fake fragment length
  const end = node.getEnd();
  return { start, end };
}

function getElements(source: ts.SourceFile): {
  script: ts.JsxElement | undefined;
  style: ts.JsxElement | undefined;
  template: ts.JsxElement | undefined;
} {
  let script: ts.JsxElement | undefined = undefined;
  let style: ts.JsxElement | undefined = undefined;
  let template: ts.JsxElement | undefined = undefined;

  const visitElements = (node: ts.Node) => {
    if (ts.isJsxElement(node)) {
      const isTagName = (tag: string) =>
        ts.isIdentifier(node.openingElement.tagName) &&
        node.openingElement.tagName.text === tag;
      if (isTagName("script")) {
        script = node;
      }
      if (isTagName("style")) {
        style = node;
      }
      if (isTagName("template")) {
        template = node;
      }
      return;
    }
    node.forEachChild(visitElements);
  };

  visitElements(source);
  return { script, style, template };
}

export function estrela2tsx(
  code: string,
  options?: {
    filePath?: string;
    isTsFile?: ts.ScriptKind;
    typingsNamespace?: string;
    namespace?: string;
    accessors?: string;
  }
) {
  const [filename, tag] =
    ESTRELA_FILE_REGEX.exec(options?.filePath ?? "") ?? [];

  const ms = new MagicString(code);
  const source = createSource(code);
  const { script, style } = getElements(source);

  if (script) {
    const openRange = getRange(script.openingElement, source);
    const closeRange = getRange(script.closingElement, source);
    ms.overwrite(openRange.start, openRange.end, "");
    ms.overwrite(closeRange.start, closeRange.end, ";(<>");
    ms.append("\n</>);");
  } else {
    ms.prepend(";(<>\n");
    ms.append("\n</>);");
  }

  if (style) {
    const openRange = getRange(style.openingElement, source);
    const closeRange = getRange(style.closingElement, source);
    ms.overwrite(openRange.start, closeRange.end, "");
  }

  return {
    tag,
    code: ms.toString(),
    map: ms.generateMap({
      hires: true,
      source: filename,
      file: filename + ".map",
      includeContent: true,
    }),
  };
}
