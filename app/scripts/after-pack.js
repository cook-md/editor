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
    // Embed the macOS Quick Look extension FIRST — it must run independently of the
    // source-map cleanup below, which early-returns when the asar `resources/app`
    // layout is absent (it is, for this app). Gating the embed behind that guard is
    // what previously shipped builds with no extension.
    if (context.electronPlatformName === 'darwin') {
        embedQuickLookAppex(context);
    }

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
 * Embed the Quick Look preview extension into the packaged `<App>.app/Contents/PlugIns`
 * so electron-builder's mac signing step seals it and notarization covers it.
 *
 * NOTE: this electron-builder version's AfterPackContext has no `appDir`; the packager's
 * `projectDir` is the electron-builder project root (this `app/` directory), so `..`
 * reaches the repo root where `macos/` lives.
 *
 * @param {import('electron-builder').AfterPackContext} context
 */
function embedQuickLookAppex(context) {
    const projectDir = context.packager.projectDir;
    const appexSrc = path.resolve(
        projectDir, '..', 'macos', 'QuickLookExtension', 'build', 'CookQuickLook.appex'
    );
    if (!fs.existsSync(appexSrc)) {
        console.warn(`after-pack: CookQuickLook.appex not found at ${appexSrc}; skipping (run macos/scripts/build-quicklook.sh first)`);
        return;
    }
    const appName = `${context.packager.appInfo.productFilename}.app`;
    const plugins = path.join(context.appOutDir, appName, 'Contents', 'PlugIns');
    fs.mkdirSync(plugins, { recursive: true });
    const dest = path.join(plugins, 'CookQuickLook.appex');
    fs.rmSync(dest, { recursive: true, force: true });
    fs.cpSync(appexSrc, dest, { recursive: true });
    console.log(`after-pack: embedded Quick Look appex at ${dest}`);
}

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
