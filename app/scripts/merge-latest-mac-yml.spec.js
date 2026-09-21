// @ts-check
'use strict';

// Spec for merging the per-architecture `latest-mac.yml` update manifests.
//
// Bug: the mac-arm64 and mac-x64 release jobs each publish their own
// `latest-mac.yml`, so the release ends up with whichever was uploaded last —
// in practice the x64 one, from the slower Intel runner. electron-updater on
// an Apple Silicon Mac only picks an arm64 zip if the manifest lists one;
// otherwise it falls back to the x64 zip, so auto-updating arm64 users were
// silently moved onto the Intel build. Run: `node app/scripts/merge-latest-mac-yml.spec.js`

const assert = require('assert');
const { mergeManifests } = require('./merge-latest-mac-yml');

const x64 = {
    version: '0.1.0-alpha.45',
    files: [
        { url: 'Cook-Editor-x64.zip', sha512: 'X64ZIP', size: 311 },
        { url: 'Cook-Editor-x64.dmg', sha512: 'X64DMG', size: 324 },
    ],
    path: 'Cook-Editor-x64.zip',
    sha512: 'X64ZIP',
    releaseDate: '2026-09-20T22:44:36.000Z',
};

const arm64 = {
    version: '0.1.0-alpha.45',
    files: [
        { url: 'Cook-Editor-arm64.zip', sha512: 'ARMZIP', size: 303 },
        { url: 'Cook-Editor-arm64.dmg', sha512: 'ARMDMG', size: 315 },
    ],
    path: 'Cook-Editor-arm64.zip',
    sha512: 'ARMZIP',
    releaseDate: '2026-09-20T22:35:31.000Z',
};

function urls(manifest) {
    return manifest.files.map(f => f.url);
}

// Both architectures are listed, whatever order the jobs finished in.
for (const inputs of [[x64, arm64], [arm64, x64]]) {
    const merged = mergeManifests(inputs);
    assert.deepStrictEqual(urls(merged), [
        'Cook-Editor-x64.zip', 'Cook-Editor-x64.dmg', 'Cook-Editor-arm64.zip', 'Cook-Editor-arm64.dmg',
    ]);
    // The legacy top-level fields stay on the x64 zip: clients that ignore
    // `files` must keep getting a build that runs everywhere (Rosetta).
    assert.strictEqual(merged.path, 'Cook-Editor-x64.zip');
    assert.strictEqual(merged.sha512, 'X64ZIP');
    assert.strictEqual(merged.version, '0.1.0-alpha.45');
    assert.strictEqual(merged.releaseDate, '2026-09-20T22:44:36.000Z', 'the newest release date wins');
}

// Entries keep every field electron-builder wrote (size, blockMapSize, …).
const withBlockmap = { ...arm64, files: [{ ...arm64.files[0], blockMapSize: 99 }, arm64.files[1]] };
assert.strictEqual(mergeManifests([x64, withBlockmap]).files[2].blockMapSize, 99);

// A re-run that feeds the same manifest twice must not duplicate entries.
assert.strictEqual(mergeManifests([x64, arm64, arm64]).files.length, 4);

// Mixing versions would point updaters at binaries from another release.
assert.throws(
    () => mergeManifests([x64, { ...arm64, version: '0.1.0-alpha.44' }]),
    /version mismatch.*alpha\.45.*alpha\.44/s,
);

// Publishing a manifest that still lacks an architecture is the bug itself.
assert.throws(() => mergeManifests([x64]), /no arm64 zip/);
assert.throws(() => mergeManifests([arm64]), /no x64 zip/);
assert.throws(() => mergeManifests([]), /no manifests/);

// The same url with a different checksum means two different builds collided.
assert.throws(
    () => mergeManifests([x64, arm64, { ...arm64, files: [{ ...arm64.files[0], sha512: 'OTHER' }, arm64.files[1]] }]),
    /conflicting entries for Cook-Editor-arm64\.zip/,
);

console.log('merge-latest-mac-yml.spec: all assertions passed');
