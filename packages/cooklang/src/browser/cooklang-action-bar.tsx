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
import { OutletItem } from './cooklang-outlet-service';

import '../../src/browser/style/cooklang-action-bar.css';

export interface CooklangActionBarProps {
    items: readonly OutletItem[];
    onRun: (id: string) => void;
    className?: string;
}

/** Icon buttons for the items of a Cooklang outlet. Renders nothing when empty. */
export const CooklangActionBar = ({ items, onRun, className }: CooklangActionBarProps): React.ReactElement | null => {
    if (items.length === 0) {
        return null; // eslint-disable-line no-null/no-null
    }
    return (
        <div className={className ? `theia-cooklang-action-bar ${className}` : 'theia-cooklang-action-bar'}>
            {items.map(item => <ActionBarButton key={item.id} item={item} onRun={onRun} />)}
        </div>
    );
};

interface ActionBarButtonProps {
    item: OutletItem;
    onRun: (id: string) => void;
}

const ActionBarButton = ({ item, onRun }: ActionBarButtonProps): React.ReactElement => (
    <button className='theia-cooklang-action-bar-button' title={item.label} aria-label={item.label} onClick={() => onRun(item.id)}>
        {item.iconClass ? <span className={item.iconClass}></span> : item.label}
    </button>
);
