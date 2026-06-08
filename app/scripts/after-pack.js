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

    // macOS only: embed the Quick Look preview extension into Contents/PlugIns
    // so electron-builder's mac signing step seals it and notarization covers it.
    // NOTE: this electron-builder version's AfterPackContext has no `appDir`; the
    // packager's `projectDir` is the electron-builder project root (this `app/`
    // directory), so `..` reaches the repo root where `macos/` lives.
    if (context.electronPlatformName === 'darwin') {
        const projectDir = context.packager.projectDir;
        const appexSrc = path.resolve(
            projectDir, '..', 'macos', 'QuickLookExtension', 'build', 'CookQuickLook.appex'
        );
        if (fs.existsSync(appexSrc)) {
            const appName = `${context.packager.appInfo.productFilename}.app`;
            const plugins = path.join(context.appOutDir, appName, 'Contents', 'PlugIns');
            fs.mkdirSync(plugins, { recursive: true });
            const dest = path.join(plugins, 'CookQuickLook.appex');
            fs.rmSync(dest, { recursive: true, force: true });
            fs.cpSync(appexSrc, dest, { recursive: true });
            console.log(`after-pack: embedded Quick Look appex at ${dest}`);
        } else {
            console.warn(`after-pack: CookQuickLook.appex not found at ${appexSrc}; skipping (run macos/scripts/build-quicklook.sh first)`);
        }
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
