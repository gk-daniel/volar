import type { Range } from 'vscode-languageserver';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { SourceFile } from '../sourceFiles';
import { MapedMode } from '../utils/sourceMaps';
import { hyphenate } from '@vue/shared';
import * as globalServices from '../globalServices';
import * as html from 'vscode-html-languageservice';
import * as ts2 from '@volar/vscode-typescript-languageservice';
import { rfc } from '../virtuals/scriptSetup';

type TokenData = [number, number, number, number, number | undefined];

const tsLegend = ts2.getSemanticTokenLegend();
const tokenTypesLegend = [
	...tsLegend.types,
	'componentTag',
	'conditionalDirective',
	'loopDirective',
	'refLabel',
	'refVariable',
	'refVariableRaw',
];
const tokenTypes = new Map(tokenTypesLegend.map((t, i) => [t, i]));

export const semanticTokenLegend = {
	types: tokenTypesLegend,
	modifiers: tsLegend.modifiers,
};

export function register(sourceFiles: Map<string, SourceFile>, tsLanguageService: ts2.LanguageService) {
	return async (document: TextDocument, range: Range) => {
		const sourceFile = sourceFiles.get(document.uri);
		if (!sourceFile) return;
		const offsetRange = {
			start: document.offsetAt(range.start),
			end: document.offsetAt(range.end),
		};
		const templateScriptData = sourceFile.getTemplateScriptData();
		const components = new Set([
			...templateScriptData.components,
			...templateScriptData.components.map(hyphenate),
			...templateScriptData.context,
			...templateScriptData.context.map(hyphenate),
		]);

		const htmlResult = getHtmlResult(sourceFile);
		const pugResult = getPugResult(sourceFile);
		const scriptSetupResult = rfc === '#222' ? getScriptSetupResult(sourceFile) : [];
		// const tsResult = await getTsResult(sourceFile); // TODO: inconsistent with typescript-language-features

		return [
			...htmlResult,
			...pugResult,
			...scriptSetupResult,
			// ...tsResult,
		];

		function getScriptSetupResult(sourceFile: SourceFile) {
			const result: TokenData[] = [];
			const scriptSetupGen = sourceFile.getScriptSetupData();
			const scriptSetup = sourceFile.getDescriptor().scriptSetup;
			if (scriptSetupGen && scriptSetup) {
				const genData = scriptSetupGen.data;
				for (const label of genData.labels) {
					const labelPos = document.positionAt(scriptSetup.loc.start + label.label.start);
					result.push([labelPos.line, labelPos.character, label.label.end - label.label.start + 1, tokenTypes.get('refLabel') ?? -1, undefined]);
					for (const _var of label.vars) {
						const varPos = document.positionAt(scriptSetup.loc.start + _var.start);
						result.push([varPos.line, varPos.character, _var.end - _var.start, tokenTypes.get('refVariable') ?? -1, undefined]);
						for (const reference of _var.references) {
							const referencePos = document.positionAt(scriptSetup.loc.start + reference.start);
							result.push([referencePos.line, referencePos.character, reference.end - reference.start, tokenTypes.get('refVariable') ?? -1, undefined]);
						}
					}
				}
			}
			return result;
		}
		async function getTsResult(sourceFile: SourceFile) {
			const result: TokenData[] = [];
			for (const sourceMap of sourceFile.getTsSourceMaps()) {
				for (const maped of sourceMap) {
					if (!maped.data.capabilities.semanticTokens)
						continue;
					if (maped.sourceRange.end < offsetRange.start)
						continue;
					if (maped.sourceRange.start > offsetRange.end)
						continue;
					const tsRange = {
						start: sourceMap.targetDocument.positionAt(maped.targetRange.start),
						end: sourceMap.targetDocument.positionAt(maped.targetRange.end),
					};
					const tokens = await tsLanguageService.getDocumentSemanticTokens(sourceMap.targetDocument, tsRange);
					if (!tokens) continue;
					for (const token of tokens) {
						const tokenOffset = sourceMap.targetDocument.offsetAt(token.start);
						const vueOffset = tokenOffset - maped.targetRange.start + maped.sourceRange.start;
						const vuePos = document.positionAt(vueOffset);
						result.push([vuePos.line, vuePos.character, token.length, token.typeIdx, token.modifierSet]);
					}
				}
			}
			return result;
		}
		function getHtmlResult(sourceFile: SourceFile) {
			const result: TokenData[] = [];

			for (const sourceMap of sourceFile.getHtmlSourceMaps()) {
				for (const maped of sourceMap) {
					if (maped.mode !== MapedMode.Offset)
						continue;
					if (maped.sourceRange.end < offsetRange.start)
						continue;
					if (maped.sourceRange.start > offsetRange.end)
						continue;
					const docText = sourceMap.targetDocument.getText();
					const scanner = globalServices.html.createScanner(docText, maped.targetRange.start);
					let token = scanner.scan();
					while (token !== html.TokenType.EOS && scanner.getTokenEnd() <= maped.targetRange.end) {
						const tokenOffset = scanner.getTokenOffset();
						const tokenLength = scanner.getTokenLength();
						const tokenText = docText.substr(tokenOffset, tokenLength);
						const vueOffset = tokenOffset - maped.targetRange.start + maped.sourceRange.start;
						if (isConditionalToken(token, tokenText)) {
							const vuePos = sourceMap.sourceDocument.positionAt(vueOffset);
							result.push([vuePos.line, vuePos.character, tokenLength, tokenTypes.get('conditionalDirective') ?? -1, undefined]);
						}
						else if (isLoopToken(token, tokenText)) {
							const vuePos = sourceMap.sourceDocument.positionAt(vueOffset);
							result.push([vuePos.line, vuePos.character, tokenLength, tokenTypes.get('loopDirective') ?? -1, undefined]);
						}
						else if (isComponentToken(token, tokenText)) {
							const vuePos = sourceMap.sourceDocument.positionAt(vueOffset);
							result.push([vuePos.line, vuePos.character, tokenLength, tokenTypes.get('componentTag') ?? -1, undefined]);
						}
						token = scanner.scan();
					}
				}
			}

			return result;
		}
		function getPugResult(sourceFile: SourceFile) {
			const result: TokenData[] = [];

			for (const sourceMap of sourceFile.getPugSourceMaps()) {
				if (sourceMap.html === undefined) continue;
				for (const maped of sourceMap) {
					if (maped.mode !== MapedMode.Offset)
						continue;
					if (maped.sourceRange.end < offsetRange.start)
						continue;
					if (maped.sourceRange.start > offsetRange.end)
						continue;
					const docText = sourceMap.html;
					const scanner = globalServices.html.createScanner(docText, 0);
					let token = scanner.scan();
					while (token !== html.TokenType.EOS) {
						const htmlOffset = scanner.getTokenOffset();
						const tokenLength = scanner.getTokenLength();
						const tokenText = docText.substr(htmlOffset, tokenLength);
						if (isConditionalToken(token, tokenText)) {
							const vuePos = getTokenPosition(htmlOffset, tokenText);
							if (vuePos) result.push([vuePos.line, vuePos.character, tokenLength, tokenTypes.get('conditionalDirective') ?? -1, undefined]);
						}
						else if (isLoopToken(token, tokenText)) {
							const vuePos = getTokenPosition(htmlOffset, tokenText);
							if (vuePos) result.push([vuePos.line, vuePos.character, tokenLength, tokenTypes.get('loopDirective') ?? -1, undefined]);
						}
						else if (isComponentToken(token, tokenText)) {
							const vuePos = getTokenPosition(htmlOffset, tokenText);
							if (vuePos) result.push([vuePos.line, vuePos.character, tokenLength, tokenTypes.get('componentTag') ?? -1, undefined]);
						}
						token = scanner.scan();
					}

					function getTokenPosition(htmlOffset: number, tokenText: string) {
						const tokenOffset = sourceMap.mapper?.(tokenText, htmlOffset);
						if (tokenOffset !== undefined) {
							const vueOffset = tokenOffset - maped.targetRange.start + maped.sourceRange.start;
							const vuePos = document.positionAt(vueOffset);
							return vuePos;
						}
					}
				}
			}

			return result;
		}
		function isComponentToken(token: html.TokenType, tokenText: string) {
			if (token === html.TokenType.StartTag || token === html.TokenType.EndTag) {
				if (components.has(tokenText)) {
					return true;
				}
			}
			return false;
		}
		function isLoopToken(token: html.TokenType, tokenText: string) {
			if (token === html.TokenType.AttributeName) {
				if (tokenText === 'v-for') {
					return true;
				}
			}
			return false;
		}
		function isConditionalToken(token: html.TokenType, tokenText: string) {
			if (token === html.TokenType.AttributeName) {
				if (['v-if', 'v-else-if', 'v-else'].includes(tokenText)) {
					return true;
				}
			}
			return false;
		}
	}
}
