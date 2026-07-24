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

export const MAX_IMPORT_IMAGES = 5;
const MAX_EDGE_PX = 2048;
const JPEG_QUALITY = 0.7;

/**
 * Downscales (longest edge <= 2048px) and re-encodes an image file as a
 * base64 JPEG string (no data-URL prefix), matching the payload the
 * cookify images endpoint expects.
 */
export namespace ImageEncoder {

    export async function toBase64Jpeg(file: File): Promise<string> {
        const bitmap = await createImageBitmap(file);
        try {
            const scale = Math.min(1, MAX_EDGE_PX / Math.max(bitmap.width, bitmap.height));
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(bitmap.width * scale);
            canvas.height = Math.round(bitmap.height * scale);
            const context = canvas.getContext('2d');
            if (!context) {
                throw new Error('Canvas 2D context unavailable');
            }
            context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
            const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
            return dataUrl.substring(dataUrl.indexOf(',') + 1);
        } finally {
            bitmap.close();
        }
    }
}
