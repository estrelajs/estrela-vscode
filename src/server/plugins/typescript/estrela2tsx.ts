import MagicString from "magic-string";
import ts from "typescript";

interface TagMetadata {
  tag: string;
  attributes: Record<string, string>;
  content: string;
  fullContent: string;
  opening: string;
  closing: string;
}

const ESTRELA_FILE_REGEX = /([\w-]+)\.estrela$/;

function findTag(tag: string, code: string): TagMetadata | undefined {
  const pattern = `(<${tag}(.*?)>)(.*?)(<\/${tag}>)`;
  const regex = new RegExp(pattern, "s");

  const [fullContent, opening, attrs, content, closing] =
    regex.exec(code) ?? [];

  let match: RegExpExecArray | null;
  const tagRegex = /([\w-]+)=["']?([\w-]+)["']?/g;
  const attributes: Record<string, string> = {};

  while ((match = tagRegex.exec(attrs))) {
    const [, attr, value] = match;
    attributes[attr] = value;
  }

  if (fullContent) {
    return {
      tag,
      content,
      fullContent,
      attributes,
      opening,
      closing,
    };
  }

  return undefined;
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
  const filepath = options?.filePath ?? "";
  const [, name] = ESTRELA_FILE_REGEX.exec(filepath) ?? [];

  const ms = new MagicString(code);
  const script = findTag("script", code);
  const style = findTag("style", code);
  const tag = script?.tag ?? name;

  if (script) {
    const openingIndex = code.indexOf(script.opening);
    const closingIndex = code.indexOf(script.closing);
    ms.overwrite(openingIndex, openingIndex + script.opening.length, "");
    ms.overwrite(closingIndex, closingIndex + script.closing.length, `;(<>`);
    ms.append("\n</>);");
  }

  if (style) {
    ms.replace(style.fullContent, "");
  }

  // TODO: find a better way to create syntax for `style:width.px`.
  let match: RegExpExecArray | null;
  const unsuportedAttr =
    /(((on|bind):[\w-]+)|((class|style)(\.[\w-]+)))(\|\w+)?=['"{]/g;
  while ((match = unsuportedAttr.exec(code))) {
    const [, , , , , , field, filter] = match;
    [field, filter].filter((word) => {
      if (word) {
        const index = code.indexOf(word, match?.index);
        ms.remove(index, index + word.length);
      }
    });
  }

  return {
    tag,
    code: ms.toString(),
    map: ms.generateMap({
      hires: true,
      source: filepath,
      file: filepath + ".map",
      includeContent: true,
    }),
  };
}
