import { TextDocument } from "vscode-languageserver-textdocument";
import {
  createConnection,
  InitializeParams,
  ProposedFeatures,
  TextDocuments,
  TextDocumentSyncKind,
} from "vscode-languageserver/node";
import { getSemanticTokenLegends } from "./semanticToken.legend";

// Create a connection for the server. The connection uses Node's IPC as a transport.
// Also include all preview / proposed LSP features.
const connection = createConnection(ProposedFeatures.all);

// Create a simple text document manager. The text document manager
// supports full document sync only
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

connection.onInitialize((_params: InitializeParams) => {
  return {
    capabilities: {
      textDocumentSync: {
        openClose: true,
        change: TextDocumentSyncKind.Incremental,
        save: {
          includeText: false,
        },
      },
      // codeLensProvider: {
      //   resolveProvider: true,
      // },
      // colorProvider: true,
      completionProvider: {
        resolveProvider: true,
        triggerCharacters: [".", ":"],
      },
      declarationProvider: true,
      definitionProvider: true,
      documentLinkProvider: {
        resolveProvider: true,
      },
      documentSymbolProvider: true,
      hoverProvider: true,
      implementationProvider: true,
      // linkedEditingRangeProvider: true,
      referencesProvider: true,
      renameProvider: true,
      // semanticTokensProvider: {
      //   legend: getSemanticTokenLegends(),
      //   range: true,
      //   full: true,
      // },
      // signatureHelpProvider: {
      //   triggerCharacters: ["(", ",", "<"],
      //   retriggerCharacters: [")"],
      // },
      typeDefinitionProvider: true,
      // workspaceSymbolProvider: true,
    },
  };
});

documents.listen(connection);
connection.listen();
