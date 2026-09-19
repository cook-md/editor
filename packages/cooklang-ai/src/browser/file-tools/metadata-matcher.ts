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

// Pure, Theia-free: reading and matching a recipe's YAML frontmatter. Used by
// `updateRecipeMetadata`'s selector (this package) and `searchRecipes`'s
// `fields`/`where` digest (`packages/cooklang`). The two packages do not
// depend on each other (see `batch-args.ts` for the precedent), so this file
// is duplicated verbatim at `packages/cooklang/src/browser/metadata-matcher.ts`
// — keep the two in sync by hand.

import { parse as parseYaml } from 'yaml';

// ── The `where` grammar ─────────────────────────────────────────────────
//
// Mirrored by the Rust `cooklang-find` crate: a future change will move this
// matching into `cooklang-native` and have it deserialize the identical JSON
// shape below. Do not add operators, rename keys, or change the ANDed/
// case-insensitive/leaf-matching semantics here without updating that crate
// in lockstep — this file is the spec until then.
//
// `where` is an object of frontmatter key -> condition, every key ANDed.
// A condition is exactly one of:
//   { contains: string | string[] }  - ANY needle is a case-insensitive substring
//                                       of ANY string leaf of the field's value
//   { equals: string }               - case-insensitive equality against ANY
//                                       string leaf of the field's value
//   { has: string }                  - the field (treated as an array) contains
//                                       this value, case-insensitively
//   { missing: string }              - inverse of `has`
//   { exists: boolean }              - whether the key is present at all
//
// "String leaf" walks maps and arrays: on a key whose value is a map, matches
// against any of its string leaf values (e.g. `source: { url, name, author }`);
// on an array, matches any element (recursively leaf-flattened).

export interface WhereContains { contains: string | string[] }
export interface WhereEquals { equals: string }
export interface WhereHas { has: string }
export interface WhereMissing { missing: string }
export interface WhereExists { exists: boolean }

export type WhereCondition = WhereContains | WhereEquals | WhereHas | WhereMissing | WhereExists;

export type WhereClause = Record<string, WhereCondition>;

function leafStrings(value: unknown): string[] {
    if (value === undefined || value === null) {
        return [];
    }
    if (typeof value === 'string') {
        return [value];
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
        return [String(value)];
    }
    if (Array.isArray(value)) {
        return value.flatMap(leafStrings);
    }
    if (typeof value === 'object') {
        return Object.values(value as Record<string, unknown>).flatMap(leafStrings);
    }
    return [];
}

function asNeedles(value: string | string[]): string[] {
    return (Array.isArray(value) ? value : [value]).map(v => v.toLowerCase());
}

function matchesCondition(fieldValue: unknown, condition: WhereCondition): boolean {
    if ('exists' in condition) {
        const present = fieldValue !== undefined;
        return condition.exists ? present : !present;
    }
    if ('contains' in condition) {
        const needles = asNeedles(condition.contains);
        const haystack = leafStrings(fieldValue).map(s => s.toLowerCase());
        return needles.some(needle => haystack.some(h => h.includes(needle)));
    }
    if ('equals' in condition) {
        const needle = condition.equals.toLowerCase();
        return leafStrings(fieldValue).some(h => h.toLowerCase() === needle);
    }
    if ('has' in condition || 'missing' in condition) {
        const target = ('has' in condition ? condition.has : condition.missing).toLowerCase();
        const items = fieldValue === undefined ? [] : (Array.isArray(fieldValue) ? fieldValue : [fieldValue]);
        const has = items.flatMap(leafStrings).some(s => s.toLowerCase() === target);
        return 'has' in condition ? has : !has;
    }
    return false;
}

/** All `where` conditions ANDed against `data` (a parsed frontmatter object). */
export function matchesWhere(data: Record<string, unknown>, where: WhereClause | undefined): boolean {
    if (!where) {
        return true;
    }
    return Object.entries(where).every(([key, condition]) => matchesCondition(data[key], condition));
}

/**
 * Matches `needles` (case-insensitive) against the file's base name (without
 * extension) OR its frontmatter `title`, whichever hits first.
 */
export function matchesTitleContains(fileBaseName: string, title: unknown, needlesArg: string | string[] | undefined): boolean {
    if (needlesArg === undefined) {
        return true;
    }
    const needles = asNeedles(needlesArg);
    const haystacks = [fileBaseName, ...(typeof title === 'string' ? [title] : [])].map(h => h.toLowerCase());
    return needles.some(needle => haystacks.some(h => h.includes(needle)));
}

// ── Splitting a file into (optional) frontmatter + body ────────────────

export interface FrontmatterBlockYaml {
    kind: 'yaml';
    bom: string;
    eol: '\n' | '\r\n';
    /** Raw text between the `---` delimiters (not including the delimiter lines). */
    yamlText: string;
    /** Everything after the closing `---` line, verbatim. */
    bodyText: string;
}
export interface FrontmatterBlockDeprecated { kind: 'deprecated' }
export interface FrontmatterBlockNone { kind: 'none'; bom: string; eol: '\n' | '\r\n' }
export interface FrontmatterBlockUnterminated { kind: 'unterminated'; bom: string; eol: '\n' | '\r\n' }

export type FrontmatterBlock = FrontmatterBlockYaml | FrontmatterBlockDeprecated | FrontmatterBlockNone | FrontmatterBlockUnterminated;

/** A `>> key: value` line — the deprecated Cooklang metadata syntax. */
const DEPRECATED_METADATA_RE = /^>>\s*[^:>][^:]*:/m;

function detectBom(raw: string): { bom: string; rest: string } {
    return raw.charCodeAt(0) === 0xFEFF ? { bom: '﻿', rest: raw.slice(1) } : { bom: '', rest: raw };
}

function detectEol(content: string): '\n' | '\r\n' {
    return content.includes('\r\n') ? '\r\n' : '\n';
}

/**
 * Splits raw file content into its YAML frontmatter (if any) and body,
 * preserving BOM and line-ending style so callers can reassemble byte-for-byte.
 */
export function splitFrontmatterBlock(raw: string): FrontmatterBlock {
    const { bom, rest } = detectBom(raw);
    const eol = detectEol(rest);
    const lines = rest.split(/\r\n|\n/);
    if (lines[0]?.trim() === '---') {
        let closeIndex = -1;
        for (let i = 1; i < lines.length; i++) {
            if (lines[i].trim() === '---') {
                closeIndex = i;
                break;
            }
        }
        if (closeIndex === -1) {
            return { kind: 'unterminated', bom, eol };
        }
        return {
            kind: 'yaml',
            bom,
            eol,
            yamlText: lines.slice(1, closeIndex).join(eol),
            bodyText: lines.slice(closeIndex + 1).join(eol),
        };
    }
    if (DEPRECATED_METADATA_RE.test(rest)) {
        return { kind: 'deprecated' };
    }
    return { kind: 'none', bom, eol };
}

// ── Reading frontmatter into a plain object ─────────────────────────────

export interface FrontmatterYaml { kind: 'yaml'; data: Record<string, unknown> }
export interface FrontmatterDeprecated { kind: 'deprecated' }
export interface FrontmatterNone { kind: 'none' }
export interface FrontmatterInvalid { kind: 'invalid'; error: string }

export type FrontmatterReadResult = FrontmatterYaml | FrontmatterDeprecated | FrontmatterNone | FrontmatterInvalid;

/**
 * Parses a file's YAML frontmatter into a plain object for matching/reading.
 * Never throws: unparseable YAML comes back as `{ kind: 'invalid', error }`,
 * deprecated `>>`-only files as `{ kind: 'deprecated' }`, and files with
 * neither as `{ kind: 'none' }`.
 */
export function readFrontmatter(content: string): FrontmatterReadResult {
    const block = splitFrontmatterBlock(content);
    if (block.kind === 'deprecated') {
        return { kind: 'deprecated' };
    }
    if (block.kind === 'none') {
        return { kind: 'none' };
    }
    if (block.kind === 'unterminated') {
        return { kind: 'invalid', error: 'Unterminated frontmatter block (missing closing ---).' };
    }
    try {
        const parsed: unknown = parseYaml(block.yamlText);
        if (parsed === null || parsed === undefined) {
            return { kind: 'yaml', data: {} };
        }
        if (typeof parsed !== 'object' || Array.isArray(parsed)) {
            return { kind: 'invalid', error: 'Frontmatter is not a YAML mapping.' };
        }
        return { kind: 'yaml', data: parsed as Record<string, unknown> };
    } catch (e) {
        return { kind: 'invalid', error: e instanceof Error ? e.message : String(e) };
    }
}

/** The file's base name without its extension, for `titleContains` matching. */
export function baseNameWithoutExt(path: string): string {
    const base = path.split('/').pop() ?? path;
    const dot = base.lastIndexOf('.');
    return dot > 0 ? base.slice(0, dot) : base;
}
