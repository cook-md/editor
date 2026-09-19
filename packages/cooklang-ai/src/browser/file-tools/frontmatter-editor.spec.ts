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

// Pure module, no Theia imports — no jsdom preamble needed.

import { expect } from 'chai';
import { editFrontmatter, MetadataEditChanged, MetadataEditSkipped } from './frontmatter-editor';

function changed(result: ReturnType<typeof editFrontmatter>): MetadataEditChanged {
    expect(result.status).to.equal('changed');
    return result as MetadataEditChanged;
}

function skipped(result: ReturnType<typeof editFrontmatter>): MetadataEditSkipped {
    expect(result.status).to.equal('skipped');
    return result as MetadataEditSkipped;
}

describe('editFrontmatter', () => {

    describe('tags — flow list', () => {
        it('adds a tag, keeping flow style', () => {
            const result = changed(editFrontmatter('---\ntags: [Fish, quick]\n---\nBody', { addTags: ['Korean'] }));
            expect(result.content).to.equal('---\ntags: [Fish, quick, Korean]\n---\nBody');
        });

        it('removes a tag, keeping flow style', () => {
            const result = changed(editFrontmatter('---\ntags: [Fish, Korean, quick]\n---\nBody', { removeTags: ['Korean'] }));
            expect(result.content).to.equal('---\ntags: [Fish, quick]\n---\nBody');
        });
    });

    describe('tags — block list', () => {
        it('adds a tag, keeping block style', () => {
            const result = changed(editFrontmatter('---\ntags:\n  - Fish\n  - quick\n---\nBody', { addTags: ['Korean'] }));
            expect(result.content).to.equal('---\ntags:\n  - Fish\n  - quick\n  - Korean\n---\nBody');
        });

        it('removes a tag, keeping block style', () => {
            const result = changed(editFrontmatter('---\ntags:\n  - Fish\n  - Korean\n---\nBody', { removeTags: ['Korean'] }));
            expect(result.content).to.equal('---\ntags:\n  - Fish\n---\nBody');
        });
    });

    describe('tags — comma-separated string', () => {
        it('adds a tag, keeping the comma-string style', () => {
            const result = changed(editFrontmatter('---\ntags: Fish, quick\n---\nBody', { addTags: ['Korean'] }));
            expect(result.content).to.equal('---\ntags: Fish, quick, Korean\n---\nBody');
        });

        it('removes a tag, keeping the comma-string style', () => {
            const result = changed(editFrontmatter('---\ntags: Fish, Korean, quick\n---\nBody', { removeTags: ['Korean'] }));
            expect(result.content).to.equal('---\ntags: Fish, quick\n---\nBody');
        });
    });

    describe('tags — case-insensitive dedupe', () => {
        it('is a no-op when the tag already exists in a different case, keeping the existing spelling', () => {
            const result = editFrontmatter('---\ntags: [korean, Fish]\n---\nBody', { addTags: ['Korean'] });
            expect(result.status).to.equal('unchanged');
        });

        it('removes case-insensitively', () => {
            const result = changed(editFrontmatter('---\ntags: [Korean, Fish]\n---\nBody', { removeTags: ['korean'] }));
            expect(result.content).to.equal('---\ntags: [Fish]\n---\nBody');
        });

        it('dedupes new tags being added together, case-insensitively', () => {
            const result = changed(editFrontmatter('---\ntitle: X\n---\nBody', { addTags: ['Korean', 'korean', 'Spicy'] }));
            expect(result.content).to.include('tags: [Korean, Spicy]');
        });
    });

    describe('no frontmatter', () => {
        it('creates a new frontmatter block with a flow tags list, without altering the body', () => {
            const result = changed(editFrontmatter('Cook @salmon{200%g}.\n', { addTags: ['Korean'] }));
            expect(result.content).to.equal('---\ntags: [Korean]\n---\n\nCook @salmon{200%g}.\n');
        });

        it('is a no-op (does not create an empty frontmatter block) when there is nothing to add', () => {
            const result = editFrontmatter('Cook @salmon{200%g}.\n', { removeTags: ['Korean'], unset: ['difficulty'] });
            expect(result.status).to.equal('unchanged');
        });

        it('creates frontmatter for a `set` with no prior frontmatter', () => {
            const result = changed(editFrontmatter('Body text.\n', { set: { cuisine: 'Korean' } }));
            expect(result.content).to.equal('---\ncuisine: Korean\n---\n\nBody text.\n');
        });
    });

    describe('deprecated >> metadata', () => {
        it('skips a file using >> metadata instead of rewriting it', () => {
            const result = skipped(editFrontmatter('>> title: Salmon\n>> tags: fish\n\nCook @salmon{200%g}.\n', { addTags: ['Korean'] }));
            expect(result.reason).to.match(/deprecated >>/);
        });
    });

    describe('line endings and BOM', () => {
        it('preserves CRLF line endings', () => {
            const result = changed(editFrontmatter('---\r\ntags: [Fish]\r\n---\r\nBody', { addTags: ['Korean'] }));
            expect(result.content).to.equal('---\r\ntags: [Fish, Korean]\r\n---\r\nBody');
        });

        it('preserves a BOM', () => {
            const result = changed(editFrontmatter('﻿---\ntags: [Fish]\n---\nBody', { addTags: ['Korean'] }));
            expect(result.content.startsWith('﻿')).to.equal(true);
            expect(result.content).to.equal('﻿---\ntags: [Fish, Korean]\n---\nBody');
        });
    });

    describe('set / unset', () => {
        it('sets a new key', () => {
            const result = changed(editFrontmatter('---\ntitle: Salmon\n---\nBody', { set: { cuisine: 'Korean' } }));
            expect(result.content).to.equal('---\ntitle: Salmon\ncuisine: Korean\n---\nBody');
        });

        it('overwrites an existing key', () => {
            const result = changed(editFrontmatter('---\ncuisine: Thai\n---\nBody', { set: { cuisine: 'Korean' } }));
            expect(result.content).to.equal('---\ncuisine: Korean\n---\nBody');
        });

        it('is a no-op when the value is already set', () => {
            const result = editFrontmatter('---\ncuisine: Korean\n---\nBody', { set: { cuisine: 'Korean' } });
            expect(result.status).to.equal('unchanged');
        });

        it('unsets a key', () => {
            const result = changed(editFrontmatter('---\ntitle: Salmon\ndifficulty: easy\n---\nBody', { unset: ['difficulty'] }));
            expect(result.content).to.equal('---\ntitle: Salmon\n---\nBody');
        });

        it('is a no-op unsetting a key that is not present', () => {
            const result = editFrontmatter('---\ntitle: Salmon\n---\nBody', { unset: ['difficulty'] });
            expect(result.status).to.equal('unchanged');
        });
    });

    describe('invalid YAML', () => {
        it('skips rather than rewrites unparseable YAML', () => {
            const result = skipped(editFrontmatter('---\ntags: [Fish\n---\nBody', { addTags: ['Korean'] }));
            expect(result.reason).to.match(/invalid YAML/);
        });

        it('skips frontmatter that is not a mapping', () => {
            const result = skipped(editFrontmatter('---\n- one\n- two\n---\nBody', { addTags: ['Korean'] }));
            expect(result.reason).to.match(/mapping/);
        });
    });

    describe('sample before/after', () => {
        it('reports only the touched key lines', () => {
            const result = changed(editFrontmatter('---\ntitle: Salmon\ntags: [Fish]\n---\nBody', { addTags: ['Korean'] }));
            expect(result.beforeLines).to.deep.equal(['tags: [Fish]']);
            expect(result.afterLines).to.deep.equal(['tags: [Fish, Korean]']);
        });

        it('reports an empty before for a newly added key', () => {
            const result = changed(editFrontmatter('---\ntitle: Salmon\n---\nBody', { set: { cuisine: 'Korean' } }));
            expect(result.beforeLines).to.deep.equal([]);
            expect(result.afterLines).to.deep.equal(['cuisine: Korean']);
        });

        it('reports an empty after for a removed key', () => {
            const result = changed(editFrontmatter('---\ncuisine: Korean\n---\nBody', { unset: ['cuisine'] }));
            expect(result.beforeLines).to.deep.equal(['cuisine: Korean']);
            expect(result.afterLines).to.deep.equal([]);
        });
    });
});
