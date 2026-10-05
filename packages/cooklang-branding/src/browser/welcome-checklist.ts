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

export type ChecklistStepId = 'folder' | 'recipes' | 'report';

export interface ChecklistFacts {
    folderOpen: boolean;
    hasRecipes: boolean;
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
        { id: 'report', done: f.reportRendered, enabled: f.hasRecipes },
    ];
    return { steps, allDone: steps.every(s => s.done) };
}

/** Installs from before CookBot moved to the banner may still have 'cookbot' stored; it is ignored. */
const STEP_ORDER: ChecklistStepId[] = ['folder', 'recipes', 'report'];

/**
 * Steps that went from not done to done, in checklist order. `previous` is undefined until the
 * first computation is taken as the baseline, so steps already done at startup are never reported.
 */
export function newlyCompleted(previous: ReadonlySet<ChecklistStepId> | undefined, next: ReadonlySet<ChecklistStepId>): ChecklistStepId[] {
    if (!previous) {
        return [];
    }
    return STEP_ORDER.filter(id => next.has(id) && !previous.has(id));
}

/**
 * Decides which completed steps to report, given the set stored from earlier sessions (it survives
 * window reloads, e.g. the reload that follows opening a folder).
 * - Nothing stored yet (first computation on this install): seed with what is done, report nothing,
 *   so steps done before this feature shipped are never reported.
 * - Otherwise report steps done now but not stored. The stored set only grows (monotonic): each step
 *   is reported at most once per install, even if it is unticked (recipe deleted) and ticked again.
 */
export function reconcileReportedSteps(
    stored: readonly string[] | undefined, done: ReadonlySet<ChecklistStepId>
): { report: ChecklistStepId[]; store: Set<ChecklistStepId> } {
    if (stored === undefined) {
        return { report: [], store: new Set(done) };
    }
    const previous = new Set(STEP_ORDER.filter(id => stored.includes(id)));
    const report = newlyCompleted(previous, done);
    return { report, store: new Set([...previous, ...report]) };
}

/**
 * The "try CookBot free for 7 days" banner is shown until dismissed, unless the account already
 * has AI or has used its one trial. Signed-out users (no subscription) see it.
 */
export function showCookbotBanner(subscription: { features: string[]; trialEligible?: boolean } | undefined, dismissed: boolean): boolean {
    return !dismissed && !subscription?.features.includes('ai') && subscription?.trialEligible !== false;
}

/** True for a `.cook` file path (extension matched case-insensitively). */
export function isRecipePath(path: string): boolean {
    return path.toLowerCase().endsWith('.cook');
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

/** Lower-case; names are compared case-insensitively. */
const SKIPPED_FOLDERS = new Set([
    'node_modules', 'target', 'dist', 'build', 'venv', '.venv', '__pycache__',
    'library', 'applications', 'pictures', 'music', 'movies',
]);

const CHUNK = 16;

/** Joins a directory path and an entry name the way `findFirstRecipe` builds the paths it returns. */
export function childPath(dir: string, name: string): string {
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
            const listings = await Promise.all(chunk.map(dir => (async () => read(dir))().catch(() => [])));
            for (let j = 0; j < chunk.length; j++) {
                for (const entry of listings[j]) {
                    if (!entry.dir && isRecipePath(entry.name)) {
                        return childPath(chunk[j], entry.name);
                    }
                    if (entry.dir && !entry.name.startsWith('.') && !SKIPPED_FOLDERS.has(entry.name.toLowerCase())) {
                        next.push(childPath(chunk[j], entry.name));
                    }
                }
            }
        }
        level = next;
    }
    return undefined;
}
