// *****************************************************************************
// Copyright (C) 2024-2026 cook.md and contributors
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// This Source Code may also be made available under the following Secondary
// Licenses when the conditions for such availability set forth in the Eclipse
// Public License v. 2.0 are satisfied: GNU General Public License, version 2
// with the GNU Classpath Exception which is available at
// https://www.gnu.org/software/classpath/license.html.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as React from '@theia/core/shared/react';
import { injectable } from '@theia/core/shared/inversify';
import { ChangeSetActionRenderer } from './change-set-action-service';
import { ChangeSet, ChangeSetElement } from '@theia/ai-chat';
import { nls } from '@theia/core';

/**
 * Reverts every change in the set that is currently written to disk. AI file
 * tools save their edits immediately, so this is the chat-level undo.
 */
@injectable()
export class ChangeSetUndoAction implements ChangeSetActionRenderer {
    readonly id = 'change-set-undo-action';
    readonly priority = 10;

    canRender(changeSet: ChangeSet): boolean {
        return changeSet.getElements().length > 0;
    }

    render(changeSet: ChangeSet): React.ReactNode {
        return <button
            className='theia-button secondary'
            disabled={revertableElements(changeSet).length === 0}
            title={nls.localize('theia/ai/chat-ui/undoAllTitle', 'Undo all changes made in this chat')}
            onClick={() => undoAll(changeSet)}
        >
            {nls.localize('theia/ai/chat-ui/undoAll', 'Undo All')}
        </button>;
    }
}

async function undoAll(changeSet: ChangeSet): Promise<void> {
    for (const element of revertableElements(changeSet)) {
        await element.revert!();
    }
}

function revertableElements(changeSet: ChangeSet): ChangeSetElement[] {
    return changeSet.getElements().filter(e => e.revert && (e.state === 'applied' || e.state === 'stale'));
}
