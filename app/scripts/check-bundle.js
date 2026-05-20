#!/usr/bin/env node
// @ts-check
/**
 * Structural sanity check on the bundled backend.
 *
 * Webpack rewrites unresolvable dynamic require(varName) calls into a
 * `webpackEmptyContext` that throws MODULE_NOT_FOUND for any key. Some
 * third-party libraries (e.g. protobufjs via @protobufjs/inquire) catch that
 * error and silently fall back to a broken state — `util.fs` becomes null,
 * and later code crashes deep inside the library with confusing errors like
 * "Cannot read properties of null (reading 'readFileSync')".
 *
 * If we see any of these markers in the bundle, the corresponding package
 * must be externalized in app/webpack.config.js.
 */

const fs = require('fs');
const path = require('path');

const BACKEND_DIR = path.resolve(__dirname, '..', 'lib', 'backend');

/**
 * Each entry: a string that should NOT appear anywhere in the backend bundle,
 * plus a hint pointing at the underlying cause and fix.
 */
const FORBIDDEN_MARKERS = [
    {
        marker: '@protobufjs/inquire sync recursive',
        package: 'protobufjs',
        fix: "Externalize '@grpc/grpc-js', '@grpc/proto-loader', 'protobufjs' in app/webpack.config.js"
    }
];

function main() {
    if (!fs.existsSync(BACKEND_DIR)) {
        console.error(`check-bundle: backend bundle directory not found at ${BACKEND_DIR}`);
        console.error('check-bundle: run `npm run bundle` first.');
        process.exit(2);
    }

    const files = fs.readdirSync(BACKEND_DIR)
        .filter(f => f.endsWith('.js') && !f.endsWith('.map'))
        .map(f => path.join(BACKEND_DIR, f));

    if (files.length === 0) {
        console.error(`check-bundle: no .js files found in ${BACKEND_DIR}`);
        process.exit(2);
    }

    /** @type {{ file: string, marker: string, package: string, fix: string }[]} */
    const violations = [];

    for (const file of files) {
        const content = fs.readFileSync(file, 'utf8');
        for (const entry of FORBIDDEN_MARKERS) {
            if (content.includes(entry.marker)) {
                violations.push({ file: path.relative(BACKEND_DIR, file), ...entry });
            }
        }
    }

    if (violations.length > 0) {
        console.error('check-bundle: FAIL — backend bundle contains broken webpack empty-context references.');
        console.error('');
        for (const v of violations) {
            console.error(`  ${v.file}:`);
            console.error(`    marker:  ${v.marker}`);
            console.error(`    package: ${v.package}`);
            console.error(`    fix:     ${v.fix}`);
            console.error('');
        }
        console.error('At runtime these become util.fs = null inside the dependency,');
        console.error("which surfaces as confusing errors like \"Cannot read properties of null (reading 'readFileSync')\".");
        process.exit(1);
    }

    console.log(`check-bundle: OK — scanned ${files.length} backend bundle file(s).`);
}

main();
