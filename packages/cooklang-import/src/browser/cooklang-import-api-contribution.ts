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
import { DraftName } from './draft-name';
import { DraftSaver } from './draft-saver';

/**
 * The part of the public Cooklang plugin API that `@theia/cooklang-import`
 * owns. It follows the conventions of `CooklangPluginApi` in `@theia/cooklang`:
 * label-less commands, one plain-JSON argument, strict validation that rejects
 * with `Invalid arguments: …`.
 */
export namespace CooklangImportApi {
    export const Commands = {
        SAVE_DRAFT: 'cooklang.api.saveDraft',
    } as const;
}

/** Argument of `cooklang.api.saveDraft`. */
export interface SaveDraftArgs {
    version: 1;
    /** Cooklang text of the recipe. */
    content: string;
    /** Draft name when `content` has no frontmatter `title`. */
    title?: string;
    /** YAML frontmatter entries, added only for keys `content` does not already have. */
    frontmatter?: Record<string, string>;
}

/**
 * Registers `cooklang.api.saveDraft`: writes a plugin's recipe text to
 * `Drafts/<Title>.cook` (unique name, `title:` frontmatter), opens it, and
 * resolves to the saved file's URI string. Rejects with the no-workspace
 * message when no folder is open.
 */
@injectable()
export class CooklangImportApiContribution implements CommandContribution {

    @inject(DraftSaver)
    protected readonly draftSaver: DraftSaver;

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand({ id: CooklangImportApi.Commands.SAVE_DRAFT }, {
            execute: (args: unknown) => this.saveDraft(args),
        });
    }

    protected async saveDraft(args: unknown): Promise<string> {
        const request = this.parseSaveDraftArgs(args);
        const uri = await this.draftSaver.saveContent(request.content, request.title, request.frontmatter ?? {});
        return uri.toString();
    }

    protected parseSaveDraftArgs(args: unknown): SaveDraftArgs {
        const request = this.object(args, 'expected a JSON object.');
        if (request.version !== 1) {
            throw this.invalid('`version` must be 1.');
        }
        const content = request.content;
        if (typeof content !== 'string' || content.trim() === '') {
            throw this.invalid('`content` must be a non-empty string.');
        }
        const title = request.title;
        if (title !== undefined && typeof title !== 'string') {
            throw this.invalid('`title` must be a string.');
        }
        return { version: 1, content, title, frontmatter: this.frontmatter(request.frontmatter) };
    }

    protected frontmatter(value: unknown): Record<string, string> {
        if (value === undefined) {
            return {};
        }
        const entries = this.object(value, '`frontmatter` must be an object of strings.');
        const result: Record<string, string> = {};
        for (const [key, entry] of Object.entries(entries)) {
            if (!DraftName.isFrontmatterKey(key)) {
                throw this.invalid(`frontmatter key ${JSON.stringify(key)} is not a plain YAML key.`);
            }
            if (typeof entry !== 'string') {
                throw this.invalid(`frontmatter value for \`${key}\` must be a string.`);
            }
            result[key] = entry;
        }
        return result;
    }

    protected object(value: unknown, detail: string): Record<string, unknown> {
        if (typeof value !== 'object' || value === undefined || value === null || Array.isArray(value)) { // eslint-disable-line no-null/no-null
            throw this.invalid(detail);
        }
        return value as Record<string, unknown>;
    }

    protected invalid(detail: string): Error {
        return new Error(`Invalid arguments: ${detail}`);
    }
}
