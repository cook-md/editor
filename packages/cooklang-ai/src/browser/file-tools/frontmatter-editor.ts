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

// Pure, Theia-free: edits a recipe's YAML frontmatter in place (tags, set,
// unset) and re-serializes it, preserving everything the model never asked to
// change — comments, key order, scalar/flow style, BOM, line endings, and the
// body below the closing `---` byte-for-byte. Used only by `updateRecipeMetadata`
// (this package writes; `packages/cooklang`'s `searchRecipes` only reads, via
// its own copy of `metadata-matcher.ts`).

import { Document, isMap, isScalar, isSeq, parseDocument, YAMLMap, YAMLSeq } from 'yaml';
import { splitFrontmatterBlock } from './metadata-matcher';

export interface MetadataEditOps {
    addTags?: string[];
    removeTags?: string[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    set?: Record<string, any>;
    unset?: string[];
}

export interface MetadataEditChanged {
    status: 'changed';
    content: string;
    /** The touched frontmatter key(s) as they read before the edit (empty if newly added). */
    beforeLines: string[];
    /** The touched frontmatter key(s) as they read after the edit (empty if removed). */
    afterLines: string[];
}
export interface MetadataEditUnchanged { status: 'unchanged' }
export interface MetadataEditSkipped { status: 'skipped'; reason: string }

export type MetadataEditResult = MetadataEditChanged | MetadataEditUnchanged | MetadataEditSkipped;

const TAGS_KEY = 'tags';

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Grabs a top-level YAML key's line(s) — the key line plus any indented continuation. */
function extractKeyBlock(yamlText: string, key: string): string {
    const lines = yamlText.split('\n');
    const keyRe = new RegExp(`^${escapeRegExp(key)}\\s*:`);
    const startIndex = lines.findIndex(line => keyRe.test(line));
    if (startIndex === -1) {
        return '';
    }
    const collected = [lines[startIndex]];
    for (let i = startIndex + 1; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim() === '' || /^\S/.test(line)) {
            break;
        }
        collected.push(line);
    }
    return collected.join('\n');
}

function dedupeCaseInsensitive(tags: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const tag of tags) {
        const key = tag.toLowerCase();
        if (!seen.has(key)) {
            seen.add(key);
            result.push(tag);
        }
    }
    return result;
}

function applySeqTags(doc: Document, seq: YAMLSeq, addTags: string[], removeTags: string[]): boolean {
    let changed = false;
    const removeLower = new Set(removeTags.map(t => t.toLowerCase()));
    for (let i = seq.items.length - 1; i >= 0; i--) {
        const item = seq.items[i];
        const value = isScalar(item) ? String(item.value) : String(item);
        if (removeLower.has(value.toLowerCase())) {
            seq.items.splice(i, 1);
            changed = true;
        }
    }
    const currentLower = new Set(seq.items.map(item => (isScalar(item) ? String(item.value) : String(item)).toLowerCase()));
    for (const tag of addTags) {
        if (!currentLower.has(tag.toLowerCase())) {
            seq.items.push(doc.createNode(tag));
            currentLower.add(tag.toLowerCase());
            changed = true;
        }
    }
    return changed;
}

function applyStringTags(scalarNode: { value: unknown }, addTags: string[], removeTags: string[]): boolean {
    const original = String(scalarNode.value ?? '');
    let list = original.length > 0 ? original.split(',').map(s => s.trim()).filter(s => s.length > 0) : [];
    let changed = false;
    const removeLower = new Set(removeTags.map(t => t.toLowerCase()));
    const filtered = list.filter(t => !removeLower.has(t.toLowerCase()));
    if (filtered.length !== list.length) {
        changed = true;
    }
    list = filtered;
    const currentLower = new Set(list.map(t => t.toLowerCase()));
    for (const tag of addTags) {
        if (!currentLower.has(tag.toLowerCase())) {
            list.push(tag);
            currentLower.add(tag.toLowerCase());
            changed = true;
        }
    }
    if (changed) {
        scalarNode.value = list.join(', ');
    }
    return changed;
}

function ensureMapContents(doc: Document): YAMLMap {
    if (doc.contents === null || doc.contents === undefined || !isMap(doc.contents)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        doc.contents = doc.createNode({}) as any;
    }
    return doc.contents as YAMLMap;
}

function applyTagsOp(doc: Document, addTags: string[], removeTags: string[]): boolean {
    const contents = doc.contents;
    const existingNode = contents !== null && contents !== undefined && isMap(contents) ? contents.get(TAGS_KEY, true) : undefined;
    if (existingNode !== undefined && isSeq(existingNode)) {
        return applySeqTags(doc, existingNode, addTags, removeTags);
    }
    if (existingNode !== undefined && isScalar(existingNode) && typeof existingNode.value === 'string') {
        return applyStringTags(existingNode, addTags, removeTags);
    }
    if (existingNode === undefined) {
        if (addTags.length === 0) {
            return false;
        }
        const deduped = dedupeCaseInsensitive(addTags);
        const seq = new YAMLSeq(doc.schema);
        seq.flow = true;
        for (const tag of deduped) {
            seq.items.push(doc.createNode(tag));
        }
        ensureMapContents(doc).set(TAGS_KEY, seq);
        return true;
    }
    // tags exists but is neither a list nor a string (e.g. a number) — leave it alone rather than clobber it.
    return false;
}

/**
 * Applies `ops` to `content`'s YAML frontmatter, preserving everything else.
 *
 * - No frontmatter and no deprecated `>>` metadata: a new frontmatter block is
 *   created at the top, only if `ops` actually produces a non-empty result.
 * - Deprecated `>>` metadata (no frontmatter): skipped, never rewritten.
 * - Invalid or non-mapping YAML: skipped, never rewritten.
 * - A no-op edit (e.g. adding an already-present tag) reports `unchanged`.
 */
export function editFrontmatter(content: string, ops: MetadataEditOps): MetadataEditResult {
    const block = splitFrontmatterBlock(content);
    if (block.kind === 'deprecated') {
        return { status: 'skipped', reason: 'uses deprecated >> metadata; convert to frontmatter first' };
    }
    if (block.kind === 'unterminated') {
        return { status: 'skipped', reason: 'unterminated frontmatter block (missing closing ---)' };
    }

    const hasFrontmatter = block.kind === 'yaml';
    const { bom, eol } = block;
    const originalYamlText = hasFrontmatter ? block.yamlText : '';

    let doc: Document;
    if (hasFrontmatter) {
        doc = parseDocument(originalYamlText);
        if (doc.errors.length > 0) {
            return { status: 'skipped', reason: `invalid YAML frontmatter: ${doc.errors[0].message}` };
        }
        if (doc.contents !== null && doc.contents !== undefined && !isMap(doc.contents)) {
            return { status: 'skipped', reason: 'frontmatter is not a YAML mapping' };
        }
    } else {
        doc = new Document({});
        doc.contents = null; // eslint-disable-line no-null/no-null
    }

    const addTags = ops.addTags ?? [];
    const removeTags = ops.removeTags ?? [];
    const tagsChanged = (addTags.length > 0 || removeTags.length > 0) && applyTagsOp(doc, addTags, removeTags);

    const setKeys = Object.keys(ops.set ?? {});
    const changedSetKeys: string[] = [];
    for (const key of setKeys) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const value = (ops.set as Record<string, any>)[key];
        const contents = doc.contents;
        const before = contents !== null && contents !== undefined && isMap(contents) ? contents.get(key) : undefined;
        if (JSON.stringify(before) !== JSON.stringify(value)) {
            ensureMapContents(doc).set(key, value);
            changedSetKeys.push(key);
        }
    }

    const unsetKeys: string[] = [];
    for (const key of ops.unset ?? []) {
        const contents = doc.contents;
        if (contents !== null && contents !== undefined && isMap(contents) && contents.has(key)) {
            contents.delete(key);
            unsetKeys.push(key);
        }
    }

    const changed = tagsChanged || changedSetKeys.length > 0 || unsetKeys.length > 0;
    if (!changed) {
        return { status: 'unchanged' };
    }

    const rawSerialized = doc.contents === null || doc.contents === undefined
        ? ''
        : doc.toString({ lineWidth: 0, flowCollectionPadding: false });
    const newYamlText = rawSerialized.replace(/\r?\n$/, '');

    const touchedKeys = [...(tagsChanged ? [TAGS_KEY] : []), ...changedSetKeys, ...unsetKeys];
    const originalYamlNormalized = originalYamlText.split(/\r\n|\n/).join('\n');
    const beforeLines = touchedKeys.map(key => extractKeyBlock(originalYamlNormalized, key)).filter(l => l.length > 0);
    const afterLines = touchedKeys.map(key => extractKeyBlock(newYamlText, key)).filter(l => l.length > 0);

    const yamlForFile = eol === '\r\n' ? newYamlText.replace(/\n/g, '\r\n') : newYamlText;

    let newContent: string;
    if (hasFrontmatter) {
        newContent = `${bom}---${eol}${yamlForFile}${eol}---${eol}${block.bodyText}`;
    } else {
        const originalBody = content.slice(bom.length);
        newContent = `${bom}---${eol}${yamlForFile}${eol}---${eol}${eol}${originalBody}`;
    }

    return { status: 'changed', content: newContent, beforeLines, afterLines };
}
