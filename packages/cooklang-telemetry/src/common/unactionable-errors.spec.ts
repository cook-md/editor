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

import { expect } from 'chai';
import { ScrubbableEvent } from './scrub';
import { isUnactionableError } from './unactionable-errors';

const withException = (value: string): ScrubbableEvent => ({ exception: { values: [{ value }] } });

describe('isUnactionableError', () => {

    it('drops a broken stdout pipe reported through the console integration', () => {
        expect(isUnactionableError(withException('write EIO'))).to.be.true;
        expect(isUnactionableError(withException('write EPIPE'))).to.be.true;
    });

    it('keeps a real filesystem IO failure', () => {
        // Node words a failed file write differently, and that one is ours to fix.
        expect(isUnactionableError(withException("EIO: i/o error, write '/Volumes/x/a.cook'"))).to.be.false;
        expect(isUnactionableError(withException('Unable to write file \'.shopping-list\''))).to.be.false;
    });

    it('keeps errors that merely mention the phrase', () => {
        expect(isUnactionableError(withException('Failed to write EIO handler config'))).to.be.false;
    });

    it('keeps an event with no exception', () => {
        expect(isUnactionableError({})).to.be.false;
        expect(isUnactionableError({ exception: { values: [] } })).to.be.false;
        expect(isUnactionableError({ exception: { values: [{}] } })).to.be.false;
    });

    it('drops when any exception in the chain is a broken pipe', () => {
        expect(isUnactionableError({
            exception: { values: [{ value: 'write EIO' }, { value: 'wrapper' }] }
        })).to.be.true;
    });

});
