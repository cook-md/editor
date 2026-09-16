// *****************************************************************************
// Copyright (C) 2017 Ericsson and others.
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

import { enableJSDOM } from '../test/jsdom';
let disableJSDOM = enableJSDOM();

import { expect } from 'chai';
import { Key, KeyCode } from '../keyboard/keys';
import { addKeyListener } from './widget';

disableJSDOM();

describe('addKeyListener', () => {

    // Sibling specs tear JSDOM down at module level, so each test brings its own.
    beforeEach(() => {
        disableJSDOM = enableJSDOM();
    });

    afterEach(() => {
        disableJSDOM();
    });

    /** The shape some layouts and IMEs deliver: no usable `code`, `keyCode` or `keyIdentifier`. */
    function undeterminableKeyEvent(): KeyboardEvent {
        const event = new KeyboardEvent('keydown', { key: 'Process' });
        Object.defineProperty(event, 'code', { value: '' });
        Object.defineProperty(event, 'keyCode', { value: 0 });
        return event;
    }

    it('invokes the action for a matching key', () => {
        const element = document.createElement('div');
        let calls = 0;
        addKeyListener(element, Key.ENTER, () => { calls++; });

        element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter' }));

        expect(calls).to.equal(1);
    });

    it('ignores a keyboard event whose key cannot be determined', () => {
        // `KeyCode.createKeyCode` throws on such events. The dialog Enter/Escape hooks listen on
        // `document.body`, so the throw would otherwise escape from every keystroke typed through
        // an IME while a dialog is open. (Sentry EDITOR-5)
        const element = document.createElement('div');
        const event = undeterminableKeyEvent();
        expect(() => KeyCode.createKeyCode(event)).to.throw();
        const errors: unknown[] = [];
        const onError = (e: ErrorEvent) => { errors.push(e.error ?? e.message); e.preventDefault(); };
        window.addEventListener('error', onError);
        let calls = 0;
        addKeyListener(element, Key.ENTER, () => { calls++; });

        element.dispatchEvent(event);

        window.removeEventListener('error', onError);
        expect(errors).to.deep.equal([]);
        expect(calls).to.equal(0);
    });
});
