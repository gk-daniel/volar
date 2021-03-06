/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import {
	ProposedFeatures,
	InitializeParams,
	TextDocumentSyncKind,
	InitializeResult,
	createConnection,
	TextDocumentRegistrationOptions,
	DocumentHighlightRequest,
	DocumentSymbolRequest,
	DocumentLinkRequest,
	DocumentColorRequest,
	FoldingRangeRequest,
} from 'vscode-languageserver';
import { createLanguageServiceHost } from './languageServiceHost';
import { TextDocuments } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { getSemanticTokensLegend, setScriptSetupRfc } from '@volar/vscode-vue-languageservice';
import {
	uriToFsPath,
	VerifyAllScriptsRequest,
	SemanticTokensRequest,
	SemanticTokenLegendRequest,
	WriteAllDebugFilesRequest,
} from '@volar/shared';
import * as upath from 'upath';
import * as fs from 'fs-extra';

export const connection = createConnection(ProposedFeatures.all);
connection.onInitialize(onInitialize);
connection.onInitialized(onInitialized);
const documents = new TextDocuments(TextDocument);
documents.listen(connection);
connection.listen();

function onInitialize(params: InitializeParams) {
	if (params.rootPath) {
		setScriptSetupRfc(params.initializationOptions.scriptSetupRfc);
		initLanguageService(params.rootPath);
	}
	const result: InitializeResult = {
		capabilities: {
			textDocumentSync: TextDocumentSyncKind.Full,
		}
	};
	return result;
}
function initLanguageService(rootPath: string) {
	const host = createLanguageServiceHost(connection, documents, rootPath, true, true);

	connection.onRequest(WriteAllDebugFilesRequest.type, async () => {
		const progress = await connection.window.createWorkDoneProgress();
		progress.begin('Write', 0, '', true);
		for (const [uri, service] of host.services) {
			const sourceFiles = service.languageService.getAllSourceFiles();
			let i = 0;
			for (const sourceFile of sourceFiles) {
				for (const [uri, doc] of sourceFile.getTsDocuments()) {
					if (progress.token.isCancellationRequested) {
						continue;
					}
					await fs.writeFile(uriToFsPath(uri), doc.getText(), "utf8");
				}
				progress.report(i++ / sourceFiles.length * 100, upath.relative(service.languageService.rootPath, sourceFile.fileName));
			}
		}
		progress.done();
	});
	connection.onRequest(VerifyAllScriptsRequest.type, async () => {
		const progress = await connection.window.createWorkDoneProgress();
		progress.begin('Verify', 0, '', true);
		for (const [uri, service] of host.services) {
			const sourceFiles = service.languageService.getAllSourceFiles();
			let i = 0;
			for (const sourceFile of sourceFiles) {
				if (progress.token.isCancellationRequested) {
					continue;
				}
				const doc = sourceFile.getTextDocument();
				const diags = await service.languageService.doValidation(doc) ?? [];
				connection.sendDiagnostics({ uri: doc.uri, diagnostics: diags });
				progress.report(i++ / sourceFiles.length * 100, upath.relative(service.languageService.rootPath, sourceFile.fileName));
			}
		}
		progress.done();
	});
	connection.onRequest(SemanticTokensRequest.type, async handler => {
		const document = documents.get(handler.textDocument.uri);
		if (!document) return;
		return await host.get(document.uri)?.getSemanticTokens(document, handler.range);
	});
	connection.onRequest(SemanticTokenLegendRequest.type, () => {
		return getSemanticTokensLegend();
	});

	connection.onDocumentColor(handler => {
		const document = documents.get(handler.textDocument.uri);
		if (!document) return undefined;
		return host.get(document.uri)?.findDocumentColors(document);
	});
	connection.onColorPresentation(handler => {
		const document = documents.get(handler.textDocument.uri);
		if (!document) return undefined;
		return host.get(document.uri)?.getColorPresentations(document, handler.color, handler.range);
	});
	connection.onDocumentHighlight(handler => {
		const document = documents.get(handler.textDocument.uri);
		if (!document) return undefined;
		return host.get(document.uri)?.findDocumentHighlights(document, handler.position);
	});
	connection.onDocumentSymbol(handler => {
		const document = documents.get(handler.textDocument.uri);
		if (!document) return undefined;
		return host.get(document.uri)?.findDocumentSymbols(document);
	});
	connection.onDocumentLinks(handler => {
		const document = documents.get(handler.textDocument.uri);
		if (!document) return undefined;
		return host.get(document.uri)?.findDocumentLinks(document);
	});
	connection.onFoldingRanges(handler => {
		const document = documents.get(handler.textDocument.uri);
		if (!document) return undefined;
		return host.get(document.uri)?.getFoldingRanges(document);
	});
}
function onInitialized() {
	const vueOnly: TextDocumentRegistrationOptions = {
		documentSelector: [{ language: 'vue' }],
	};

	connection.client.register(DocumentHighlightRequest.type, vueOnly);
	connection.client.register(DocumentSymbolRequest.type, vueOnly);
	connection.client.register(DocumentLinkRequest.type, vueOnly);
	connection.client.register(DocumentColorRequest.type, vueOnly);
	connection.client.register(FoldingRangeRequest.type, vueOnly);
}
