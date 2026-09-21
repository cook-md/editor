// @ts-check
'use strict';

// Merges the per-architecture `latest-mac.yml` files into the one manifest a
// release should carry.
//
// The mac-arm64 and mac-x64 jobs build on separate runners and each publishes
// its own `latest-mac.yml`; the last upload wins, which in practice is the x64
// one (the Intel runner is slower). electron-updater on Apple Silicon picks an
// arm64 zip only if the manifest lists one and otherwise falls back to the x64
// zip — so auto-updating arm64 users were being moved onto the Intel build.
//
// Usage: node merge-latest-mac-yml.js <out.yml> <in.yml> <in.yml> [...]

const fs = require('fs');

/** @param {{url: string}} file */
function isArm64(file) {
    // Same test electron-updater's MacUpdater applies to pick a download.
    return file.url.includes('arm64');
}

/** @param {{url: string}} file */
function isZip(file) {
    return file.url.endsWith('.zip');
}

/**
 * @param {Array<{version: string, files: Array<{url: string, sha512: string}>, releaseDate?: string}>} manifests
 */
function mergeManifests(manifests) {
    if (manifests.length === 0) {
        throw new Error('no manifests to merge');
    }
    const version = manifests[0].version;
    const byUrl = new Map();
    for (const manifest of manifests) {
        if (manifest.version !== version) {
            throw new Error(`version mismatch: ${version} vs ${manifest.version} — refusing to mix releases`);
        }
        for (const file of manifest.files || []) {
            const seen = byUrl.get(file.url);
            if (seen && seen.sha512 !== file.sha512) {
                throw new Error(`conflicting entries for ${file.url}: two different builds claim the same name`);
            }
            byUrl.set(file.url, seen || file);
        }
    }

    // x64 first: a client that ignores the arch filter takes the first zip, and
    // the x64 build is the one that runs on every Mac.
    const all = [...byUrl.values()];
    const files = [...all.filter(f => !isArm64(f)), ...all.filter(isArm64)];

    const x64Zip = files.find(f => !isArm64(f) && isZip(f));
    if (!x64Zip) {
        throw new Error('no x64 zip in the merged manifest — Intel Macs could not update');
    }
    if (!files.some(f => isArm64(f) && isZip(f))) {
        throw new Error('no arm64 zip in the merged manifest — Apple Silicon Macs would fall back to the Intel build');
    }

    const releaseDate = manifests.map(m => m.releaseDate).filter(Boolean).sort().pop();
    return { version, files, path: x64Zip.url, sha512: x64Zip.sha512, releaseDate };
}

module.exports = { mergeManifests };

if (require.main === module) {
    const yaml = require('js-yaml');
    const [out, ...inputs] = process.argv.slice(2);
    if (!out || inputs.length === 0) {
        console.error('usage: node merge-latest-mac-yml.js <out.yml> <in.yml> <in.yml> [...]');
        process.exit(2);
    }
    const merged = mergeManifests(inputs.map(file => /** @type {any} */ (yaml.load(fs.readFileSync(file, 'utf8')))));
    fs.writeFileSync(out, yaml.dump(merged, { lineWidth: -1 }));
    console.log(`wrote ${out}:`);
    console.log(fs.readFileSync(out, 'utf8'));
}
