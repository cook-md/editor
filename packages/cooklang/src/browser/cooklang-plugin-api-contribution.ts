// *****************************************************************************
// Copyright (C) 2026 cook.md and contributors
//
// SPDX-License-Identifier: AGPL-3.0-only WITH LicenseRef-cooklang-theia-linking-exception
//
// This program is free software: you can redistribute it and/or modify it
// under the terms of the GNU Affero General Public License version 3 as
// published by the Free Software Foundation, with the linking exception
// documented in NOTICE.md.
//
// See LICENSE-AGPL for the full license text.
// *****************************************************************************

import { injectable, inject } from '@theia/core/shared/inversify';
import { CommandContribution, CommandRegistry } from '@theia/core/lib/common/command';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { ContextKeyService } from '@theia/core/lib/browser/context-key-service';
import URI from '@theia/core/lib/common/uri';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { SubscriptionFrontendService } from '@theia/cooklang-account/lib/browser/subscription-frontend-service';
import { CooklangLanguageService } from '../common/cooklang-language-service';
import { CooklangUri } from '../common/cooklang-uri';
import { PluginReportResult } from '../common/plugin-report-types';
import {
    CheckEntry,
    ShoppingListFile,
    ShoppingListRecipeItem,
    ShoppingListResult,
    fromWireCheckedLog,
    fromWireShoppingList,
    toWireCheckEntryJson,
    toWireCheckedLog,
    toWireShoppingList,
} from '../common/shopping-list-types';
import { PantryAttributes, PantryContents, PantryEdit, PantryItemInfo } from '../common/pantry-types';
import { ShoppingListGenerator } from './shopping-list-generator';
import { RecipeReferenceResolver, ResolvedRecipeReference } from './recipe-reference-resolver';
import { ReportConfigService } from './report-config-service';
import { RecipePreviewContribution } from './recipe-preview-contribution';
import { PluginReportService } from './plugin-report-service';
import { CooklangOutletService } from './cooklang-outlet-service';

/**
 * The public Cooklang API for plugins: label-less commands (hidden from the
 * palette) that plugins call with `vscode.commands.executeCommand(id, args)`.
 * Arguments and results are plain JSON; paths are workspace-relative (absolute
 * paths and `file://` URIs inside the workspace are accepted). Version 1.
 * Changes are additive and leave `VERSION` alone, because plugins compare it
 * for equality; bump it only for a breaking change. Plugins detect commands
 * added later with `vscode.commands.getCommands(true)`.
 * `cooklang.api.saveDraft` belongs to this API too, but `@theia/cooklang-import`
 * registers it (`CooklangImportApi`), next to the `DraftSaver` it wraps.
 * Unlike every command here, `cooklang.api.saveDraft`'s argument carries its
 * own `version: 1` field, separate from this namespace's `VERSION`.
 */
export namespace CooklangPluginApi {
    export const VERSION = 1;
    export const CONTEXT_KEY = 'cooklang.apiVersion';
    export const Commands = {
        VERSION: 'cooklang.api.version',
        GENERATE_SHOPPING_LIST: 'cooklang.api.generateShoppingList',
        RESOLVE_RECIPE_REFERENCES: 'cooklang.api.resolveRecipeReferences',
        PARSE_SHOPPING_LIST: 'cooklang.api.parseShoppingList',
        WRITE_SHOPPING_LIST: 'cooklang.api.writeShoppingList',
        PARSE_SHOPPING_CHECKED: 'cooklang.api.parseShoppingChecked',
        WRITE_SHOPPING_CHECKED: 'cooklang.api.writeShoppingChecked',
        COMPACT_SHOPPING_CHECKED: 'cooklang.api.compactShoppingChecked',
        /** `{ uri }`: open the recipe preview for a `.cook` URI of any scheme (e.g. `cooklang-hub:`). */
        OPEN_PREVIEW: 'cooklang.api.openPreview',
        /** `{ text }` → `PantryContents`: parse a `config/pantry.conf` text. */
        PARSE_PANTRY: 'cooklang.api.parsePantry',
        /** `{ text, edit: PantryEdit }` → new file text, comments and formatting preserved. */
        EDIT_PANTRY: 'cooklang.api.editPantry',
        /** `{ name }` → boolean: whether the signed-in user's plan includes a feature, e.g. `nutrition_api`. False when signed out. */
        HAS_FEATURE: 'cooklang.api.hasFeature',
        /**
         * `{ uri, template, scale? }` → `PluginReportResult`: renders a Jinja template (at most
         * {@link MAX_TEMPLATE_LENGTH} characters) against a `.cook` or `.menu` URI of any scheme
         * (unsaved edits included) with the Reports engine and configuration. Template functions
         * include everything reports have (e.g. `aggregate_nutrition`, the `tojson` filter).
         * Bad arguments throw `Invalid arguments: …`; render failures resolve to
         * `{ ok: false, reason, message }`. Successful results are cached by recipe text,
         * template and scale; the cache is dropped on login/logout and on any `cooklang.*`
         * preference change. Templates call the nutrition service with the signed-in user's
         * token, so any installed plugin can make authenticated nutrition-service calls on the
         * user's behalf (counting against their quota) without ever seeing the token.
         */
        RENDER_REPORT: 'cooklang.api.renderReport',
        /**
         * No argument → `undefined`: asks open previews to re-query their badges, e.g. after a
         * badge provider's settings changed. Refreshes are debounced, so calling it often is cheap.
         */
        REFRESH_BADGES: 'cooklang.api.refreshBadges',
    } as const;

    /** Maximum `cooklang.api.renderReport` template length, in characters (64 K), not bytes. */
    export const MAX_TEMPLATE_LENGTH = 64 * 1024;
}

/**
 * Registers the public `cooklang.api.*` commands (see {@link CooklangPluginApi})
 * and sets the `cooklang.apiVersion` context key on start. Every command takes
 * one plain-JSON argument, validates it strictly (rejecting with
 * `Invalid arguments: …`), and delegates the format work to the native
 * Cooklang crates through {@link CooklangLanguageService}.
 */
@injectable()
export class CooklangPluginApiContribution implements CommandContribution, FrontendApplicationContribution {

    @inject(ShoppingListGenerator)
    protected readonly generator: ShoppingListGenerator;

    @inject(RecipeReferenceResolver)
    protected readonly resolver: RecipeReferenceResolver;

    @inject(CooklangLanguageService)
    protected readonly languageService: CooklangLanguageService;

    @inject(ReportConfigService)
    protected readonly reportConfigService: ReportConfigService;

    @inject(ContextKeyService)
    protected readonly contextKeys: ContextKeyService;

    @inject(RecipePreviewContribution)
    protected readonly recipePreview: RecipePreviewContribution;

    @inject(FileService)
    protected readonly fileService: FileService;

    @inject(SubscriptionFrontendService)
    protected readonly subscriptions: SubscriptionFrontendService;

    @inject(PluginReportService)
    protected readonly pluginReports: PluginReportService;

    @inject(CooklangOutletService)
    protected readonly outlets: CooklangOutletService;

    onStart(): void {
        this.contextKeys.createKey<number>(CooklangPluginApi.CONTEXT_KEY, CooklangPluginApi.VERSION);
    }

    registerCommands(registry: CommandRegistry): void {
        const { Commands } = CooklangPluginApi;
        registry.registerCommand({ id: Commands.VERSION }, { execute: () => CooklangPluginApi.VERSION });
        registry.registerCommand({ id: Commands.GENERATE_SHOPPING_LIST }, { execute: (args: unknown) => this.generateShoppingList(args) });
        registry.registerCommand({ id: Commands.RESOLVE_RECIPE_REFERENCES }, { execute: (args: unknown) => this.resolveRecipeReferences(args) });
        registry.registerCommand({ id: Commands.PARSE_SHOPPING_LIST }, { execute: (args: unknown) => this.parseShoppingList(args) });
        registry.registerCommand({ id: Commands.WRITE_SHOPPING_LIST }, { execute: (args: unknown) => this.writeShoppingList(args) });
        registry.registerCommand({ id: Commands.PARSE_SHOPPING_CHECKED }, { execute: (args: unknown) => this.parseShoppingChecked(args) });
        registry.registerCommand({ id: Commands.WRITE_SHOPPING_CHECKED }, { execute: (args: unknown) => this.writeShoppingChecked(args) });
        registry.registerCommand({ id: Commands.COMPACT_SHOPPING_CHECKED }, { execute: (args: unknown) => this.compactShoppingChecked(args) });
        registry.registerCommand({ id: Commands.OPEN_PREVIEW }, { execute: (args: unknown) => this.openPreview(args) });
        registry.registerCommand({ id: Commands.PARSE_PANTRY }, { execute: (args: unknown) => this.parsePantry(args) });
        registry.registerCommand({ id: Commands.EDIT_PANTRY }, { execute: (args: unknown) => this.editPantry(args) });
        registry.registerCommand({ id: Commands.HAS_FEATURE }, { execute: (args: unknown) => this.hasFeature(args) });
        registry.registerCommand({ id: Commands.RENDER_REPORT }, { execute: (args: unknown) => this.renderReport(args) });
        registry.registerCommand({ id: Commands.REFRESH_BADGES }, { execute: () => this.outlets.refresh() });
    }

    protected async generateShoppingList(args: unknown): Promise<ShoppingListResult> {
        const recipes = this.object(args).recipes;
        if (!Array.isArray(recipes)) {
            throw this.invalid('`recipes` must be an array of { path, scale? }.');
        }
        const items = recipes.map(entry => {
            const recipe = this.object(entry);
            const path = this.string(recipe.path, '`path`');
            const scale = recipe.scale === undefined ? 1 : recipe.scale;
            if (typeof scale !== 'number' || !Number.isFinite(scale) || scale <= 0) {
                throw this.invalid(`Recipe scale must be a positive number: ${path}`);
            }
            return { path, scale };
        });
        const normalised = items.map(item => ({ path: this.workspacePath(item.path), scale: item.scale }));
        return this.generator.computeResult(normalised);
    }

    protected async resolveRecipeReferences(args: unknown): Promise<ResolvedRecipeReference[]> {
        const requested = this.string(this.object(args).path, '`path`');
        const path = this.workspacePath(requested);
        const baseDir = this.root().path.fsPath();
        const content = await this.languageService.findRecipe(baseDir, path);
        if (content === undefined) {
            throw new Error(`Recipe not found: ${requested}`);
        }
        return this.resolver.resolve(content, baseDir);
    }

    protected async parseShoppingList(args: unknown): Promise<ShoppingListFile> {
        const text = this.text(this.object(args).text, '`text`');
        return fromWireShoppingList(await this.languageService.parseShoppingList(text));
    }

    protected async writeShoppingList(args: unknown): Promise<string> {
        const list = this.object(this.object(args).list);
        const file: ShoppingListFile = { items: this.shoppingItems(list.items, '`list.items`') };
        return this.languageService.writeShoppingList(toWireShoppingList(file));
    }

    protected async parseShoppingChecked(args: unknown): Promise<CheckEntry[]> {
        const text = this.text(this.object(args).text, '`text`');
        return fromWireCheckedLog(await this.languageService.parseChecked(text));
    }

    protected async writeShoppingChecked(args: unknown): Promise<string> {
        const entries = this.entries(this.object(args).entries);
        const lines: string[] = [];
        for (const entry of entries) {
            // Every line ends with '\n' (the Rust writer uses writeln!).
            lines.push(await this.languageService.writeCheckEntry(toWireCheckEntryJson(entry)));
        }
        return lines.join('');
    }

    protected async compactShoppingChecked(args: unknown): Promise<CheckEntry[]> {
        const request = this.object(args);
        const entries = this.entries(request.entries);
        const ingredients = request.ingredients;
        if (!Array.isArray(ingredients) || !ingredients.every(name => typeof name === 'string')) {
            throw this.invalid('`ingredients` must be an array of strings.');
        }
        return fromWireCheckedLog(await this.languageService.compactChecked(toWireCheckedLog(entries), ingredients));
    }

    /**
     * Opens the recipe preview for any `.cook` URI whose scheme `FileService`
     * can read, such as a plugin's `FileSystemProvider`. The preview open
     * handler only claims `file` URIs on its own, so `git:` and other schemes
     * keep opening in the text editor; plugins ask for the preview explicitly.
     */
    protected async openPreview(args: unknown): Promise<void> {
        const raw = this.string(this.object(args).uri, '`uri`');
        const uri = new URI(raw);
        if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw) || !CooklangUri.isRecipe(uri)) {
            throw this.invalid('`uri` must be an absolute URI of a .cook recipe.');
        }
        // Fail closed: FileService.activateProvider() never settles for a
        // scheme with no registered (or registering) FileSystemProvider, so
        // an unhandled scheme would hang the preview forever instead of
        // rejecting.
        if (!this.fileService.hasProvider(uri.scheme)) {
            throw this.invalid(`no file system for scheme "${uri.scheme}".`);
        }
        await this.recipePreview.open(uri);
    }

    protected async parsePantry(args: unknown): Promise<PantryContents> {
        const text = this.text(this.object(args).text, '`text`');
        const wire = JSON.parse(await this.languageService.parsePantry(text)) as { sections?: unknown };
        if (!Array.isArray(wire?.sections) || !wire.sections.every(section => Array.isArray(section?.items))) {
            throw new Error('parsePantry: unexpected result from the native parser');
        }
        const sections = wire.sections as Array<{ name: string; items: Record<string, unknown>[] }>;
        return {
            sections: sections.map(section => ({ name: section.name, items: section.items.map(item => this.pantryItem(item)) })),
        };
    }

    /** Native JSON uses null for absent attributes; the plugin shape omits them. */
    protected pantryItem(wire: Record<string, unknown>): PantryItemInfo {
        const item: PantryItemInfo = { name: String(wire.name), isLow: wire.isLow === true, isOutOfStock: wire.isOutOfStock === true };
        for (const key of ['quantity', 'bought', 'expire', 'low', 'expireDate', 'boughtDate'] as const) {
            const value = wire[key];
            if (typeof value === 'string') {
                item[key] = value;
            }
        }
        return item;
    }

    protected async editPantry(args: unknown): Promise<string> {
        const request = this.object(args);
        const text = this.text(request.text, '`text`');
        const edit = this.pantryEdit(request.edit);
        return this.languageService.editPantry(text, JSON.stringify(edit));
    }

    protected async hasFeature(args: unknown): Promise<boolean> {
        const name = this.string(this.object(args).name, '`name`');
        try {
            return await this.subscriptions.hasFeature(name);
        } catch (e) {
            console.debug('[cooklang] hasFeature failed, treating as absent:', e);
            return false;
        }
    }

    protected async renderReport(args: unknown): Promise<PluginReportResult> {
        const request = this.object(args);
        const raw = this.string(request.uri, '`uri`');
        const uri = new URI(raw);
        if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw) || !(CooklangUri.isRecipe(uri) || CooklangUri.isMenu(uri))) {
            throw this.invalid('`uri` must be an absolute URI of a .cook recipe or .menu file.');
        }
        const template = this.text(request.template, '`template`');
        if (template.trim() === '' || template.length > CooklangPluginApi.MAX_TEMPLATE_LENGTH) {
            throw this.invalid(`\`template\` must be non-empty and at most ${CooklangPluginApi.MAX_TEMPLATE_LENGTH} characters.`);
        }
        const scale = request.scale === undefined ? 1 : request.scale;
        if (typeof scale !== 'number' || !Number.isFinite(scale) || scale <= 0) {
            throw this.invalid('`scale` must be a positive number.');
        }
        return this.pluginReports.render(uri, template, scale);
    }

    protected pantryEdit(value: unknown): PantryEdit {
        const edit = this.object(value, '`edit`');
        const op = edit.op;
        if (op !== 'add' && op !== 'update' && op !== 'remove') {
            throw this.invalid('`edit.op` must be "add", "update" or "remove".');
        }
        const section = this.string(edit.section, '`edit.section`');
        const name = this.string(edit.name, '`edit.name`');
        switch (op) {
            case 'add':
                this.onlyKeys(edit, ['op', 'section', 'name', ...PantryAttributes.KEYS], '`edit`');
                return { op, section, name, ...this.pantryAttributes(edit, '`edit`') };
            case 'update': {
                this.onlyKeys(edit, ['op', 'section', 'name', 'fields'], '`edit`');
                const fields = this.object(edit.fields, '`edit.fields`');
                this.onlyKeys(fields, PantryAttributes.KEYS, '`edit.fields`');
                return { op, section, name, fields: this.pantryAttributes(fields, '`edit.fields`') };
            }
            case 'remove':
                this.onlyKeys(edit, ['op', 'section', 'name'], '`edit`');
                return { op, section, name };
        }
    }

    /** Picks the four known attributes; an empty string is kept (it clears on update). */
    protected pantryAttributes(source: Record<string, unknown>, name: string): PantryAttributes {
        const attributes: PantryAttributes = {};
        for (const key of PantryAttributes.KEYS) {
            const value = source[key];
            if (value === undefined) {
                continue;
            }
            if (typeof value !== 'string') {
                throw this.invalid(`${name}.${key} must be a string.`);
            }
            if (value !== '' && value.trim() === '') {
                throw this.invalid(`${name}.${key} must not be only whitespace.`);
            }
            this.noControlCharacters(value, `${name}.${key}`);
            attributes[key] = value.trim();
        }
        return attributes;
    }

    /** Rejects any key in `source` that is not in `allowed`, instead of silently dropping it. */
    protected onlyKeys(source: Record<string, unknown>, allowed: readonly string[], name: string): void {
        const unknown = Object.keys(source).filter(key => !allowed.includes(key));
        if (unknown.length > 0) {
            throw this.invalid(`${name} has unknown keys: ${unknown.join(', ')}.`);
        }
    }

    // --- argument helpers ---

    protected root(): URI {
        const root = this.generator.getWorkspaceRootUri();
        if (!root) {
            throw new Error('No workspace is open.');
        }
        return root;
    }

    /** Workspace-relative form of a path or URI inside the workspace. */
    protected workspacePath(path: string): string {
        const root = this.root();
        const uri = this.reportConfigService.resolveWorkspaceUri(this.portablePath(path));
        const relative = uri && root.isEqualOrParent(uri) ? root.relative(uri)?.toString() : undefined;
        if (!relative) {
            throw new Error(`Path is outside the workspace: ${path}`);
        }
        return relative;
    }

    /**
     * Windows absolute paths (`C:\\…`) become `file://` URIs; backslashes in
     * relative paths become `/`, so plugins may pass either separator.
     */
    protected portablePath(path: string): string {
        if (/^[a-zA-Z]:[\\/]/.test(path)) {
            return URI.fromFilePath(path.replace(/\\/g, '/')).toString();
        }
        if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(path)) {
            return path;
        }
        return path.replace(/\\/g, '/');
    }

    protected object(value: unknown, name?: string): Record<string, unknown> {
        if (typeof value !== 'object' || value === undefined || value === null || Array.isArray(value)) { // eslint-disable-line no-null/no-null
            throw this.invalid(name ? `${name} must be a JSON object.` : 'expected a JSON object.');
        }
        return value as Record<string, unknown>;
    }

    protected string(value: unknown, name: string): string {
        if (typeof value !== 'string' || value.trim() === '') {
            throw this.invalid(`${name} must be a non-empty string.`);
        }
        this.noControlCharacters(value, name);
        return value.trim();
    }

    protected text(value: unknown, name: string): string {
        if (typeof value !== 'string') {
            throw this.invalid(`${name} must be a string.`);
        }
        return value;
    }

    protected entries(value: unknown): CheckEntry[] {
        if (!Array.isArray(value)) {
            throw this.invalid('`entries` must be an array.');
        }
        return value.map(entry => {
            const candidate = this.object(entry);
            if ((candidate.type !== 'checked' && candidate.type !== 'unchecked') || typeof candidate.name !== 'string') {
                throw this.invalid('each entry must be { type: "checked" | "unchecked", name }.');
            }
            this.noControlCharacters(candidate.name, 'entry `name`');
            return { type: candidate.type, name: candidate.name };
        });
    }

    /** Validates a `.shopping-list` item tree; `type` is always `'recipe'`. */
    protected shoppingItems(value: unknown, name: string): ShoppingListRecipeItem[] {
        if (!Array.isArray(value)) {
            throw this.invalid(`${name} must be an array.`);
        }
        return value.map(entry => {
            const item = this.object(entry);
            const path = this.string(item.path, '`path`');
            const multiplier = item.multiplier;
            if (multiplier !== undefined && (typeof multiplier !== 'number' || !Number.isFinite(multiplier) || multiplier <= 0)) {
                throw this.invalid(`Recipe multiplier must be a positive number: ${path}`);
            }
            const children = item.children === undefined ? [] : this.shoppingItems(item.children, '`children`');
            const result: ShoppingListRecipeItem = { type: 'recipe', path, children };
            if (multiplier !== undefined) {
                result.multiplier = multiplier;
            }
            return result;
        });
    }

    /** The Rust writers do not escape newlines, so control characters would corrupt the file. */
    protected noControlCharacters(value: string, name: string): void {
        // eslint-disable-next-line no-control-regex
        if (/[\u0000-\u001f\u007f]/.test(value)) {
            throw this.invalid(`${name} must not contain control characters.`);
        }
    }

    protected invalid(detail: string): Error {
        return new Error(`Invalid arguments: ${detail}`);
    }
}
