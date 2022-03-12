import {
  createConnection,
  IPCMessageReader,
  IPCMessageWriter,
  TextDocumentSyncKind,
} from "vscode-languageserver/node";
import { Document, DocumentManager } from "./lib/documents";
import { Logger } from "./logger";
import { LSConfigManager } from "./ls-config";
import { CSSPlugin, HTMLPlugin, PluginHost } from "./plugins";

// Create a connection for the server. The connection uses Node's IPC as a transport.
// Also include all preview / proposed LSP features.
const connection = createConnection(
  new IPCMessageReader(process),
  new IPCMessageWriter(process)
);

const docManager = new DocumentManager(
  (textDocument) => new Document(textDocument.uri, textDocument.text)
);
const configManager = new LSConfigManager();
const pluginHost = new PluginHost(docManager);

connection.onInitialize((evt) => {
  const workspaceUris = evt.workspaceFolders?.map((folder) =>
    folder.uri.toString()
  ) ?? [evt.rootUri ?? ""];

  Logger.log("Initialize language server at ", workspaceUris.join(", "));

  if (workspaceUris.length === 0) {
    Logger.error("No workspace path set");
  }

  const isTrusted: boolean = evt.initializationOptions?.isTrusted ?? true;
  configManager.updateIsTrusted(isTrusted);
  if (!isTrusted) {
    Logger.log("Workspace is not trusted, running with reduced capabilities.");
  }

  // get configurations
  configManager.update(
    evt.initializationOptions?.configuration?.svelte?.plugin ??
      evt.initializationOptions?.config ??
      {}
  );
  configManager.updateTsJsUserPreferences(
    evt.initializationOptions?.configuration ??
      evt.initializationOptions?.typescriptConfig ??
      {}
  );
  configManager.updateEmmetConfig(
    evt.initializationOptions?.configuration?.emmet ??
      evt.initializationOptions?.emmetConfig ??
      {}
  );
  configManager.updatePrettierConfig(
    evt.initializationOptions?.configuration?.prettier ??
      evt.initializationOptions?.prettierConfig ??
      {}
  );
  configManager.updateCssConfig(evt.initializationOptions?.configuration?.css);
  configManager.updateScssConfig(
    evt.initializationOptions?.configuration?.scss
  );
  configManager.updateLessConfig(
    evt.initializationOptions?.configuration?.less
  );

  // initialize plugin host
  pluginHost.initialize({
    filterIncompleteCompletions:
      !evt.initializationOptions?.dontFilterIncompleteCompletions,
    definitionLinkSupport:
      !!evt.capabilities.textDocument?.definition?.linkSupport,
  });
  pluginHost.register(new HTMLPlugin(docManager, configManager));
  pluginHost.register(new CSSPlugin(docManager, configManager));

  return {
    capabilities: {
      textDocumentSync: {
        openClose: true,
        change: TextDocumentSyncKind.Incremental,
        save: {
          includeText: false,
        },
      },
      hoverProvider: true,
      completionProvider: {
        resolveProvider: true,
        triggerCharacters: [".", ":"],
      },
      // documentFormattingProvider: true,
      // colorProvider: true,
      // documentSymbolProvider: true,
      // definitionProvider: true,
      // renameProvider: evt.capabilities.textDocument?.rename?.prepareSupport
      //   ? { prepareProvider: true }
      //   : true,
      // referencesProvider: true,
      // selectionRangeProvider: true,
      // signatureHelpProvider: {
      //   triggerCharacters: ["(", ",", "<"],
      //   retriggerCharacters: [")"],
      // },
      // semanticTokensProvider: {
      //     legend: getSemanticTokenLegends(),
      //     range: true,
      //     full: true
      // },
      // linkedEditingRangeProvider: true,
      // implementationProvider: true,
      // typeDefinitionProvider: true,
    },
  };
});

// documents listeners
connection.onDidOpenTextDocument((evt) => {
  docManager.openDocument(evt.textDocument);
  docManager.markAsOpenedInClient(evt.textDocument.uri);
});
connection.onDidCloseTextDocument((evt) =>
  docManager.closeDocument(evt.textDocument.uri)
);
connection.onDidChangeTextDocument((evt) => {
  docManager.updateDocument(evt.textDocument, evt.contentChanges);
  pluginHost.didUpdateDocument();
});

// configurations listener
connection.onDidChangeConfiguration(({ settings }) => {
  configManager.update(settings.svelte?.plugin);
  configManager.updateTsJsUserPreferences(settings);
  configManager.updateEmmetConfig(settings.emmet);
  configManager.updatePrettierConfig(settings.prettier);
  configManager.updateCssConfig(settings.css);
  configManager.updateScssConfig(settings.scss);
  configManager.updateLessConfig(settings.less);
});

// code listeners
connection.onHover((evt) => pluginHost.doHover(evt.textDocument, evt.position));
connection.onCompletion((evt, cancellationToken) =>
  pluginHost.getCompletions(
    evt.textDocument,
    evt.position,
    evt.context,
    cancellationToken
  )
);
connection.onDocumentSymbol((evt, cancellationToken) =>
  pluginHost.getDocumentSymbols(evt.textDocument, cancellationToken)
);

// Listen on the connection
connection.listen();
