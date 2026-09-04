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

import { Container, inject, injectable, interfaces } from '@theia/core/shared/inversify';
import * as React from '@theia/core/shared/react';
import URI from '@theia/core/lib/common/uri';
import { ContextMenuRenderer, SelectableTreeNode, TreeNode, TreeProps } from '@theia/core/lib/browser';
import { createFileTreeContainer } from '@theia/filesystem/lib/browser';
import { FileNode } from '@theia/filesystem/lib/browser/file-tree';
import { EditorManager } from '@theia/editor/lib/browser';
import { FileNavigatorTree } from '@theia/navigator/lib/browser/navigator-tree';
import { FileNavigatorModel } from '@theia/navigator/lib/browser/navigator-model';
import { FileNavigatorWidget } from '@theia/navigator/lib/browser/navigator-widget';
import { NavigatorDecoratorService } from '@theia/navigator/lib/browser/navigator-decorator-service';
import { FILE_NAVIGATOR_PROPS } from '@theia/navigator/lib/browser/navigator-container';
import { CooklangUri } from '../common/cooklang-uri';

/**
 * The explorer, with `alt`/`option` as the "give me the source" modifier.
 *
 * Cooklang files open in their preview, which is what you want when reading a
 * recipe and in the way when editing one. Holding `alt` while opening a recipe
 * or menu from the explorer opens the text editor instead - the same gesture
 * as the `Open Source` command, without hunting through the context menu.
 */
@injectable()
export class CooklangFileNavigatorWidget extends FileNavigatorWidget {

    @inject(EditorManager)
    protected readonly editorManager: EditorManager;

    constructor(
        @inject(TreeProps) props: TreeProps,
        @inject(FileNavigatorModel) override readonly model: FileNavigatorModel,
        @inject(ContextMenuRenderer) contextMenuRenderer: ContextMenuRenderer
    ) {
        super(props, model, contextMenuRenderer);
    }

    protected override handleClickEvent(node: TreeNode | undefined, event: React.MouseEvent<HTMLElement>): void {
        if (this.opensSource(node, event)) {
            event.stopPropagation();
            if (SelectableTreeNode.is(node)) {
                this.model.selectNode(node);
            }
            // A single click opens only if the user asked for that open mode,
            // exactly as it does without the modifier.
            if (this.corePreferences['workbench.list.openMode'] === 'singleClick') {
                this.openSource(node.uri, true);
            }
            return;
        }
        super.handleClickEvent(node, event);
    }

    protected override handleDblClickEvent(node: TreeNode | undefined, event: React.MouseEvent<HTMLElement>): void {
        if (this.opensSource(node, event)) {
            event.stopPropagation();
            this.openSource(node.uri, false);
            return;
        }
        super.handleDblClickEvent(node, event);
    }

    /** Whether this click asks for the source of a Cooklang file. */
    protected opensSource(node: TreeNode | undefined, event: React.MouseEvent<HTMLElement>): node is FileNode {
        return event.altKey && FileNode.is(node) && CooklangUri.isCooklang(node.uri);
    }

    protected openSource(uri: URI, preview: boolean): void {
        this.editorManager.open(uri, { mode: 'activate', preview });
    }
}

export function createCooklangFileNavigatorContainer(parent: interfaces.Container): Container {
    return createFileTreeContainer(parent, {
        tree: FileNavigatorTree,
        model: FileNavigatorModel,
        widget: CooklangFileNavigatorWidget,
        decoratorService: NavigatorDecoratorService,
        props: FILE_NAVIGATOR_PROPS,
    });
}

export function createCooklangFileNavigatorWidget(parent: interfaces.Container): FileNavigatorWidget {
    return createCooklangFileNavigatorContainer(parent).get(CooklangFileNavigatorWidget);
}
