import * as ts from 'typescript';
import * as PConst from '../protocol.const';
import {
	TextDocument,
	Range,
	SymbolInformation,
	SymbolKind,
} from 'vscode-languageserver';
import { parseKindModifier } from '../utils/modifiers';
import { uriToFsPath } from '@volar/shared';

function getSymbolKind(item: ts.NavigationBarItem): SymbolKind {
	switch (item.kind) {
		case PConst.Kind.module: return SymbolKind.Module;
		case PConst.Kind.method: return SymbolKind.Method;
		case PConst.Kind.enum: return SymbolKind.Enum;
		case PConst.Kind.enumMember: return SymbolKind.EnumMember;
		case PConst.Kind.function: return SymbolKind.Function;
		case PConst.Kind.class: return SymbolKind.Class;
		case PConst.Kind.interface: return SymbolKind.Interface;
		case PConst.Kind.type: return SymbolKind.Class;
		case PConst.Kind.memberVariable: return SymbolKind.Field;
		case PConst.Kind.memberGetAccessor: return SymbolKind.Field;
		case PConst.Kind.memberSetAccessor: return SymbolKind.Field;
		case PConst.Kind.variable: return SymbolKind.Variable;
		default: return SymbolKind.Variable;
	}
}

export function register(languageService: ts.LanguageService) {
	return (document: TextDocument): SymbolInformation[] => {
		const fileName = uriToFsPath(document.uri);
		const barItems = languageService.getNavigationBarItems(fileName);
		const output: SymbolInformation[] = [];
		barItemsWorker(barItems);

		return output;

		function barItemsWorker(barItems: ts.NavigationBarItem[], parentName?: string) {
			for (const barItem of barItems) {
				barItemWorker(barItem, parentName);
			}
		}
		function barItemWorker(barItem: ts.NavigationBarItem, parentName?: string) {
			for (const span of barItem.spans) {
				const item = toSymbolInformation(barItem, span, parentName);
				output.push(item);
				barItemsWorker(barItem.childItems, barItem.text);
			}
		}
		function toSymbolInformation(item: ts.NavigationBarItem, span: ts.TextSpan, containerName?: string) {
			const label = getLabel(item);
			const info = SymbolInformation.create(
				label,
				getSymbolKind(item),
				Range.create(document.positionAt(span.start), document.positionAt(span.start + span.length)),
				document.uri,
				containerName,
			);
			const kindModifiers = item.kindModifiers ? parseKindModifier(item.kindModifiers) : undefined;
			if (kindModifiers?.has(PConst.KindModifiers.depreacted)) {
				info.deprecated = true;
			}
			return info;
		}
		function getLabel(item: ts.NavigationBarItem) {
			const label = item.text;
			if (item.kind === 'method' || item.kind === 'function') {
				return label + '()';
			}
			return label;
		}
	};
}
