/**
 * SF-Intel Studio — LWC IntelliSense
 * Phases 1–3: Type definitions + import path completions for LWC JavaScript files.
 *
 * Phase 1: Injects .d.ts declarations for lwc, lightning/*, @salesforce/* modules
 *          into Monaco's TypeScript language service → hover docs, param hints.
 * Phase 2: Completion provider for import paths (triggered inside import '...')
 *          → suggests module names, SObject names, field names.
 * Phase 3: @salesforce/apex/ completions via bridge call to parent (ide.js) which
 *          runs a Tooling SOQL for ApexClass names. Result is cached per session.
 */
(function () {
    'use strict';

    // ── Type definitions for LWC and Salesforce platform modules ─────────────
    const LWC_DEFS = `
        declare module 'lwc' {
            export abstract class LightningElement {
                /** Called when the element is inserted into the DOM. */
                connectedCallback(): void;
                /** Called when the element is removed from the DOM. */
                disconnectedCallback(): void;
                /** Called after each render of the component. */
                renderedCallback(): void;
                /** Called when a child component throws an error. */
                errorCallback(error: Error, stack: string): void;
                /** Access the component's shadow root. */
                readonly template: ShadowRoot & {
                    querySelector<E extends Element = Element>(selector: string): E | null;
                    querySelectorAll<E extends Element = Element>(selector: string): NodeListOf<E>;
                };
                /** Named element references (lwc:ref). */
                readonly refs: Record<string, HTMLElement>;
                /** Dispatch a DOM event from this component. */
                dispatchEvent(event: Event): boolean;
            }
            /** Mark a property as a public reactive property. */
            export function api(proto: any, key: string, descriptor?: PropertyDescriptor): any;
            /** Mark a property as a private reactive property. */
            export function track(proto: any, key: string, descriptor?: PropertyDescriptor): any;
            /** Wire a property or method to a data service. */
            export function wire(adapter: any, config?: Record<string, any>): (proto: any, key: string) => void;
            /** Create an LWC element for use outside the framework (e.g. in Aura). */
            export function createElement(tagName: string, options: { is: typeof LightningElement; mode?: 'open' | 'closed' }): HTMLElement;
        }

        declare module 'lightning/navigation' {
            /** Mixin that adds navigation capability to a component. */
            export const NavigationMixin: (base: any) => any;
            /** Wire adapter that provides the current page reference. */
            export const CurrentPageReference: any;
            export interface PageReference {
                type: string;
                attributes?: Record<string, any>;
                state?: Record<string, any>;
            }
        }

        declare module 'lightning/uiRecordApi' {
            /** Wire adapter to get a record's field values. */
            export const getRecord: any;
            /** Update an existing record. */
            export function updateRecord(recordInput: { fields: Record<string, any>; allowSaveOnDuplicate?: boolean }): Promise<object>;
            /** Create a new record. */
            export function createRecord(recordInput: { apiName: string; fields: Record<string, any> }): Promise<object>;
            /** Delete a record by ID. */
            export function deleteRecord(recordId: string): Promise<void>;
            /** Get the raw value of a field from a wire record. */
            export function getFieldValue(record: object, field: string | object): any;
            /** Get the display-formatted value of a field from a wire record. */
            export function getFieldDisplayValue(record: object, field: string | object): any;
        }

        declare module 'lightning/uiObjectInfoApi' {
            /** Wire adapter to get metadata about an SObject. */
            export const getObjectInfo: any;
            /** Wire adapter to get picklist values for a field. */
            export const getPicklistValues: any;
        }

        declare module 'lightning/uiListApi' {
            /** Wire adapter to get a list of records. */
            export const getListUi: any;
        }

        declare module 'lightning/uiRelatedListApi' {
            /** Wire adapter to get related list records. */
            export const getRelatedListRecords: any;
            /** Wire adapter to get related list info. */
            export const getRelatedListInfo: any;
        }

        declare module 'lightning/platformShowToastEvent' {
            /** Dispatch a toast notification. */
            export class ShowToastEvent extends Event {
                constructor(options: {
                    title: string;
                    message?: string;
                    variant?: 'info' | 'success' | 'warning' | 'error';
                    mode?: 'dismissable' | 'sticky' | 'pester';
                    messageData?: Array<{ url: string; label: string }>;
                });
            }
        }

        declare module 'lightning/platformResourceLoader' {
            /** Load a CSS static resource. */
            export function loadStyle(component: object, url: string): Promise<void>;
            /** Load a JavaScript static resource. */
            export function loadScript(component: object, url: string): Promise<void>;
        }

        declare module 'lightning/messageService' {
            export const MessageContext: any;
            export function createMessageContext(): any;
            export function releaseMessageContext(context: any): void;
            export function subscribe(messageContext: any, messageChannel: any, listener: (message: any) => void, options?: object): object;
            export function unsubscribe(subscription: object): void;
            export function publish(messageContext: any, messageChannel: any, message?: object): void;
            export const APPLICATION_SCOPE: symbol;
        }

        declare module 'lightning/empApi' {
            export function subscribe(channel: string, replayId: number, onMessageCallback: (response: object) => void): Promise<object>;
            export function unsubscribe(subscription: object, callback?: (response: object) => void): Promise<object>;
            export function onError(callback: (error: object) => void): void;
            export function setDebugFlag(flag: boolean): Promise<void>;
            export function isEmpEnabled(): Promise<boolean>;
        }

        declare module '@salesforce/apex/*' {
            /** Imported Apex method. Returns a Promise. */
            const apexMethod: (...args: any[]) => Promise<any>;
            export default apexMethod;
        }

        declare module '@salesforce/schema/*' {
            /** SObject or field schema reference. */
            const schemaRef: string;
            export default schemaRef;
        }

        declare module '@salesforce/user/*' {
            /** Current user property value. */
            const value: string | boolean | null;
            export default value;
        }

        declare module '@salesforce/label/*' {
            /** Custom label string. */
            const label: string;
            export default label;
        }

        declare module '@salesforce/i18n/*' {
            /** i18n locale value. */
            const value: string;
            export default value;
        }

        declare module '@salesforce/contentAssetUrl/*' {
            /** URL to a content asset. */
            const url: string;
            export default url;
        }

        declare module '@salesforce/resourceUrl/*' {
            /** URL to a static resource. */
            const url: string;
            export default url;
        }
    `;

    // ── Known lightning/* modules for suggestions ─────────────────────────────
    const LIGHTNING_MODULES = [
        { label: 'lightning/navigation',               detail: 'NavigationMixin, CurrentPageReference' },
        { label: 'lightning/uiRecordApi',              detail: 'getRecord, updateRecord, createRecord, deleteRecord, getFieldValue' },
        { label: 'lightning/uiObjectInfoApi',          detail: 'getObjectInfo, getPicklistValues' },
        { label: 'lightning/uiListApi',                detail: 'getListUi' },
        { label: 'lightning/uiRelatedListApi',         detail: 'getRelatedListRecords, getRelatedListInfo' },
        { label: 'lightning/platformShowToastEvent',   detail: 'ShowToastEvent' },
        { label: 'lightning/platformResourceLoader',   detail: 'loadStyle, loadScript' },
        { label: 'lightning/messageService',           detail: 'publish, subscribe, MessageContext' },
        { label: 'lightning/empApi',                   detail: 'subscribe, unsubscribe, onError' },
    ];

    const TOP_LEVEL_MODULES = [
        { label: 'lwc',                    detail: 'LWC core — LightningElement, @api, @track, @wire' },
        { label: '@salesforce/apex/',      detail: 'Import an Apex method' },
        { label: '@salesforce/schema/',    detail: 'Import an SObject or field reference' },
        { label: '@salesforce/user/',      detail: 'Current user property (Id, Name, etc.)' },
        { label: '@salesforce/label/',     detail: 'Custom label' },
        { label: '@salesforce/resourceUrl/', detail: 'Static resource URL' },
        { label: '@salesforce/contentAssetUrl/', detail: 'Content asset URL' },
        ...LIGHTNING_MODULES,
    ];

    // ── Main module ───────────────────────────────────────────────────────────
    window.LWCIntelliSense = {
        _apexClassCache: null,   // Array of { Id, Name } once fetched
        _pendingApexResolvers: {},

        /**
         * Entry point — called from editor.js after monaco.editor.create().
         */
        init(monaco) {
            this._injectTypeDefs(monaco);
            this._registerImportProvider(monaco);
        },

        // ── Phase 1: type definitions ─────────────────────────────────────────

        _injectTypeDefs(monaco) {
            // addExtraLib injects the type declarations into Monaco's JS/TS language
            // service without overriding any compiler options (which could break
            // existing JS validation behaviour in the editor).
            monaco.languages.typescript.javascriptDefaults.addExtraLib(LWC_DEFS, 'file:///lwc-types.d.ts');
        },

        // ── Phase 2 & 3: import path completions ─────────────────────────────

        _registerImportProvider(monaco) {
            const self = this;

            monaco.languages.registerCompletionItemProvider('javascript', {
                triggerCharacters: ["'", '"', '/', '.'],
                provideCompletionItems: async (model, position) => {
                    const line   = model.getLineContent(position.lineNumber);
                    const before = line.substring(0, position.column - 1);

                    // Match:  import X from 'typed  OR  import 'typed  OR  import('typed
                    const m = before.match(/\bfrom\s+['"]([^'"]*$)/)
                           || before.match(/\bimport\s*\(\s*['"]([^'"]*$)/)
                           || before.match(/\bimport\s+['"]([^'"]*$)/);
                    if (!m) return { suggestions: [] };

                    const typed = m[1];
                    return self._getSuggestions(typed, monaco, model, position);
                }
            });
        },

        async _getSuggestions(typed, monaco, model, position) {
            const SM   = window.SchemaManager;
            const Kind = monaco.languages.CompletionItemKind;

            // Build a range covering the token the user is currently typing.
            // Stop at '/', '"', "'", OR '.' so that:
            //   @salesforce/schema/Acc  → range covers "Acc" (segment after last /)
            //   @salesforce/schema/Account.Nam → range covers "Nam" (segment after dot)
            // This prevents field insertions from corrupting the object prefix.
            const col  = position.column;
            const line = model.getLineContent(position.lineNumber);
            let segStart = col - 1;
            while (segStart > 0 && !/['"/.]/.test(line[segStart - 1])) segStart--;
            const range = {
                startLineNumber: position.lineNumber,
                startColumn:     segStart + 1,
                endLineNumber:   position.lineNumber,
                endColumn:       col,
            };

            // ── @salesforce/schema/Object  OR  @salesforce/schema/Object.Field ──
            if (typed.startsWith('@salesforce/schema/')) {
                const path   = typed.slice('@salesforce/schema/'.length);
                const dotIdx = path.indexOf('.');
                if (dotIdx === -1) {
                    // Suggest SObject names
                    const objects = SM?.globalDescribe || [];
                    return {
                        suggestions: objects.map(o => ({
                            label:      o.name,
                            kind:       Kind.Module,
                            insertText: o.name + '.',
                            detail:     o.label || o.name,
                            documentation: `SObject: ${o.label || o.name}`,
                            range,
                            sortText:   o.name,
                        }))
                    };
                } else {
                    // Suggest field names for the object before the dot
                    const objName = path.slice(0, dotIdx);
                    let fields = [];
                    try { fields = await (SM?.getFields(objName) || Promise.resolve([])); } catch (e) {}
                    return {
                        suggestions: (fields || []).map(f => ({
                            label:      f.name,
                            kind:       Kind.Field,
                            insertText: f.name,
                            detail:     f.type + (f.label ? ` — ${f.label}` : ''),
                            documentation: `${f.label || f.name} (${f.type})`,
                            range,
                            sortText:   f.name,
                        }))
                    };
                }
            }

            // ── @salesforce/apex/ClassName  OR  @salesforce/apex/ClassName.method ──
            if (typed.startsWith('@salesforce/apex/')) {
                const path   = typed.slice('@salesforce/apex/'.length);
                const dotIdx = path.indexOf('.');
                if (dotIdx === -1) {
                    // Suggest Apex class names (fetched via bridge, cached)
                    const classes = await this._getApexClasses();
                    return {
                        suggestions: classes.map(c => ({
                            label:      c.Name,
                            kind:       Kind.Class,
                            insertText: c.Name + '.',
                            detail:     'Apex class',
                            documentation: `Import a method from ${c.Name}`,
                            range,
                            sortText:   c.Name,
                        }))
                    };
                } else {
                    // Suggest method names from SymbolIndex for the given class
                    const className = path.slice(0, dotIdx);
                    return { suggestions: this._getApexMethods(className, monaco, range) };
                }
            }

            // ── lightning/* modules ───────────────────────────────────────────
            if (typed.startsWith('lightning/')) {
                const suffix   = typed.slice('lightning/'.length).toLowerCase();
                const filtered = LIGHTNING_MODULES.filter(m => m.label.slice('lightning/'.length).startsWith(suffix));
                return {
                    suggestions: filtered.map(m => ({
                        label:      m.label,
                        kind:       Kind.Module,
                        insertText: m.label,
                        detail:     m.detail,
                        range,
                    }))
                };
            }

            // ── @salesforce/* prefix ──────────────────────────────────────────
            if (typed.startsWith('@salesforce/') && !typed.includes('/', '@salesforce/'.length)) {
                const sfModules = TOP_LEVEL_MODULES.filter(m => m.label.startsWith('@salesforce/'));
                return {
                    suggestions: sfModules
                        .filter(m => m.label.startsWith(typed))
                        .map(m => ({
                            label:      m.label,
                            kind:       Kind.Module,
                            insertText: m.label,
                            detail:     m.detail,
                            range,
                        }))
                };
            }

            // ── Top-level: show all known module prefixes ─────────────────────
            if (!typed.includes('/') || typed === '@salesforce' || typed === '@salesforce/') {
                return {
                    suggestions: TOP_LEVEL_MODULES
                        .filter(m => m.label.startsWith(typed))
                        .map(m => ({
                            label:      m.label,
                            kind:       Kind.Module,
                            insertText: m.label,
                            detail:     m.detail,
                            range,
                        }))
                };
            }

            return { suggestions: [] };
        },

        // ── Apex method lookup via SymbolIndex (open .cls files) ──────────────
        _getApexMethods(className, monaco, range) {
            const Kind = monaco.languages.CompletionItemKind;
            if (!window.SymbolIndex) return [];
            const clsFile = Object.values(window.SymbolIndex.files || {}).find(f =>
                f.name && f.name.toLowerCase() === className.toLowerCase() + '.cls'
            );
            if (!clsFile) return [];
            return (clsFile.symbols?.methods || []).map(m => ({
                label:      m.name,
                kind:       Kind.Method,
                insertText: m.name,
                detail:     'Apex method',
                documentation: `${className}.${m.name}`,
                range,
            }));
        },

        // ── Phase 3: fetch Apex class names via bridge ────────────────────────
        async _getApexClasses() {
            if (this._apexClassCache) return this._apexClassCache;
            return new Promise(resolve => {
                const rid = 'apex-cls-' + Date.now();
                this._pendingApexResolvers[rid] = resolve;
                window.parent.postMessage({ type: 'GET_APEX_CLASSES', requestId: rid }, window.location.origin);
                // Timeout fallback so the completion provider never hangs
                setTimeout(() => {
                    if (this._pendingApexResolvers[rid]) {
                        delete this._pendingApexResolvers[rid];
                        resolve([]);
                    }
                }, 5000);
            });
        },

        /**
         * Called from the editor's message listener when the parent sends back
         * the APEX_CLASSES_RESULT bridge response.
         */
        handleBridgeResult(msg) {
            if (msg.type !== 'APEX_CLASSES_RESULT') return;
            this._apexClassCache = msg.records || [];
            const resolver = this._pendingApexResolvers[msg.requestId];
            if (resolver) {
                delete this._pendingApexResolvers[msg.requestId];
                resolver(this._apexClassCache);
            }
        },
    };
})();
