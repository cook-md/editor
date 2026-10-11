// *****************************************************************************
// Copyright (C) 2026 cook.md and contributors
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

/**
 * Page references for PDF export: an exported document marks a place for a page
 * number with an empty `<span data-page-ref="ID"></span>`, where `ID` is the `id`
 * of an element in the same document (`[A-Za-z0-9_-]`, at most 64 characters).
 * Chromium keeps in-document anchors as named destinations, so after a first
 * `printToPDF` the destinations say which page each `id` landed on, and the
 * numbers are filled in for a second pass.
 */

const PAGE_REF = /<span data-page-ref="([A-Za-z0-9_-]{1,64})"><\/span>/g;

/** Whether the HTML has any page reference to fill. */
export function hasPageRefs(html: string): boolean {
    return new RegExp(PAGE_REF.source).test(html);
}

/** Fill each empty page reference whose `id` has a page; others stay empty. */
export function fillPageRefs(html: string, pages: ReadonlyMap<string, number>): string {
    return html.replace(PAGE_REF, (match, id: string) => {
        const page = pages.get(id);
        return page === undefined ? match : `<span data-page-ref="${id}">${page}</span>`;
    });
}

/**
 * Named destination → 1-based page number, read from a PDF as Chromium (Skia)
 * writes it: uncompressed objects, a catalog with `/Dests` and a `/Pages` tree.
 * Anything it can't follow is left out; an unreadable PDF gives an empty map.
 */
export function pdfDestinationPages(pdf: Uint8Array): Map<string, number> {
    const result = new Map<string, number>();
    const text = Buffer.from(pdf.buffer, pdf.byteOffset, pdf.byteLength).toString('latin1');
    const objects = indexObjects(text);
    const catalog = [...objects.values()].find(body => /\/Type\s*\/Catalog\b/.test(body));
    if (catalog === undefined) {
        return result;
    }
    const pagesRef = /\/Pages\s+(\d+)\s+\d+\s+R/.exec(catalog)?.[1];
    const destsRef = /\/Dests\s+(\d+)\s+\d+\s+R/.exec(catalog)?.[1];
    const dests = destsRef !== undefined ? objects.get(destsRef) : /\/Dests\s*<<([\s\S]*?)>>/.exec(catalog)?.[1];
    if (pagesRef === undefined || dests === undefined) {
        return result;
    }
    const pageNumbers = new Map<string, number>();
    collectPages(objects, pagesRef, pageNumbers, new Set());
    for (const match of dests.matchAll(/\/((?:[^\s/\[\]<>()%{}]|#[0-9A-Fa-f]{2})+)\s*\[\s*(\d+)\s+\d+\s+R/g)) {
        const page = pageNumbers.get(match[2]);
        if (page !== undefined) {
            result.set(decodeName(match[1]), page);
        }
    }
    return result;
}

/** Object number → the object's dictionary text (up to its stream or `endobj`). */
function indexObjects(text: string): Map<string, string> {
    const objects = new Map<string, string>();
    const header = /(?:^|[\r\n])(\d+)\s+\d+\s+obj\b/g;
    for (let match = header.exec(text); match; match = header.exec(text)) {
        const start = match.index + match[0].length;
        const endobj = text.indexOf('endobj', start);
        const stream = text.indexOf('stream', start);
        const end = endobj === -1 ? text.length : stream !== -1 && stream < endobj ? stream : endobj;
        objects.set(match[1], text.slice(start, end));
        // Skip a stream's bytes: they may contain anything, including an object header.
        const endstream = end === stream ? text.indexOf('endstream', stream) : -1;
        header.lastIndex = endstream === -1 ? end : endstream;
    }
    return objects;
}

function collectPages(objects: Map<string, string>, id: string, pages: Map<string, number>, seen: Set<string>): void {
    const body = objects.get(id);
    if (body === undefined || seen.has(id)) {
        return;
    }
    seen.add(id);
    if (/\/Type\s*\/Pages\b/.test(body)) {
        const kids = /\/Kids\s*\[([^\]]*)\]/.exec(body)?.[1] ?? '';
        for (const match of kids.matchAll(/(\d+)\s+\d+\s+R/g)) {
            collectPages(objects, match[1], pages, seen);
        }
    } else if (/\/Type\s*\/Page\b/.test(body)) {
        pages.set(id, pages.size + 1);
    }
}

function decodeName(name: string): string {
    return name.replace(/#([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}
