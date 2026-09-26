// *****************************************************************************
// Copyright (C) 2024-2026 cook.md and contributors
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

export const CooklangLanguageServicePath = '/services/cooklang-language';
export const CooklangLanguageService = Symbol('CooklangLanguageService');

/**
 * LSP bridge service. The frontend calls these methods via RPC;
 * the backend forwards them to the in-process NAPI-RS LSP server.
 *
 * Parameters use primitives (not nested LSP param objects) to keep
 * the Theia RPC serialization straightforward.
 */
export interface CooklangLanguageService {
    // Lifecycle
    initialize(rootUri: string | null): Promise<CooklangInitializeResult>;
    shutdown(): Promise<void>;

    // Document sync (fire-and-forget notifications)
    didOpenTextDocument(uri: string, languageId: string, version: number, text: string): void;
    didChangeTextDocument(uri: string, version: number, text: string): void;
    didCloseTextDocument(uri: string): void;
    didSaveTextDocument(uri: string): void;

    // Language features (request/response)
    completion(uri: string, line: number, character: number): Promise<CooklangCompletionList | null>;
    hover(uri: string, line: number, character: number): Promise<CooklangHover | null>;
    documentSymbol(uri: string): Promise<CooklangDocumentSymbol[] | null>;
    semanticTokensFull(uri: string): Promise<CooklangSemanticTokens | null>;

    // Recipe parsing (returns JSON-serialized ParseResult)
    parse(content: string): Promise<string>;

    // Menu parsing (returns JSON-serialized MenuParseResult)
    parseMenu(content: string, scale: number): Promise<string>;

    // Shopping list generation
    generateShoppingList(recipesJson: string, aisleConf: string | null, pantryConf: string | null): Promise<string>;

    // Shopping list format (new in 2026-04)
    parseShoppingList(text: string): Promise<string>;
    writeShoppingList(json: string): Promise<string>;
    parseChecked(text: string): Promise<string>;
    writeCheckEntry(entryJson: string): Promise<string>;
    checkedSet(entriesJson: string): Promise<string[]>;
    compactChecked(entriesJson: string, currentIngredients: string[]): Promise<string>;

    /**
     * Resolve a recipe by `name` (with or without extension) inside `baseDir` using
     * cooklang-find's lookup rules (auto-tries `.cook` then `.menu`).
     * Returns the file content, or `undefined` if no matching file is found.
     *
     * `baseDir` must be an OS filesystem path (not a URI) — this RPC reads from
     * disk directly via `cooklang-find` and bypasses Theia's `FileService`.
     * Electron-only by design; remote/virtual workspaces are not supported.
     */
    findRecipe(baseDir: string, name: string): Promise<string | undefined>;

    /**
     * The absolute path of the recipe `findRecipe` would read for `name` inside
     * `baseDir`, or `undefined` when nothing matches.
     *
     * Use this to navigate to a referenced recipe rather than rebuilding the path
     * from the reference text: `cooklang-find` owns the lookup rules (search
     * order, `.cook` vs `.menu`, how a bare name maps onto the tree) and they are
     * not reproducible by appending an extension to a workspace-relative path.
     *
     * Same disk-access caveat as `findRecipe` (OS path, Electron-only).
     */
    findRecipePath(baseDir: string, name: string): Promise<string | undefined>;

    /**
     * Title and step images for the recipe at `recipePath`, discovered with
     * `cooklang-find`'s naming rules (the same ones CookCLI's web server uses).
     *
     * Returns JSON `{ title: string | null, steps: { [section]: { [step]: path } } }`.
     * `title` is raw: an absolute path, a URL, or a relative path from metadata.
     * `steps` keys are zero-indexed; section 0 holds the linear `Recipe.N.ext` form.
     *
     * `recipePath` must be an OS filesystem path (not a URI) — this RPC reads
     * from disk directly via `cooklang-find` and bypasses Theia's `FileService`.
     * Electron-only by design; remote/virtual workspaces are not supported.
     */
    recipeImages(recipePath: string): Promise<string>;

    /**
     * Title image for recipe *text*, for recipes that are not files on disk
     * (e.g. a `cooklang-hub:` recipe served by a plugin). Asks `cooklang-find`'s
     * content-based entry, so only frontmatter (`image:`, `images:`, `picture:`,
     * `pictures:`) can name one; the value is returned verbatim.
     *
     * Returns the same JSON shape as {@link recipeImages}; `steps` is always empty.
     */
    recipeImagesFromContent(content: string): Promise<string>;

    /**
     * Search recipes under `baseDir` like `cook search` (cooklang-find: filename
     * + content term scoring over `.cook` and `.menu`). A blank query lists every
     * recipe. Same disk-access caveat as `findRecipe` (OS path, Electron-only).
     *
     * Returns JSON: `[{ path, name, title, tags, isMenu, servings }]`, best first.
     */
    searchRecipes(baseDir: string, query: string): Promise<string>;

    /**
     * `searchRecipes` with a metadata filter, returning each match's frontmatter
     * (cooklang-find >= 0.8 `search_with_filter`). `filterJson` is
     * `{ "where": { key: condition }, "titleContains": string | string[] }` and
     * may be blank for "no filter". Only frontmatter is read unless `query` is
     * non-blank, so one call answers "which recipes have metadata X" for a whole
     * library. A blank query lists matches sorted by path. Rejects on a malformed
     * filter. Same disk-access caveat as `findRecipe` (OS path, Electron-only).
     *
     * Returns JSON: `[{ path, name, title, tags, isMenu, servings, metadata }]`.
     */
    searchRecipesFiltered(baseDir: string, query: string, filterJson: string): Promise<string>;

    /**
     * Parse a `pantry.conf` (TOML). Returns JSON
     * `{ sections: [{ name, items: [{ name, quantity, bought, expire, low, isLow, isOutOfStock, expireDate, boughtDate }] }], lowStock: [...] }`.
     * `expireDate`/`boughtDate` are the dates normalised to `YYYY-MM-DD` (null when unparseable).
     * Rejects on an unparseable file.
     */
    parsePantry(text: string): Promise<string>;

    /**
     * Check which `names` are in the pantry (case-insensitive). Returns JSON
     * `[{ name, inStock, section, quantity, isLow }]` in input order.
     */
    checkPantry(text: string, names: string[]): Promise<string>;

    /**
     * Apply one pantry edit (JSON, see native `editPantry`) to a `pantry.conf`
     * text and return the new text, preserving comments and formatting.
     * Rejects with `editPantry: <message>` on a bad edit or unparseable file.
     */
    editPantry(text: string, editJson: string): Promise<string>;

    /**
     * Render a Jinja2 report template against a recipe (cookcli-compatible,
     * via the cooklang-reports crate).
     *
     * `configJson` is a JSON object with optional `scale` (number) and
     * optional `basePath`, `aislePath`, `pantryPath`, `datastorePath` given
     * as **URI strings** — the backend converts them to filesystem paths.
     *
     * Returns JSON: `{"output": "..."}` on success or `{"error": "..."}`.
     */
    renderReport(recipeContent: string, templateContent: string, configJson: string): Promise<string>;
}

// Plain JSON DTOs — subsets of vscode-languageserver-protocol types
// kept as simple interfaces so they serialize cleanly over Theia RPC.

export interface CooklangInitializeResult {
    capabilities: {
        semanticTokensProvider?: {
            legend: {
                tokenTypes: string[];
                tokenModifiers: string[];
            };
            full: boolean;
        };
    };
}

export interface CooklangCompletionItem {
    label: string;
    kind?: number;
    detail?: string;
    documentation?: string;
    insertText?: string;
    insertTextFormat?: number;
    filterText?: string;
    textEdit?: CooklangTextEdit;
}

export interface CooklangTextEdit {
    range: { start: { line: number; character: number }; end: { line: number; character: number } };
    newText: string;
}

export interface CooklangCompletionList {
    isIncomplete: boolean;
    items: CooklangCompletionItem[];
}

export interface CooklangHover {
    contents: CooklangMarkupContent;
    range?: { start: { line: number; character: number }; end: { line: number; character: number } };
}

export interface CooklangMarkupContent {
    kind: string;
    value: string;
}

export interface CooklangDocumentSymbol {
    name: string;
    kind: number;
    range: { start: { line: number; character: number }; end: { line: number; character: number } };
    selectionRange: { start: { line: number; character: number }; end: { line: number; character: number } };
    children?: CooklangDocumentSymbol[];
}

export interface CooklangSemanticTokens {
    resultId?: string;
    data: number[];
}
