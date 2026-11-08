// *****************************************************************************
// Copyright (C) 2026 Cooklang contributors.
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
import { NavigatorClipboard } from './navigator-clipboard';

describe('NavigatorClipboard.parseUris', () => {

    const parse = (text: string): string[] => NavigatorClipboard.parseUris(text).map(uri => uri.toString());

    it('parses URIs written by the navigator copy handler', () => {
        expect(parse('file:///recipes/a.cook\nfile:///recipes/b%20c.cook')).to.deep.equal([
            'file:///recipes/a.cook',
            'file:///recipes/b%20c.cook'
        ]);
    });

    it('tolerates CRLF line endings and a trailing newline', () => {
        expect(parse('file:///a.cook\r\nfile:///b.cook\r\n')).to.deep.equal(['file:///a.cook', 'file:///b.cook']);
    });

    it('ignores text whose prefix would be an illegal URI scheme', () => {
        expect(parse('Step 1: chop the onions')).to.deep.equal([]);
    });

    it('ignores plain text that has no scheme', () => {
        expect(parse('two onions')).to.deep.equal([]);
    });

    it('ignores the whole paste when any line is not a URI', () => {
        expect(parse('file:///a.cook\nsome note')).to.deep.equal([]);
    });
});
