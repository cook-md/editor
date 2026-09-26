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

/**
 * One pantry item as `cooklang.api.parsePantry` returns it. Raw attribute
 * strings are as written in `pantry.conf` (quantities like `500%g`); absent
 * attributes are omitted.
 */
export interface PantryItemInfo {
    name: string;
    quantity?: string;
    bought?: string;
    expire?: string;
    low?: string;
    /** Quantity is at or below `low` (same unit). */
    isLow: boolean;
    /** Quantity parses to zero. An item without a quantity is in stock. */
    isOutOfStock: boolean;
    /** `expire` as `YYYY-MM-DD`; omitted when absent or unparseable. */
    expireDate?: string;
    /** `bought` as `YYYY-MM-DD`; omitted when absent or unparseable. */
    boughtDate?: string;
}

/** A `[section]` of `pantry.conf`; items above the first header are in `general`. */
export interface PantrySectionInfo {
    name: string;
    items: PantryItemInfo[];
}

/** Result of `cooklang.api.parsePantry`, sections in file order. */
export interface PantryContents {
    sections: PantrySectionInfo[];
}

/**
 * Attributes of a pantry edit. On `update`, an omitted attribute is left
 * alone and an empty string removes it.
 */
export interface PantryAttributes {
    quantity?: string;
    bought?: string;
    expire?: string;
    low?: string;
}

/** Argument `edit` of `cooklang.api.editPantry`. */
export type PantryEdit =
    | ({ op: 'add'; section: string; name: string } & PantryAttributes)
    | { op: 'update'; section: string; name: string; fields: PantryAttributes }
    | { op: 'remove'; section: string; name: string };
