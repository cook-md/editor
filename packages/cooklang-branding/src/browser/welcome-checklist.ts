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

/** Lists one directory by path. Injected so the search is testable without a filesystem. */
export type DirReader = (dir: string) => Promise<Array<{ name: string; dir: boolean }>>;

/** Breadth-first search for a .cook file, skipping dot-folders, to `maxDepth` levels. */
export async function findFirstRecipe(read: DirReader, roots: string[], maxDepth = 3): Promise<string | undefined> {
    let level = roots;
    for (let depth = 0; depth < maxDepth && level.length > 0; depth++) {
        const next: string[] = [];
        for (const dir of level) {
            for (const entry of await read(dir)) {
                const full = `${dir}/${entry.name}`;
                if (!entry.dir && entry.name.endsWith('.cook')) {
                    return full;
                }
                if (entry.dir && !entry.name.startsWith('.')) {
                    next.push(full);
                }
            }
        }
        level = next;
    }
    return undefined;
}
