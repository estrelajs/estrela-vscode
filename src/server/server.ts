import {
  ApplyWorkspaceEditParams,
  ApplyWorkspaceEditRequest,
  CodeActionKind,
  createConnection,
  DidChangeWatchedFilesParams,
  IPCMessageReader,
  IPCMessageWriter,
  MessageType,
  RenameFile,
  RequestType,
  ShowMessageNotification,
  TextDocumentIdentifier,
  TextDocumentPositionParams,
  TextDocumentSyncKind,
  WorkspaceEdit,
} from "vscode-languageserver/node";
import { DiagnosticsManager } from "./lib/DiagnosticsManager";
import { Document, DocumentManager } from "./lib/documents";
import { getSemanticTokenLegends } from "./lib/semanticTokenLegend";
import { Logger } from "./logger";
import { LSConfigManager } from "./ls-config";
import {
  AppCompletionItem,
  CSSPlugin,
  HTMLPlugin,
  LSAndTSDocResolver,
  OnWatchFileChangesPara,
  PluginHost,
  TypeScriptPlugin,
} from "./plugins";
import { debounceThrottle, normalizeUri, urlToPath } from "./utils";

namespace TagCloseRequest {
  export const type: RequestType<
    TextDocumentPositionParams,
    string | null,
    any
  > = new RequestType("html/tag");
}

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
  pluginHost.register(
    new TypeScriptPlugin(
      configManager,
      new LSAndTSDocResolver(
        docManager,
        workspaceUris.map(normalizeUri),
        configManager,
        notifyTsServiceExceedSizeLimit
      )
    )
  );

  const clientSupportApplyEditCommand = !!evt.capabilities.workspace?.applyEdit;

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
        triggerCharacters: [
          ".",
          '"',
          "'",
          "`",
          "/",
          "@",
          "<",
          // Emmet
          ">",
          "*",
          "#",
          "$",
          "+",
          "^",
          "(",
          "[",
          "@",
          "-",
        ],
      },
      documentFormattingProvider: true,
      colorProvider: true,
      documentSymbolProvider: true,
      definitionProvider: true,
      codeActionProvider: evt.capabilities.textDocument?.codeAction
        ?.codeActionLiteralSupport
        ? {
            codeActionKinds: [
              CodeActionKind.QuickFix,
              CodeActionKind.SourceOrganizeImports,
              ...(clientSupportApplyEditCommand
                ? [CodeActionKind.Refactor]
                : []),
            ],
          }
        : true,
      executeCommandProvider: clientSupportApplyEditCommand
        ? {
            commands: [
              "function_scope_0",
              "function_scope_1",
              "function_scope_2",
              "function_scope_3",
              "constant_scope_0",
              "constant_scope_1",
              "constant_scope_2",
              "constant_scope_3",
              "Infer function return type",
            ],
          }
        : undefined,
      renameProvider: evt.capabilities.textDocument?.rename?.prepareSupport
        ? { prepareProvider: true }
        : true,
      referencesProvider: true,
      selectionRangeProvider: true,
      signatureHelpProvider: {
        triggerCharacters: ["(", ",", "<"],
        retriggerCharacters: [")"],
      },
      semanticTokensProvider: {
        legend: getSemanticTokenLegends(),
        range: true,
        full: true,
      },
      linkedEditingRangeProvider: true,
      implementationProvider: true,
      typeDefinitionProvider: true,
    },
  };
});

function notifyTsServiceExceedSizeLimit() {
  connection?.sendNotification(ShowMessageNotification.type, {
    message:
      "Estrela language server detected a large amount of JS/Estrela files. " +
      "To enable project-wide JavaScript/TypeScript language features for Estrela files," +
      "exclude large folders in the tsconfig.json or jsconfig.json with source files that you do not work on.",
    type: MessageType.Warning,
  });
}

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
  configManager.updateTsJsUserPreferences(settings);
  configManager.updateEmmetConfig(settings.emmet);
  configManager.updatePrettierConfig(settings.prettier);
  configManager.updateCssConfig(settings.css);
  configManager.updateScssConfig(settings.scss);
  configManager.updateLessConfig(settings.less);
});

// code listeners
connection.onColorPresentation((evt) =>
  pluginHost.getColorPresentations(evt.textDocument, evt.range, evt.color)
);
connection.onCompletion((evt, cancellationToken) =>
  pluginHost.getCompletions(
    evt.textDocument,
    evt.position,
    evt.context,
    cancellationToken
  )
);
connection.onCompletionResolve((completionItem, cancellationToken) => {
  const data = (completionItem as AppCompletionItem)
    .data as TextDocumentIdentifier;
  if (!data) {
    return completionItem;
  }
  return pluginHost.resolveCompletion(data, completionItem, cancellationToken);
});
connection.onDefinition((evt) =>
  pluginHost.getDefinitions(evt.textDocument, evt.position)
);
connection.onDocumentColor((evt) =>
  pluginHost.getDocumentColors(evt.textDocument)
);
connection.onDocumentFormatting((evt) =>
  pluginHost.formatDocument(evt.textDocument, evt.options)
);
connection.onDocumentSymbol((evt, cancellationToken) =>
  pluginHost.getDocumentSymbols(evt.textDocument, cancellationToken)
);
connection.onHover((evt) => pluginHost.doHover(evt.textDocument, evt.position));
connection.onImplementation((evt) =>
  pluginHost.getImplementation(evt.textDocument, evt.position)
);
connection.onReferences((evt) =>
  pluginHost.findReferences(evt.textDocument, evt.position, evt.context)
);
connection.onRequest(TagCloseRequest.type, (evt) =>
  pluginHost.doTagComplete(evt.textDocument, evt.position)
);
connection.onSelectionRanges((evt) =>
  pluginHost.getSelectionRanges(evt.textDocument, evt.positions)
);
connection.onSignatureHelp((evt, cancellationToken) =>
  pluginHost.getSignatureHelp(
    evt.textDocument,
    evt.position,
    evt.context,
    cancellationToken
  )
);
connection.onTypeDefinition((evt) =>
  pluginHost.getTypeDefinition(evt.textDocument, evt.position)
);

// diagnostic listener
const diagnosticsManager = new DiagnosticsManager(
  connection.sendDiagnostics,
  docManager,
  pluginHost.getDiagnostics.bind(pluginHost)
);

const updateAllDiagnostics = debounceThrottle(
  () => diagnosticsManager.updateAll(),
  1000
);

connection.onDidChangeWatchedFiles(onDidChangeWatchedFiles);
function onDidChangeWatchedFiles(para: DidChangeWatchedFilesParams) {
  const onWatchFileChangesParas = para.changes
    .map((change) => ({
      fileName: urlToPath(change.uri),
      changeType: change.type,
    }))
    .filter((change): change is OnWatchFileChangesPara => !!change.fileName);

  pluginHost.onWatchFileChanges(onWatchFileChangesParas);

  updateAllDiagnostics();
}

connection.onDidSaveTextDocument(updateAllDiagnostics);
connection.onNotification("$/onDidChangeTsOrJsFile", async (e: any) => {
  const path = urlToPath(e.uri);
  if (path) {
    pluginHost.updateTsOrJsFile(path, e.changes);
  }
  updateAllDiagnostics();
});

docManager.on(
  "documentChange",
  debounceThrottle(
    async (document: Document) => diagnosticsManager.update(document),
    750
  )
);
docManager.on("documentClose", (document: Document) =>
  diagnosticsManager.removeDiagnostics(document)
);

// actions listeners
connection.onCodeAction((evt, cancellationToken) =>
  pluginHost.getCodeActions(
    evt.textDocument,
    evt.range,
    evt.context,
    cancellationToken
  )
);
connection.onExecuteCommand(async (evt) => {
  const result = await pluginHost.executeCommand(
    { uri: evt.arguments?.[0] },
    evt.command,
    evt.arguments
  );
  if (WorkspaceEdit.is(result)) {
    const edit: ApplyWorkspaceEditParams = { edit: result };
    connection?.sendRequest(ApplyWorkspaceEditRequest.type.method, edit);
  } else if (result) {
    connection?.sendNotification(ShowMessageNotification.type.method, {
      message: result,
      type: MessageType.Error,
    });
  }
});

// rename listeners
connection.onPrepareRename((req) =>
  pluginHost.prepareRename(req.textDocument, req.position)
);
connection.onRenameRequest((req) =>
  pluginHost.rename(req.textDocument, req.position, req.newName)
);

// The language server protocol does not have a specific "did rename/move files" event,
// so we create our own in the extension client and handle it here
connection.onRequest(
  "$/getEditsForFileRename",
  async (fileRename: RenameFile) => pluginHost.updateImports(fileRename)
);

// Listen on the connection
connection.listen();
