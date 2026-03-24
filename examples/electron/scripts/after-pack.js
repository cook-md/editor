// @ts-check
'use strict';

const path = require('path');
const fs = require('fs');

/**
 * Runs after electron-builder packs the app but before creating installers.
 * Cleans up files not needed in the distribution.
 *
 * @param {import('electron-builder').AfterPackContext} context
 */
exports.default = async function afterPack(context) {
    const appDir = path.join(context.appOutDir, 'resources', 'app');
    if (!fs.existsSync(appDir)) {
        console.log('after-pack: app directory not found, skipping cleanup');
        return;
    }

    // Remove source maps from production builds to save space
    const libDir = path.join(appDir, 'lib');
    if (fs.existsSync(libDir)) {
        removeFilesRecursively(libDir, f => f.endsWith('.js.map'));
    }

    console.log('after-pack: cleanup complete');
};

/**
 * @param {string} dir
 * @param {(filename: string) => boolean} predicate
 */
function removeFilesRecursively(dir, predicate) {
    if (!fs.existsSync(dir)) {
        return;
    }
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            removeFilesRecursively(fullPath, predicate);
        } else if (predicate(entry.name)) {
            fs.unlinkSync(fullPath);
        }
    }
}
