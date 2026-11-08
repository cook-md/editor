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

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
enableJSDOM();
import { FrontendApplicationConfigProvider } from '@theia/core/lib/browser/frontend-application-config-provider';
try {
    FrontendApplicationConfigProvider.set({});
} catch {
    // Another spec in this mocha process has already set the configuration.
}

import { expect } from 'chai';
import { Emitter } from '@theia/core/lib/common';
import { EditorContribution } from './editor-contribution';
import { EditorWidget } from './editor-widget';

describe('EditorContribution', () => {

    /** Exposes the injected fields so that they can be stubbed without a container. */
    class TestableEditorContribution extends EditorContribution {
        stub(fields: object): void {
            Object.assign(this, fields);
        }
    }

    const setup = (): { removed: string[], languageUpdates: unknown[], onCurrentEditorChanged: Emitter<EditorWidget | undefined> } => {
        const removed: string[] = [];
        const languageUpdates: unknown[] = [];
        const onCurrentEditorChanged = new Emitter<EditorWidget | undefined>();
        const contribution = new TestableEditorContribution();
        contribution.stub({
            editorManager: {
                all: [],
                label: 'Text Editor',
                onCreated: () => undefined,
                onCurrentEditorChanged: onCurrentEditorChanged.event
            },
            contextKeyService: { createKey: () => ({ set: () => undefined }) },
            openWithService: { registerHandler: () => undefined },
            languageStatusService: { updateLanguageStatus: (editor: unknown) => languageUpdates.push(editor) },
            statusBar: { removeElement: (id: string) => removed.push(id) }
        });
        contribution.onStart();
        return { removed, languageUpdates, onCurrentEditorChanged };
    };

    it('clears the editor status items when no editor is current any more', () => {
        const { removed, languageUpdates, onCurrentEditorChanged } = setup();
        onCurrentEditorChanged.fire(undefined);
        expect(removed).to.include('editor-status-encoding');
        expect(languageUpdates).to.deep.equal([undefined]);
    });

    it('leaves the status items alone when another editor becomes current', () => {
        const { removed, languageUpdates, onCurrentEditorChanged } = setup();
        onCurrentEditorChanged.fire({} as EditorWidget);
        expect(removed).to.deep.equal([]);
        expect(languageUpdates).to.deep.equal([]);
    });
});
