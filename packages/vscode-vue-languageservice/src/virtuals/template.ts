import { Diagnostic } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { uriToFsPath } from '@volar/shared';
import { computed, Ref } from '@vue/reactivity';
import { IDescriptor, ITemplateScriptData } from '../types';
import * as upath from 'upath';
import { SourceMap, MapedMode, TsSourceMap, Mapping, CssSourceMap } from '../utils/sourceMaps';
import { transformVueHtml } from '../utils/vueHtmlConverter';
import { hyphenate } from '@vue/shared';
import * as globalServices from '../globalServices';
import * as css from 'vscode-css-languageservice';
import * as vueDom from '@vue/compiler-dom';

export function useTemplateScript(
	getUnreactiveDoc: () => TextDocument,
	template: Ref<IDescriptor['template']>,
	scriptSetup: Ref<IDescriptor['scriptSetup']>,
	templateScriptData: ITemplateScriptData,
	styleDocuments: Ref<{
		textDocument: TextDocument;
		stylesheet: css.Stylesheet;
		links: {
			textDocument: TextDocument;
			stylesheet: css.Stylesheet;
		}[];
		module: boolean;
		scoped: boolean;
	}[]>,
	styleSourceMaps: Ref<CssSourceMap[]>,
	pugData: Ref<{
		html: string;
		mapper: (code: string, htmlOffset: number) => number | undefined;
		error?: undefined;
	} | {
		error: Diagnostic;
		html?: undefined;
		mapper?: undefined;
	} | {
		html?: undefined;
		mapper?: undefined;
		error?: undefined;
	}>,
) {
	let version = 0;
	const _vueDoc = getUnreactiveDoc();
	const vueUri = _vueDoc.uri;
	const vueFileName = uriToFsPath(_vueDoc.uri);
	const data = computed(() => {
		const interpolations = getInterpolations();
		if (!interpolations) return;

		let code = [
			`import { FunctionalComponent as __VLS_Vue_FunctionalComponent } from '@vue/runtime-dom'`,
			`import { HTMLAttributes as __VLS_Vue_HTMLAttributes } from '@vue/runtime-dom'`,
			`import { VNodeProps as __VLS_Vue_VNodeProps } from '@vue/runtime-dom'`,
			`import { AllowedComponentProps as __VLS_Vue_AllowedComponentProps } from '@vue/runtime-dom'`,
			`import __VLS_VM from './${upath.basename(vueFileName)}';`,
			(scriptSetup.value
				? `import * as __VLS_setups from './${upath.basename(vueFileName)}.scriptSetup';`
				: `// no setups`),
			`const __VLS_Options = __VLS_VM.__VLS_options`,
			`declare var __VLS_ctx: InstanceType<typeof __VLS_VM>;`,
			`declare var __VLS_vmUnwrap: typeof __VLS_Options & { components: { } };`,
			`declare var __VLS_Components: typeof __VLS_vmUnwrap.components & __VLS_GlobalComponents;`,
			`declare var __VLS_for_key: string;`,
			`declare function __VLS_getVforSourceType<T>(source: T): T extends number ? number[] : T;`,
			`type __VLS_PickProp<A, B> = A & Omit<B, keyof A>;`,
			`type __VLS_PropsType<C> = C extends new (...args: any) => { $props: infer Props } ? Props : C extends __VLS_Vue_FunctionalComponent<infer R> ? R : C;`,
			`type __VLS_MapPropsTypeBase<T> = { [K in keyof T]: __VLS_PropsType<T[K]> };`,
			`type __VLS_MapPropsType<T> = { [K in keyof T]: __VLS_PickProp<__VLS_PropsType<T[K]>, __VLS_Vue_HTMLAttributes> & Record<string, unknown> };`,
			`type __VLS_MapEmitType<T> = { [K in keyof T]: __VLS_RemoveAnyFnSet<T[K] extends new (...args: any) => { $emit: infer Emit } ? __VLS_ConstructorOverloads<Emit> : {}> };`,
			`type __VLS_FirstFunction<F1, F2> = F1 extends undefined ? F2 : (F1 extends (...args: any) => any ? F1 : (F2 extends (...args: any) => any ? F2 : F1));`,
			`type __VLS_RemoveAnyFnSet<T> = ({ 'Catch Me If You Can~!': any } extends T ? {} : T) & Record<string, undefined>;`,
			`type __VLS_GlobalAttrs = __VLS_Vue_HTMLAttributes & __VLS_Vue_VNodeProps & __VLS_Vue_AllowedComponentProps;`,
			`type __VLS_PickFunc<A, B> = A extends (...args: any) => any ? A : B;`,
			`type __VLS_OmitGlobalAttrs<T> = { [K in keyof T]: Omit<T[K], keyof __VLS_GlobalAttrs> };`,
		].join('\n') + `\n`;

		code += `type __VLS_ConstructorOverloads<T> =\n`;
		for (let i = 8; i >= 1; i--) {
			code += `// ${i}\n`;
			code += `T extends {\n`;
			for (let j = 1; j <= i; j++) {
				code += `(event: infer E${j}, ...payload: infer P${j}): void;\n`
			}
			code += `} ? (\n`
			for (let j = 1; j <= i; j++) {
				if (j > 1) code += '& ';
				code += `(E${j} extends string ? { [K${j} in E${j}]: (...payload: P${j}) => void } : {})\n`;
			}
			code += `) :\n`;
		}
		code += `// 0\n`
		code += `unknown;\n`

		/* CSS Module */
		code += '/* CSS Module */\n';
		code += 'declare var $style: {\n';
		const cssModuleClasses = getCssClasses('module');
		const cssModuleMappings = writeCssClassProperties(cssModuleClasses);
		code += '};\n';

		/* Style Scoped */
		code += '/* Style Scoped */\n';
		code += 'declare var __VLS_styleScopedClasses: {\n';
		const cssScopedClasses = getCssClasses('scoped');
		const cssScopedMappings = writeCssClassProperties(cssScopedClasses);
		code += '};\n';

		/* Components */
		code += '/* Components */\n';
		code += 'declare var __VLS_components: __VLS_OmitGlobalAttrs<JSX.IntrinsicElements> & {\n';
		const componentMappings = writeComponents();
		code += '};\n';
		code += 'declare var __VLS_componentPropsBase: __VLS_MapPropsTypeBase<typeof __VLS_components>;\n';
		code += 'declare var __VLS_componentProps: __VLS_MapPropsType<typeof __VLS_components>;\n';
		code += 'declare var __VLS_componentEmits: __VLS_MapEmitType<typeof __VLS_components>;\n'

		/* Completion */
		code += '/* Completion: Emits */\n';
		for (const name of [...templateScriptData.components, ...templateScriptData.htmlElements, ...templateScriptData.context]) {
			if (!hasElement(interpolations.tags, name)) continue;
			code += `__VLS_componentEmits['${name}'][''];\n`; // TODO
		}
		code += '/* Completion: Props */\n';
		for (const name of [...templateScriptData.components, ...templateScriptData.htmlElements, ...templateScriptData.context]) {
			if (!hasElement(interpolations.tags, name)) continue;
			code += `__VLS_componentPropsBase['${name}'][''];\n`; // TODO
		}
		code += '/* Completion: Global Attrs */\n';
		code += `({} as __VLS_GlobalAttrs)[''];\n`;

		/* Props */
		code += `/* Props */\n`;
		const ctxMappings = writeProps();

		/* Interpolations */
		code += `/* Interpolations */\n`;
		// patch
		for (const maped of interpolations.mappings) {
			maped.targetRange.start += code.length;
			maped.targetRange.end += code.length;
		}
		code += interpolations.text;

		return {
			text: code,
			cssModuleMappings,
			cssScopedMappings,
			componentMappings,
			ctxMappings,
			interpolationsMappings: interpolations.mappings,
		};

		function writeCssClassProperties(data: Map<string, Map<string, Set<number>>>) {
			const mappings = new Map<string, {
				tsRange: {
					start: number,
					end: number,
				},
				cssRanges: {
					start: number,
					end: number,
				}[],
				mode: MapedMode,
			}[]>();
			for (const [uri, classes] of data) {
				if (!mappings.has(uri)) {
					mappings.set(uri, []);
				}
				for (const [className, offsets] of classes) {
					mappings.get(uri)!.push({
						tsRange: {
							start: code.length + 1, // + '
							end: code.length + 1 + className.length,
						},
						cssRanges: [...offsets].map(offset => ({
							start: offset,
							end: offset + className.length,
						})),
						mode: MapedMode.Offset,
					});
					mappings.get(uri)!.push({
						tsRange: {
							start: code.length,
							end: code.length + className.length + 2,
						},
						cssRanges: [...offsets].map(offset => ({
							start: offset,
							end: offset + className.length,
						})),
						mode: MapedMode.Gate,
					});
					code += `'${className}': string,\n`;
				}
			}
			return mappings;
		}
		function writeComponents() {
			const mappings: Mapping<undefined>[] = [];
			for (const name_1 of templateScriptData.components) {
				const names = new Set([name_1, hyphenate(name_1)]);
				for (const name_2 of names) {
					const start_1 = code.length;
					const end_1 = code.length + `'${name_2}'`.length;
					const start_2 = code.length + `'${name_2}': typeof __VLS_Components[`.length;
					const end_2 = code.length + `'${name_2}': typeof __VLS_Components['${name_1}'`.length;
					mappings.push({
						data: undefined,
						mode: MapedMode.Gate,
						sourceRange: {
							start: start_1,
							end: end_1,
						},
						targetRange: {
							start: start_2,
							end: end_2,
						},
					});
					mappings.push({
						data: undefined,
						mode: MapedMode.Gate,
						sourceRange: {
							start: start_1 + 1,
							end: end_1 - 1,
						},
						targetRange: {
							start: start_2 + 1,
							end: end_2 - 1,
						},
					});
					code += `'${name_2}': typeof __VLS_Components['${name_1}'],\n`;
				}
			}
			for (const name_1 of templateScriptData.context) {
				const names = new Set([name_1, hyphenate(name_1)]);
				for (const name_2 of names) {
					const start_1 = code.length;
					const end_1 = code.length + `'${name_2}'`.length;
					const start_2 = code.length + `'${name_2}': typeof __VLS_ctx[`.length;
					const end_2 = code.length + `'${name_2}': typeof __VLS_ctx['${name_1}'`.length;
					mappings.push({
						data: undefined,
						mode: MapedMode.Gate,
						sourceRange: {
							start: start_1,
							end: end_1,
						},
						targetRange: {
							start: start_2,
							end: end_2,
						},
					});
					mappings.push({
						data: undefined,
						mode: MapedMode.Gate,
						sourceRange: {
							start: start_1 + 1,
							end: end_1 - 1,
						},
						targetRange: {
							start: start_2 + 1,
							end: end_2 - 1,
						},
					});
					code += `'${name_2}': typeof __VLS_ctx['${name_1}'],\n`;
				}
			}
			return mappings;
		}
		function writeProps() {
			const propsSet = new Set(templateScriptData.props);
			const scriptSetupExportsSet = new Set(templateScriptData.scriptSetupExports);
			const mappings: Mapping<{ isAdditionalReference: boolean }>[] = [];
			for (const propName of templateScriptData.context) {
				const vueRange = {
					start: code.length + `var `.length,
					end: code.length + `var ${propName}`.length,
				};
				mappings.push({
					data: { isAdditionalReference: false },
					mode: MapedMode.Offset,
					sourceRange: vueRange,
					targetRange: {
						start: code.length + `var ${propName} = __VLS_ctx.`.length,
						end: code.length + `var ${propName} = __VLS_ctx.${propName}`.length,
					},
				});
				code += `var ${propName} = __VLS_ctx.${propName}; `;
				if (propsSet.has(propName)) {
					mappings.push({
						data: { isAdditionalReference: true },
						mode: MapedMode.Offset,
						sourceRange: vueRange,
						targetRange: {
							start: code.length + `__VLS_Options.props.`.length,
							end: code.length + `__VLS_Options.props.${propName}`.length,
						},
					});
					code += `__VLS_Options.props.${propName}; `;
				}
				if (scriptSetupExportsSet.has(propName)) {
					mappings.push({
						data: { isAdditionalReference: true },
						mode: MapedMode.Offset,
						sourceRange: vueRange,
						targetRange: {
							start: code.length + `__VLS_setups.`.length,
							end: code.length + `__VLS_setups.${propName}`.length,
						},
					});
					code += `__VLS_setups.${propName}; `
				}
				code += `\n`;
			}
			return mappings;
		}
		function hasElement(tags: Set<string>, tagName: string) {
			return tags.has(tagName) || tags.has(hyphenate(tagName));
		}
		function getCssClasses(type: 'module' | 'scoped') {
			const result = new Map<string, Map<string, Set<number>>>();
			for (const sourceMap of styleDocuments.value) {
				if (type === 'module' && !sourceMap.module)
					continue;
				if (type === 'scoped' && !sourceMap.scoped)
					continue;
				for (const [className, offsets] of finClassNames(sourceMap.textDocument, sourceMap.stylesheet)) {
					for (const offset of offsets) {
						addClassName(sourceMap.textDocument.uri, className, offset);
					}
				}
				for (const link of sourceMap.links) {
					for (const [className, offsets] of finClassNames(link.textDocument, link.stylesheet)) {
						for (const offset of offsets) {
							addClassName(sourceMap.textDocument.uri, className, offset);
						}
					}
				}
			}
			return result;
			function addClassName(uri: string, className: string, offset: number) {
				if (!result.has(uri))
					result.set(uri, new Map());
				if (!result.get(uri)!.has(className))
					result.get(uri)!.set(className, new Set());
				result.get(uri)!.get(className)?.add(offset);
			}
		}
		function getInterpolations() {
			if (!template.value) return;
			try {
				const html = pugData.value?.html ?? template.value.content;
				const ast = vueDom.compile(html, { onError: () => { } }).ast;
				return transformVueHtml(
					ast,
					pugData.value?.mapper,
				);
			}
			catch (err) {
				return {
					text: '',
					mappings: [],
					tags: new Set<string>(),
				};
			}
		}
	});
	const textDocument = computed(() => {
		if (data.value) {
			return TextDocument.create(vueUri + '.template.ts', 'typescript', version++, data.value?.text);
		}
	});
	const sourceMap = computed(() => {
		if (data.value && textDocument.value && template.value) {
			const vueDoc = getUnreactiveDoc();
			const sourceMap = new TsSourceMap(vueDoc, textDocument.value, true, { foldingRanges: false, formatting: true });
			{ // diagnostic for '@vue/runtime-dom' package not exist
				const text = `'@vue/runtime-dom'`;
				const textIndex = textDocument.value.getText().indexOf(text);
				const virtualRange = {
					start: textIndex,
					end: textIndex + text.length,
				};
				sourceMap.add({
					data: {
						vueTag: 'template',
						capabilities: {
							basic: false,
							references: false,
							rename: false,
							diagnostic: true,
							formatting: false,
							completion: false,
							semanticTokens: false,
						},
					},
					mode: MapedMode.Gate,
					sourceRange: {
						start: template.value.loc.start,
						end: template.value.loc.start,
					},
					targetRange: virtualRange,
				});
			}
			for (const [uri, mappings] of [...data.value.cssModuleMappings, ...data.value.cssScopedMappings]) {
				const cssSourceMap = styleSourceMaps.value.find(sourceMap => sourceMap.targetDocument.uri === uri);
				if (!cssSourceMap) continue;
				for (const maped of mappings) {
					const tsRange = maped.tsRange;
					for (const cssRange of maped.cssRanges) {
						const vueRange = cssSourceMap.targetToSource2(cssRange);
						if (!vueRange) continue;
						sourceMap.add({
							data: {
								vueTag: 'style',
								capabilities: {
									basic: true,
									references: true,
									rename: true,
									diagnostic: true,
									formatting: false,
									completion: true,
									semanticTokens: false,
								},
							},
							mode: maped.mode,
							sourceRange: vueRange.range,
							targetRange: tsRange,
						});
					}
				}
			}
			for (const maped of data.value.interpolationsMappings) {
				sourceMap.add({
					data: maped.data,
					mode: maped.mode,
					sourceRange: {
						start: maped.sourceRange.start + template.value.loc.start,
						end: maped.sourceRange.end + template.value.loc.start,
					},
					targetRange: maped.targetRange,
				});
			}

			return sourceMap;
		}
	});
	const contextSourceMap = computed(() => {
		if (data.value && textDocument.value && template.value) {
			const sourceMap = new SourceMap<{ isAdditionalReference: boolean }>(
				textDocument.value,
				textDocument.value,
			);
			for (const maped of data.value.ctxMappings) {
				sourceMap.add(maped);
			}
			return sourceMap;
		}
	});
	const componentSourceMap = computed(() => {
		if (data.value && textDocument.value && template.value) {
			const sourceMap = new SourceMap(
				textDocument.value,
				textDocument.value,
			);
			for (const maped of data.value.componentMappings) {
				sourceMap.add(maped);
			}
			return sourceMap;
		}
	});

	return {
		textDocument,
		sourceMap,
		contextSourceMap,
		componentSourceMap,
	};
}

function finClassNames(doc: TextDocument, ss: css.Stylesheet) {
	const result = new Map<string, Set<number>>();
	const cssLanguageService = globalServices.getCssService(doc.languageId);
	const symbols = cssLanguageService.findDocumentSymbols(doc, ss);
	for (const s of symbols) {
		if (s.kind === css.SymbolKind.Class) {
			// https://stackoverflow.com/questions/448981/which-characters-are-valid-in-css-class-names-selectors
			const classNames = s.name.matchAll(/(?<=\.)-?[_a-zA-Z]+[_a-zA-Z0-9-]*/g);

			for (const className of classNames) {
				if (className.index === undefined) continue;
				const text = className.toString();
				if (!result.has(text)) {
					result.set(text, new Set());
				}
				result.get(text)!.add(doc.offsetAt(s.location.range.start) + 1);
			}
		}
	}
	return result;
}
