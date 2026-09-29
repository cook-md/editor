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

export type ChecklistStepId = 'folder' | 'recipes' | 'cookbot' | 'report';

export interface ChecklistFacts {
    folderOpen: boolean;
    hasRecipes: boolean;
    cookbotUsed: boolean;
    reportRendered: boolean;
}

export interface ChecklistStep {
    id: ChecklistStepId;
    done: boolean;
    enabled: boolean;
}

export function computeChecklist(f: ChecklistFacts): { steps: ChecklistStep[]; allDone: boolean } {
    const steps: ChecklistStep[] = [
        { id: 'folder', done: f.folderOpen, enabled: true },
        { id: 'recipes', done: f.hasRecipes, enabled: f.folderOpen },
        { id: 'cookbot', done: f.cookbotUsed, enabled: f.hasRecipes },
        { id: 'report', done: f.reportRendered, enabled: f.hasRecipes },
    ];
    return { steps, allDone: steps.every(s => s.done) };
}

/**
 * Lists one directory by path. Injected so the search is testable without a filesystem.
 * Paths are URI path strings (Theia `URI.path.toString()`): forward slashes, e.g. `/c:/Users/me`
 * on Windows. Roots passed to `findFirstRecipe`, the paths given to the reader and the returned
 * value all use this form.
 */
export type DirReader = (dir: string) => Promise<Array<{ name: string; dir: boolean }>>;

export interface FindFirstRecipeOptions {
    /** Levels to look at; root folders are level 1. */
    maxDepth?: number;
    /** Upper bound on directories read. */
    maxDirs?: number;
}

const SKIPPED_FOLDERS = new Set([
    'node_modules', 'target', 'dist', 'build', 'venv', '.venv', '__pycache__',
    'Library', 'Applications', 'Pictures', 'Music', 'Movies',
]);

const CHUNK = 16;

function join(dir: string, name: string): string {
    return dir.endsWith('/') ? `${dir}${name}` : `${dir}/${name}`;
}

/**
 * Breadth-first search for a .cook file (extension matched case-insensitively). Skips dot-folders
 * and well-known heavy folders, ignores directories that cannot be read, and reads each level in
 * parallel chunks while keeping the first match deterministic (listing order within a level).
 * If `maxDirs` is reached before a recipe turns up the result is `undefined`: unknown is treated as none.
 */
export async function findFirstRecipe(read: DirReader, roots: string[], options: FindFirstRecipeOptions = {}): Promise<string | undefined> {
    const { maxDepth = 3, maxDirs = 200 } = options;
    let budget = maxDirs;
    let level = roots;
    for (let depth = 0; depth < maxDepth && level.length > 0 && budget > 0; depth++) {
        const next: string[] = [];
        const dirs = level.slice(0, budget);
        budget -= dirs.length;
        for (let i = 0; i < dirs.length; i += CHUNK) {
            const chunk = dirs.slice(i, i + CHUNK);
            const listings = await Promise.all(chunk.map(dir => read(dir).catch(() => [])));
            for (let j = 0; j < chunk.length; j++) {
                for (const entry of listings[j]) {
                    if (!entry.dir && entry.name.toLowerCase().endsWith('.cook')) {
                        return join(chunk[j], entry.name);
                    }
                    if (entry.dir && !entry.name.startsWith('.') && !SKIPPED_FOLDERS.has(entry.name)) {
                        next.push(join(chunk[j], entry.name));
                    }
                }
            }
        }
        level = next;
    }
    return undefined;
}
