import * as path from "path";
import * as vscode from "vscode";
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from "vscode-languageclient";

let client: LanguageClient;

export function activate(context: vscode.ExtensionContext) {
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

  const originalDocuments = new Map<string, vscode.TextDocument>();

  const getEmbeddedUri = (
    document: vscode.TextDocument,
    ext = "tsx"
  ): vscode.Uri => {
    const originalUri = document.uri.toString();
    const encodedUri = encodeURIComponent(originalUri);
    const virtualPath = `embedded-content://${ext}/${encodedUri}.${ext}`;
    const virtualUri = vscode.Uri.parse(virtualPath);
    originalDocuments.set(virtualUri.path, document);
    return virtualUri;
  };

  const getTsContent = (document: vscode.TextDocument): string => {
    const content = document.getText();
    const newLineIndex = content.indexOf("\n");
    const styleStartIndex = content.indexOf("<style");
    const scriptEndIndex = content.indexOf("</script>");
    const codeSection = content.slice(newLineIndex, scriptEndIndex);
    const templateSection = content.slice(scriptEndIndex + 9, styleStartIndex);
    return `${codeSection}<>${templateSection}</>`;
  };

  vscode.workspace.registerTextDocumentContentProvider("embedded-content", {
    provideTextDocumentContent: (uri) => {
      const document = originalDocuments.get(uri.path);
      return getTsContent(document);
    },
  });

  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: "file", language: "estrela" }],
    middleware: {
      // provideCodeLenses: async (document) => {
      //   const virtualUri = getEmbeddedUri(document);
      //   const result = await vscode.commands.executeCommand<vscode.CodeLens[]>(
      //     "vscode.executeCodeLensProvider",
      //     virtualUri
      //   );
      //   return result;
      // },
      provideCompletionItem: async (document, position, context) => {
        const virtualUri = getEmbeddedUri(document);
        const result =
          await vscode.commands.executeCommand<vscode.CompletionList>(
            "vscode.executeCompletionItemProvider",
            virtualUri,
            position,
            context.triggerCharacter
          );
        return result;
      },
      provideDeclaration: async (document, position) => {
        const virtualUri = getEmbeddedUri(document);
        const [declaration] = await vscode.commands.executeCommand<
          vscode.Declaration[]
        >("vscode.executeDeclarationProvider", virtualUri, position);
        return declaration;
      },
      provideDefinition: async (document, position) => {
        const virtualUri = getEmbeddedUri(document);
        const result = await vscode.commands.executeCommand<
          vscode.DefinitionLink[]
        >("vscode.executeDefinitionProvider", virtualUri, position);
        return result.map((definition) => {
          // const document = originalDocuments.get(definition.targetUri.path);
          // if (document) {
          //   definition.targetUri = document.uri;
          // }
          return definition;
        });
      },
      provideDocumentLinks: async (document) => {
        const virtualUri = getEmbeddedUri(document);
        const result = await vscode.commands.executeCommand<
          vscode.DocumentSymbol[]
        >("vscode.executeLinkProvider", virtualUri);
        return result;
      },
      provideDocumentSymbols: async (document) => {
        const virtualUri = getEmbeddedUri(document);
        const result = await vscode.commands.executeCommand<
          vscode.DocumentSymbol[]
        >("vscode.executeDocumentSymbolProvider", virtualUri);
        if (!result) {
          return [];
        }
        return result.map((docSymbol: any) => {
          if (docSymbol.location) {
            const document = originalDocuments.get(docSymbol.location.uri.path);
            if (document) {
              docSymbol.location.uri = document.uri;
            }
          }
          return docSymbol;
        });
      },
      provideHover: async (document, position) => {
        const virtualUri = getEmbeddedUri(document);
        const result = await vscode.commands.executeCommand<
          vscode.Hover | vscode.Hover[]
        >("vscode.executeHoverProvider", virtualUri, position);
        return Array.isArray(result) ? result[0] : result;
      },
      provideImplementation: async (document, position) => {
        const virtualUri = getEmbeddedUri(document);
        const result = await vscode.commands.executeCommand<
          vscode.DefinitionLink[]
        >("vscode.executeImplementationProvider", virtualUri, position);
        return result.map((definition) => {
          const document = originalDocuments.get(definition.targetUri.path);
          if (document) {
            definition.targetUri = document.uri;
          }
          return definition;
        });
      },
      provideReferences: async (document, position) => {
        const virtualUri = getEmbeddedUri(document);
        const result = await vscode.commands.executeCommand<vscode.Location[]>(
          "vscode.executeReferenceProvider",
          virtualUri,
          position
        );
        return result.map((location) => {
          const document = originalDocuments.get(location.uri.path);
          if (document) {
            location.uri = document.uri;
          }
          return location;
        });
      },
      prepareRename: async (document, position) => {
        const virtualUri = getEmbeddedUri(document);
        const result = await vscode.commands.executeCommand<vscode.Range>(
          "vscode.prepareRename",
          virtualUri,
          position
        );
        return result;
      },
      provideRenameEdits: async (document, position, newName) => {
        const virtualUri = getEmbeddedUri(document);
        const result =
          await vscode.commands.executeCommand<vscode.WorkspaceEdit>(
            "vscode.executeDocumentRenameProvider",
            virtualUri,
            position,
            newName
          );
        return result;
      },
      provideTypeDefinition: async (document, position) => {
        const virtualUri = getEmbeddedUri(document);
        const result = await vscode.commands.executeCommand<vscode.Definition>(
          "vscode.executeTypeDefinitionProvider",
          virtualUri,
          position
        );
        return result;
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
  return client?.stop();
}
