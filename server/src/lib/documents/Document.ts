import { urlToPath } from "../../utils";
import { WritableDocument } from "./DocumentBase";
import {
  extractScriptTags,
  extractStyleTag,
  extractTemplateTag,
  TagInformation,
} from "./utils";
import { parseHtml } from "./parseHtml";
import { HTMLDocument } from "vscode-html-languageservice";

/**
 * Represents a text document contains a svelte component.
 */
export class Document extends WritableDocument {
  languageId = "estrela";
  scriptInfo: TagInformation | null = null;
  moduleScriptInfo: TagInformation | null = null;
  styleInfo: TagInformation | null = null;
  templateInfo: TagInformation | null = null;
  html!: HTMLDocument;
  /**
   * Compute and cache directly because of performance reasons
   * and it will be called anyway.
   */
  private path = urlToPath(this.url);

  constructor(public url: string, public content: string) {
    super();
    this.updateDocInfo();
  }

  private updateDocInfo() {
    this.html = parseHtml(this.content);
    const scriptTags = extractScriptTags(this.content, this.html);
    this.scriptInfo = this.addDefaultLanguage(
      scriptTags?.script || null,
      "script"
    );
    this.moduleScriptInfo = this.addDefaultLanguage(
      scriptTags?.moduleScript || null,
      "script"
    );
    this.styleInfo = this.addDefaultLanguage(
      extractStyleTag(this.content, this.html),
      "style"
    );
    this.templateInfo = this.addDefaultLanguage(
      extractTemplateTag(this.content, this.html),
      "markup"
    );
  }

  /**
   * Get text content
   */
  getText(): string {
    return this.content;
  }

  /**
   * Set text content and increase the document version
   */
  setText(text: string) {
    this.content = text;
    this.version++;
    this.lineOffsets = undefined;
    this.updateDocInfo();
  }

  /**
   * Returns the file path if the url scheme is file
   */
  getFilePath(): string | null {
    return this.path;
  }

  /**
   * Get URL file path.
   */
  getURL() {
    return this.url;
  }

  /**
   * Returns the language associated to script, style or template.
   * Returns an empty string if there's nothing set.
   */
  getLanguageAttribute(tag: "script" | "style" | "template"): string {
    const attrs =
      (tag === "style"
        ? this.styleInfo?.attributes
        : tag === "script"
        ? this.scriptInfo?.attributes || this.moduleScriptInfo?.attributes
        : this.templateInfo?.attributes) || {};
    const lang = attrs.lang || attrs.type || "";
    return lang.replace(/^text\//, "");
  }

  private addDefaultLanguage(
    tagInfo: TagInformation | null,
    tag: "style" | "script" | "markup"
  ): TagInformation | null {
    if (!tagInfo) {
      return tagInfo;
    }

    const langs = {
      markup: "html",
      script: "tsx",
      style: "css",
    };

    const defaultLang = langs[tag];
    if (!tagInfo.attributes.lang && !tagInfo.attributes.type && defaultLang) {
      tagInfo.attributes.lang = defaultLang;
    }

    return tagInfo;
  }
}
