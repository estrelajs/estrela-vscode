import { TextDocument } from "vscode-languageserver-textdocument";
import {
  CompletionItem,
  CompletionItemKind,
  createConnection,
  InitializeParams,
  ProposedFeatures,
  TextDocumentPositionParams,
  TextDocuments,
  TextDocumentSyncKind,
} from "vscode-languageserver/node";

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
      // declarationProvider: true,
      // definitionProvider: true,
      // documentLinkProvider: {
      //   resolveProvider: true,
      // },
      // documentSymbolProvider: true,
      // hoverProvider: true,
      // implementationProvider: true,
      // linkedEditingRangeProvider: true,
      // referencesProvider: true,
      // renameProvider: true,
      // semanticTokensProvider: {
      //   legend: getSemanticTokenLegends(),
      //   range: true,
      //   full: true,
      // },
      // signatureHelpProvider: {
      //   triggerCharacters: ["(", ",", "<"],
      //   retriggerCharacters: [")"],
      // },
      // typeDefinitionProvider: true,
      // workspaceSymbolProvider: true,
    },
  };
});

// This handler provides the initial list of the completion items.
connection.onCompletion(
  (_textDocumentPosition: TextDocumentPositionParams): CompletionItem[] => {
    // The pass parameter contains the position of the text document in
    // which code complete got requested. For the example we ignore this
    // info and always provide the same completion items.
    return [
      {
        label: "TypeScript",
        kind: CompletionItemKind.Text,
        data: 1,
      },
      {
        label: "JavaScript",
        kind: CompletionItemKind.Text,
        data: 2,
      },
    ];
  }
);

// This handler resolves additional information for the item selected in
// the completion list.
connection.onCompletionResolve((item: CompletionItem): CompletionItem => {
  if (item.data === 1) {
    item.detail = "TypeScript details";
    item.documentation = "TypeScript documentation";
  } else if (item.data === 2) {
    item.detail = "JavaScript details";
    item.documentation = "JavaScript documentation";
  }
  return item;
});

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();
