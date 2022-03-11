/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as path from "path";
import {
  commands,
  CompletionList,
  ExtensionContext,
  Uri,
  workspace,
} from "vscode";
import { getLanguageService, TokenType } from "vscode-html-languageservice";
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from "vscode-languageclient";
import { getVirtualContent, isInsideTagRegion } from "./embeddedSupport";

let client: LanguageClient;

const htmlLanguageService = getLanguageService();

export function activate(context: ExtensionContext) {
  // The server is implemented in node
  const serverModule = context.asAbsolutePath(
    path.join("server", "out", "server.js")
  );
  // The debug options for the server
  // --inspect=6009: runs the server in Node's Inspector mode so VS Code can attach to the server for debugging
  const debugOptions = { execArgv: ["--nolazy", "--inspect=6009"] };

  // If the extension is launched in debug mode then the debug server options are used
  // Otherwise the run options are used
  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: debugOptions,
    },
  };

  const virtualDocumentContents = new Map<string, string>();

  workspace.registerTextDocumentContentProvider("embedded-content", {
    provideTextDocumentContent: (uri) => {
      const originalUri = uri.path.slice(1).slice(0, -4);
      const decodedUri = decodeURIComponent(originalUri);
      return virtualDocumentContents.get(decodedUri);
    },
  });

  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: "file", language: "estrela" }],
    middleware: {
      provideCompletionItem: async (
        document,
        position,
        context,
        token,
        next
      ) => {
        if (
          isInsideTagRegion(
            TokenType.Styles,
            htmlLanguageService,
            document.getText(),
            document.offsetAt(position)
          )
        ) {
          const originalUri = document.uri.toString();
          virtualDocumentContents.set(
            originalUri,
            getVirtualContent("css", htmlLanguageService, document.getText())
          );

          const vdocUriString = `embedded-content://css/${encodeURIComponent(
            originalUri
          )}.css`;
          const vdocUri = Uri.parse(vdocUriString);
          return await commands.executeCommand<CompletionList>(
            "vscode.executeCompletionItemProvider",
            vdocUri,
            position,
            context.triggerCharacter
          );
        }

        if (
          isInsideTagRegion(
            TokenType.Script,
            htmlLanguageService,
            document.getText(),
            document.offsetAt(position)
          )
        ) {
          const originalUri = document.uri.toString();
          virtualDocumentContents.set(
            originalUri,
            getVirtualContent("ts", htmlLanguageService, document.getText())
          );

          const vdocUriString = `embedded-content://typescript/${encodeURIComponent(
            originalUri
          )}.ts`;
          const vdocUri = Uri.parse(vdocUriString);
          return await commands.executeCommand<CompletionList>(
            "vscode.executeCompletionItemProvider",
            vdocUri,
            position,
            context.triggerCharacter
          );
        }

        return await next(document, position, context, token);
      },
    },
  };

  // Create the language client and start the client.
  client = new LanguageClient(
    "estrela",
    "Estrela",
    serverOptions,
    clientOptions
  );

  // Start the client. This will also launch the server
  client.start();
}

export function deactivate(): Thenable<void> | undefined {
  if (!client) {
    return undefined;
  }
  return client.stop();
}
