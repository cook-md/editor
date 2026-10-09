// *****************************************************************************
// Copyright (C) 2026 cook.md and contributors
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

import { expect } from 'chai';
import { enableJSDOM } from './test/jsdom';

let disableJSDOM = enableJSDOM();

import { AbstractDialog, DialogError, DialogMode, DialogOverlayService } from './dialogs';
import { Deferred } from '../common/promise-util';

disableJSDOM();

class SlowValidationDialog extends AbstractDialog<string> {

    readonly validation = new Deferred<DialogError>();

    constructor() {
        super({ title: '' });
    }

    get value(): string {
        return 'accepted';
    }

    override accept(): Promise<void> {
        return super.accept();
    }

    protected override isValid(value: string, mode: DialogMode): Promise<DialogError> {
        return mode === 'open' ? this.validation.promise : Promise.resolve('');
    }
}

describe('AbstractDialog', () => {

    before(() => {
        disableJSDOM = enableJSDOM();
        new DialogOverlayService().initialize();
    });
    after(() => disableJSDOM());

    it('does not throw when closed while accept() is still validating', async () => {
        const dialog = new SlowValidationDialog();
        const result = dialog.open();
        const accepting = dialog.accept();
        dialog.close();
        dialog.validation.resolve('');

        await accepting;
        expect(await result).to.equal(undefined);
    });
});
