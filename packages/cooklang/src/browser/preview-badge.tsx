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

import * as React from '@theia/core/shared/react';
import { nls } from '@theia/core/lib/common/nls';
import { PreviewBadge } from '../common/cooklang-outlet-context';

import '../../src/browser/style/preview-badge.css';

const LETTERS = ['A', 'B', 'C', 'D', 'E'] as const;

export interface PreviewBadgeViewProps {
    badge: PreviewBadge;
    /** `immediate` is true for keyboard focus, where the hover delay would feel broken. */
    onShowDetails: (badge: PreviewBadge, target: HTMLElement, immediate: boolean) => void;
    onHideDetails: () => void;
}

/**
 * A plugin badge in the recipe preview header: the official-style Nutri-Score
 * strip (five letter cells, the grade enlarged) or a short text pill. Details
 * live only in the hover card (see `onShowDetails`).
 */
export const PreviewBadgeView = ({ badge, onShowDetails, onHideDetails }: PreviewBadgeViewProps): React.ReactElement => {
    const handleMouseEnter = React.useCallback((event: React.MouseEvent<HTMLElement>) => {
        onShowDetails(badge, event.currentTarget, false);
    }, [badge, onShowDetails]);
    const handleFocus = React.useCallback((event: React.FocusEvent<HTMLElement>) => {
        onShowDetails(badge, event.currentTarget, true);
    }, [badge, onShowDetails]);
    if (badge.kind === 'pill') {
        return (
            <span className={`cooklang-badge-pill ${badge.tone}`} tabIndex={0}
                onMouseEnter={handleMouseEnter} onFocus={handleFocus} onBlur={onHideDetails}>
                {badge.text}
            </span>
        );
    }
    const unknown = badge.grade === 'unknown';
    return (
        <div
            className={`cooklang-nutriscore${unknown ? ' unknown' : ''}`}
            role='img'
            tabIndex={0}
            aria-label={nls.localize('theia/cooklang/nutriscoreLabel', 'Nutri-Score {0}', badge.grade)}
            onMouseEnter={handleMouseEnter}
            onFocus={handleFocus}
            onBlur={onHideDetails}
        >
            <span className='cooklang-nutriscore-title'>NUTRI-SCORE</span>
            <span className='cooklang-nutriscore-strip'>
                {LETTERS.map(letter => (
                    <span key={letter}
                        className={`cooklang-nutriscore-cell cooklang-nutriscore-${letter.toLowerCase()}${letter === badge.grade ? ' selected' : ''}`}>
                        {letter}
                    </span>
                ))}
                {unknown && <span className='cooklang-nutriscore-cell selected'>?</span>}
            </span>
        </div>
    );
};
