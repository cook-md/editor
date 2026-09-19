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

// The `where` grammar's JSON shape only. Matching itself happens natively —
// `recipe-metadata-source.ts` sends this JSON straight to cooklang-find's
// `searchRecipesFiltered` (`MetadataFilter::from_json`), so these types are
// the wire contract, not an implementation to keep in sync by hand.
//
// `packages/cooklang-ai`'s `updateRecipeMetadata` has no access to the
// language-server RPC this package uses, so it keeps a full TypeScript
// implementation of this grammar (matcher + frontmatter reader) at
// `packages/cooklang-ai/src/browser/file-tools/metadata-matcher.ts` — the
// two must still agree on the grammar below, but that file is no longer a
// verbatim duplicate of this one.

// ── The `where` grammar ─────────────────────────────────────────────────
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
