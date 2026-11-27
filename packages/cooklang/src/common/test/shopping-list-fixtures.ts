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

/**
 * What NAPI `parseShoppingList` returns for this `.shopping-list` (captured from
 * `round_trips_free_hand_lines_through_json` in cooklang-native, which also
 * checks that this JSON writes back to the same text):
 *
 * ```
 * ./Dinner/Pasta{2}
 * milk{2%l}
 * lemons{3}
 * bread
 * ./Plans/Week.menu
 *   ? salt{a pinch}
 *   ? ./Sides/Bread{0.5}
 *   ./Dinner/Soup
 *   olive oil{200%ml}
 * ```
 */
export const FREE_HAND_WIRE_JSON = '{"items":[{"Recipe":{"path":"Dinner/Pasta","multiplier":2.0,"children":[],"optional":false}},'
    + '{"Ingredient":{"name":"milk","quantity":"2%l","optional":false}},{"Ingredient":{"name":"lemons","quantity":"3","optional":false}},'
    + '{"Ingredient":{"name":"bread","quantity":null,"optional":false}},{"Recipe":{"path":"Plans/Week.menu","multiplier":null,"children":['
    + '{"Ingredient":{"name":"salt","quantity":"a pinch","optional":true}},'
    + '{"Recipe":{"path":"Sides/Bread","multiplier":0.5,"children":[],"optional":true}},'
    + '{"Recipe":{"path":"Dinner/Soup","multiplier":null,"children":[],"optional":false}},'
    + '{"Ingredient":{"name":"olive oil","quantity":"200%ml","optional":false}}],"optional":false}}]}';
