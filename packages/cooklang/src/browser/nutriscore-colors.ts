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

import { injectable } from '@theia/core/shared/inversify';
import { ColorContribution } from '@theia/core/lib/browser/color-application-contribution';
import { ColorRegistry } from '@theia/core/lib/browser/color-registry';

/**
 * Nutri-Score grade colors. These are the official label colors, not theme
 * colors, so they are the same in every theme; registered (not hard-coded in
 * CSS) so a theme can still override them.
 *
 * The letter colors deviate from the official logo, which prints every
 * letter in white: white fails WCAG contrast on the lighter B/C/D backgrounds
 * (2.3:1, 1.5:1, 2.7:1), so those three grades use a dark letter instead
 * (`cooklang.nutriscoreForegroundDark`) while A and E, whose backgrounds are
 * dark enough, keep the logo's white (`cooklang.nutriscoreForegroundLight`).
 */
@injectable()
export class NutriScoreColorContribution implements ColorContribution {
    registerColors(colors: ColorRegistry): void {
        const grade = (letter: string, color: string): void => {
            colors.register({
                id: `cooklang.nutriscore${letter}`,
                defaults: { dark: color, light: color, hcDark: color, hcLight: color },
                description: `Nutri-Score grade ${letter} color in the recipe preview.`,
            });
        };
        grade('A', '#038141');
        grade('B', '#85BB2F');
        grade('C', '#FECB02');
        grade('D', '#EE8100');
        grade('E', '#E63E11');
        colors.register({
            id: 'cooklang.nutriscoreForegroundLight',
            defaults: { dark: '#FFFFFF', light: '#FFFFFF', hcDark: '#FFFFFF', hcLight: '#FFFFFF' },
            description: 'Letter color on the Nutri-Score strip for grades with a dark background (A, E).',
        });
        colors.register({
            id: 'cooklang.nutriscoreForegroundDark',
            defaults: { dark: '#1B1B1B', light: '#1B1B1B', hcDark: '#1B1B1B', hcLight: '#1B1B1B' },
            description: 'Letter color on the Nutri-Score strip for grades with a light background (B, C, D).',
        });
    }
}
