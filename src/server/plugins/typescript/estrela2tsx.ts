import MagicString from "magic-string";
import ts from "typescript";
import { Document } from "../../lib/documents";

export function getExportedNames(scriptContent?: string): {
  states: string[];
  props: string[];
  emitters: string[];
} {
  const states: string[] = [];
  const props: string[] = [];
  const emitters: string[] = [];

  if (scriptContent) {
    const source = ts.createSourceFile(
      "file.ts",
      scriptContent,
      ts.ScriptTarget.ESNext,
      undefined,
      ts.ScriptKind.TSX
    );

    const visitChildren = (node: ts.Node) => {
      node.forEachChild(visitChildren);

      if (ts.isVariableDeclaration(node)) {
        const name = node.name.getText(source);
        if (node.initializer && ts.isCallExpression(node.initializer)) {
          const call = node.initializer.expression.getText(source);
          switch (call) {
            case "state":
              states.push(name);
              break;
            case "props":
              props.push(name);
              break;
            case "emitter":
              emitters.push(name);
              break;
          }
        }
      }
    };
    visitChildren(source);
  }

  return { states, props, emitters };
}

export function estrela2tsx(document: Document) {
  const code = document.getText();
  const filepath = document.getFilePath() ?? "";
  const ms = new MagicString(code);

  if (document.scriptInfo) {
    const script = document.scriptInfo;

    ms.overwrite(
      script.container.start,
      script.start,
      "// @ts-ignore\nconst host: import('estrela').CustomElement;"
    );
    ms.overwrite(script.end, script.container.end, `;(<>`);
    ms.append("\n</>);");
  }

  if (document.styleInfo) {
    const style = document.styleInfo;
    ms.remove(style.container.start, style.container.end);
  }

  // remove html comments
  const htmlCommentsRegex = /<!--(.*?)-->/gs;
  [...code.matchAll(htmlCommentsRegex)].forEach((match) => {
    if (match.index) {
      ms.overwrite(match.index, match.index + match[0].length, "");
    }
  });

  // remove attr extra syntax
  const attributesRegex =
    /(?<=<(?!(script|style|template)))[\w-]+[\s|\n]({.*?}|.)*?(?=>)/gs;

  const unsuportedAttr =
    /(?<!<)(on:[\w-]+|class|style)([\||\.].*)(?=\s*=\s*['"{])/g;

  [...code.matchAll(attributesRegex)].forEach((match) => {
    const attributeIndex = match.index ?? 0;
    const attributes = match[0];

    [...attributes.matchAll(unsuportedAttr)].forEach((match) => {
      const riptext = match[2];
      const startIndex = attributeIndex + (match?.index ?? 0);
      const index = code.indexOf(riptext, startIndex);
      ms.remove(index, index + riptext.length);
    });
  });

  return {
    exportedNames: getExportedNames(document.scriptInfo?.content),
    code: ms.toString(),
    map: ms.generateMap({
      hires: true,
      source: filepath,
      file: filepath + ".map",
      includeContent: true,
    }),
  };
}
