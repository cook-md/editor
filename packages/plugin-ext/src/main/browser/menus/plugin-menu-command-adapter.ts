// *****************************************************************************
// Copyright (C) 2022 Ericsson and others.
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

import { MenuPath, SelectionService, UriSelection } from '@theia/core';
import { ResourceContextKey } from '@theia/core/lib/browser/resource-context-key';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { URI as CodeUri } from '@theia/core/shared/vscode-uri';
import { TreeWidgetSelection } from '@theia/core/lib/browser/tree/tree-widget-selection';
import { TreeViewItemReference } from '../../../common';
import { TreeViewWidget } from '../view/tree-view-widget';
import { CodeEditorWidgetUtil, codeToTheiaMappings, ContributionPoint } from './vscode-theia-menu-mappings';

export type ArgumentAdapter = (...args: unknown[]) => unknown[];
function identity(...args: unknown[]): unknown[] {
    return args;
}
@injectable()
export class PluginMenuCommandAdapter {
    @inject(SelectionService) private readonly selectionService: SelectionService;
    @inject(ResourceContextKey) private readonly resourceContextKey: ResourceContextKey;

    protected readonly argumentAdapters = new Map<string, ArgumentAdapter>();

    @postConstruct()
    protected init(): void {
        const toCommentArgs: ArgumentAdapter = (...args) => this.toCommentArgs(...args);
        const firstArgOnly: ArgumentAdapter = (...args) => [args[0]];
        const noArgs: ArgumentAdapter = () => [];
        const selectedResource = () => this.getSelectedResources();
        const widgetURI: ArgumentAdapter = widget => CodeEditorWidgetUtil.is(widget) ? [CodeEditorWidgetUtil.getResourceUri(widget)] : [];
        (<Array<[ContributionPoint, ArgumentAdapter]>>[
            ['comments/comment/context', toCommentArgs],
            ['comments/comment/title', toCommentArgs],
            ['comments/commentThread/context', toCommentArgs],
            ['debug/callstack/context', firstArgOnly],
            ['debug/variables/context', firstArgOnly],
            ['debug/toolBar', noArgs],
            ['editor/context', selectedResource],
            ['editor/content', widgetURI],
            ['editor/title', widgetURI],
            ['editor/title/context', selectedResource],
            ['editor/title/run', widgetURI],
            ['explorer/context', selectedResource],
            ['view/item/context', (...args) => this.toTreeArgs(...args)],
            ['view/title', noArgs],
            ['webview/context', firstArgOnly],
            ['extension/context', noArgs],
        ]).forEach(([contributionPoint, adapter]) => {
            this.argumentAdapters.set(contributionPoint, adapter);
        });
    }

    getArgumentAdapter(menuPath: MenuPath): ArgumentAdapter {
        for (const [contributionPoint, menuPaths] of codeToTheiaMappings) {
            for (const theiaPath of menuPaths) {
                if (this.isPrefixOf(theiaPath, menuPath)) {
                    return this.argumentAdapters.get(contributionPoint) || identity;
                }
            }
        }
        return identity;
    }

    private isPrefixOf(candidate: string[], menuPath: MenuPath): boolean {
        if (candidate.length > menuPath.length) {
            return false;
        }
        for (let i = 0; i < candidate.length; i++) {
            if (candidate[i] !== menuPath[i]) {
                return false;
            }
        }
        return true;
    }

    /* eslint-disable @typescript-eslint/no-explicit-any */

    protected toCommentArgs(...args: any[]): any[] {
        const arg = args[0];
        if ('text' in arg) {
            if ('commentUniqueId' in arg) {
                return [{
                    commentControlHandle: arg.thread.controllerHandle,
                    commentThreadHandle: arg.thread.commentThreadHandle,
                    text: arg.text,
                    commentUniqueId: arg.commentUniqueId
                }];
            }
            return [{
                commentControlHandle: arg.thread.controllerHandle,
                commentThreadHandle: arg.thread.commentThreadHandle,
                text: arg.text
            }];
        }
        return [{
            commentControlHandle: arg.thread.controllerHandle,
            commentThreadHandle: arg.thread.commentThreadHandle,
            commentUniqueId: arg.commentUniqueId
        }];
    }

    protected toTreeArgs(...args: any[]): any[] {
        const treeArgs: any[] = [];
        for (const arg of args) {
            if (TreeViewItemReference.is(arg)) {
                treeArgs.push(arg);
            } else if (Array.isArray(arg)) {
                treeArgs.push(arg.filter(TreeViewItemReference.is));
            }
        }
        return treeArgs;
    }

    protected getSelectedResources(): [CodeUri | TreeViewItemReference | undefined, CodeUri[] | undefined] {
        const selection = this.selectionService.selection;
        const resourceKey = this.resourceContextKey.get();
        const resourceUri = resourceKey ? CodeUri.parse(resourceKey) : undefined;
        const firstMember = TreeWidgetSelection.is(selection) && selection.source instanceof TreeViewWidget && selection[0]
            ? selection.source.toTreeViewItemReference(selection[0])
            : UriSelection.getUri(selection)?.['codeUri'] ?? resourceUri;
        const secondMember = TreeWidgetSelection.is(selection)
            ? UriSelection.getUris(selection).map(uri => uri['codeUri'])
            : undefined;
        return [firstMember, secondMember];
    }
    /* eslint-enable @typescript-eslint/no-explicit-any */
}
