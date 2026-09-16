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

import { injectable } from '@theia/core/shared/inversify';
import { WidgetOpenHandler } from '@theia/core/lib/browser/widget-open-handler';
import { nls } from '@theia/core/lib/common/nls';
import URI from '@theia/core/lib/common/uri';
import { IMAGE_VIEWER_WIDGET_ID, ImageViewerWidget, imageMimeType } from './image-viewer-widget';

/**
 * Opens image files in the {@link ImageViewerWidget}.
 *
 * Priority sits above the recipe preview (200) and the text editor (100): an
 * image is never text, whatever the explorer's single-click preview mode says.
 */
@injectable()
export class ImageViewerContribution extends WidgetOpenHandler<ImageViewerWidget> {

    static readonly PRIORITY = 300;

    readonly id = IMAGE_VIEWER_WIDGET_ID;
    readonly label = nls.localize('theia/cooklang/imageViewer/label', 'Image Viewer');

    canHandle(uri: URI): number {
        return uri.scheme === 'file' && imageMimeType(uri) !== undefined ? ImageViewerContribution.PRIORITY : 0;
    }

    protected createWidgetOptions(uri: URI): { uri: string } {
        return { uri: uri.toString() };
    }
}
