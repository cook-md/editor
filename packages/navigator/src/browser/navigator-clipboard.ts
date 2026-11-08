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

import URI from '@theia/core/lib/common/uri';

export namespace NavigatorClipboard {

    /** The explicit `scheme://` prefix of a URI placed on the clipboard by a navigator copy. */
    const URI_LINE = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;

    /**
     * Reads file URIs from clipboard text.
     *
     * The clipboard holds whatever the user last copied, so ordinary text has to be told
     * apart from a navigator copy: `new URI` throws on `Step 1: chop` (an illegal scheme)
     * and silently turns `two onions` into a `file:` URI.
     *
     * @returns the URIs, or an empty array unless every non-blank line is a URI.
     */
    export function parseUris(text: string): URI[] {
        const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
        return lines.every(line => URI_LINE.test(line)) ? lines.map(line => new URI(line)) : [];
    }
}
