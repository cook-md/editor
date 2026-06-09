// @ts-check
'use strict';

// Regression test for the macOS Quick Look appex embedding in after-pack.
//
// Bug: the appex-embed block was placed AFTER the source-map-cleanup guard,
// which early-`return`s when `<appOutDir>/resources/app` is absent. That path
// does not exist in this app's packaged layout, so the embed never ran and no
// build shipped the extension. This test pins the embed running INDEPENDENTLY
// of that guard. Run: `node app/scripts/after-pack.spec.js`

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const afterPack = require('./after-pack').default;

async function run() {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'afterpack-spec-'));
    try {
        const projectDir = path.join(tmp, 'repo', 'app'); // electron-builder project dir
        const appOutDir = path.join(tmp, 'out');
        const appName = 'Cook Editor.app';

        // Packaged .app exists; `resources/app` deliberately does NOT (mirrors real layout).
        fs.mkdirSync(path.join(appOutDir, appName, 'Contents'), { recursive: true });

        // Fake built appex at the path after-pack resolves from projectDir/../macos.
        const appexSrc = path.join(tmp, 'repo', 'macos', 'QuickLookExtension', 'build', 'CookQuickLook.appex');
        fs.mkdirSync(path.join(appexSrc, 'Contents'), { recursive: true });
        fs.writeFileSync(path.join(appexSrc, 'Contents', 'Info.plist'), '<plist/>');

        const context = {
            appOutDir,
            electronPlatformName: 'darwin',
            packager: {
                projectDir,
                appInfo: { productFilename: 'Cook Editor' }
            }
        };

        await afterPack(context);

        const embedded = path.join(
            appOutDir, appName, 'Contents', 'PlugIns', 'CookQuickLook.appex', 'Contents', 'Info.plist'
        );
        assert.ok(
            fs.existsSync(embedded),
            'appex must be embedded into Contents/PlugIns even when resources/app is absent'
        );
        console.log('PASS: appex embedded regardless of the resources/app cleanup guard');
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
}

run().catch(e => {
    console.error('FAIL:', e.message);
    process.exit(1);
});
